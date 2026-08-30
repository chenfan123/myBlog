"""映射表 lexical 检索（PostgreSQL 库内执行，仅返回 Top-K）。

设计原则（针对高并发 / 长文本）:
    - 不把全表加载到 Python 内存
    - 不在进程内建 BM25 索引缓存
    - 检索与排序在 PG 内完成，应用层只拿 LIMIT top_k 行

实现:
    主路径 — keywords JSON 数组子串匹配（ILIKE），按匹配质量 × confidence 排序
    辅路径 — evidence / category_label / dept_name 文本匹配（主路径无结果时）

说明:
    PostgreSQL 默认 FTS（english/simple）对中文连续字串效果差，且加列/GIN
    在线上易与长事务抢锁。以 keywords（LLM 已切好的短语）为主更稳妥。
    若日后数据量极大，可再迁 Elasticsearch BM25。
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# 导诊口语后缀，检索前剥离
_QUERY_NOISE_PATTERN = re.compile(
    r"(挂什么科|要看哪个科|看什么科|看哪个科|怎么挂号|怎么办|请问|想问一下)"
)


def build_lexical_text(
    *,
    keywords: list[str] | None,
    dept_name: str | None,
    category_label: str | None,
    evidence: str | None,
    max_evidence_chars: int = 400,
) -> str:
    """可选：写入时生成检索辅助文本（当前主检索不依赖此列）。"""
    parts: list[str] = []
    if keywords:
        parts.append(" ".join(keywords))
    if dept_name:
        parts.append(dept_name.strip())
    if category_label:
        parts.append(category_label.strip())
    if evidence:
        ev = re.sub(r"\s+", " ", evidence.strip())
        if len(ev) > max_evidence_chars:
            ev = ev[:max_evidence_chars]
        parts.append(ev)
    return " ".join(parts).strip()


def _normalize_query(text_val: str) -> str:
    return re.sub(r"\s+", "", text_val.strip().lower())


def _prepare_lexical_query(query: str) -> str:
    q = _QUERY_NOISE_PATTERN.sub("", query.strip())
    return _normalize_query(q)


def _find_matched_keywords(query: str, keywords: list[str]) -> list[str]:
    q = _normalize_query(query)
    if not q:
        return []
    matched: list[str] = []
    for kw in keywords:
        nk = _normalize_query(kw)
        if nk and (nk in q or q in nk):
            matched.append(kw)
    return matched


def _parse_keywords(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def search_mappings_lexical(
    session: Session,
    query: str,
    *,
    top_k: int = 10,
    recommendable_only: bool = True,
    validated_only: bool = True,
    min_confidence: float = 0.5,
) -> list[dict[str, Any]]:
    """PG 库内 lexical 检索：keywords 子串匹配，仅返回 Top-K。

    不加载全表、不建内存索引；多用户并发时内存占用与返回条数成正比。
    """
    q = _prepare_lexical_query(query)
    if not q:
        return []

    filters = ["confidence >= :min_confidence"]
    params: dict[str, Any] = {
        "query": q,
        "min_confidence": min_confidence,
        "top_k": top_k,
    }
    if recommendable_only:
        filters.append("recommendable IS TRUE")
    if validated_only:
        filters.append("validated IS TRUE")
    where_clause = " AND ".join(filters)

    # match_score:
    #   1.0  — keyword 与 query 完全相等
    #   0.9  — keyword 是 query 的子串（病名出现在问句中）
    #   0.7  — query 是 keyword 的子串（问句较短）
    # 最终 score = match_score * confidence
    sql = text(
        f"""
        SELECT
            mapping_id,
            dept_id,
            dept_name,
            entity_type,
            keywords,
            category_label,
            source_chunk_id,
            evidence,
            confidence,
            match_score,
            (match_score * confidence) AS score
        FROM (
            SELECT
                m.*,
                (
                    SELECT MAX(
                        CASE
                            WHEN lower(replace(kw, ' ', '')) = :query THEN 1.0
                            WHEN position(lower(replace(kw, ' ', '')) in :query) > 0 THEN 0.9
                            WHEN position(:query in lower(replace(kw, ' ', ''))) > 0 THEN 0.7
                            ELSE 0.0
                        END
                    )
                    FROM jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof(to_jsonb(m.keywords)) = 'array'
                            THEN to_jsonb(m.keywords)
                            ELSE '[]'::jsonb
                        END
                    ) AS kw
                ) AS match_score
            FROM zy91_dept_mappings m
            WHERE {where_clause}
        ) ranked
        WHERE match_score > 0
        ORDER BY score DESC, match_score DESC
        LIMIT :top_k
        """
    )

    rows = session.execute(sql, params).mappings().all()

    # 兜底：keywords 未命中时，用 evidence/category 做 ILIKE（仍 LIMIT，不全表进内存）
    if not rows:
        fallback = text(
            f"""
            SELECT
                mapping_id, dept_id, dept_name, entity_type, keywords,
                category_label, source_chunk_id, evidence, confidence,
                0.55 AS match_score,
                (0.55 * confidence) AS score
            FROM zy91_dept_mappings
            WHERE {where_clause}
              AND (
                    category_label ILIKE '%' || :query || '%'
                 OR dept_name ILIKE '%' || :query || '%'
                 OR evidence ILIKE '%' || :query || '%'
              )
            ORDER BY confidence DESC
            LIMIT :top_k
            """
        )
        rows = session.execute(fallback, params).mappings().all()

    hits: list[dict[str, Any]] = []
    for row in rows:
        keywords = _parse_keywords(row["keywords"])
        hits.append(
            {
                "mapping_id": row["mapping_id"],
                "dept_id": row["dept_id"],
                "dept_name": row["dept_name"],
                "entity_type": row["entity_type"],
                "keywords": keywords,
                "matched_keywords": _find_matched_keywords(query, keywords),
                "category_label": row["category_label"] or "",
                "source_chunk_id": row["source_chunk_id"],
                "evidence": row["evidence"],
                "confidence": float(row["confidence"] or 0),
                "score": round(float(row["score"] or 0), 4),
                "match_score": round(float(row["match_score"] or 0), 4),
                "source": "mapping_keyword",
            }
        )
    return hits


# 兼容旧 import 名
search_mappings_bm25 = search_mappings_lexical


def invalidate_bm25_cache() -> None:
    """已无内存索引；保留空函数兼容旧调用。"""


def ensure_lexical_schema(engine) -> None:
    """当前方案不依赖额外列/索引；保留空函数兼容旧调用。"""
