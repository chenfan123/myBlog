"""混合检索：症状/疾病 → 科室推荐（三路召回 + 融合 + Rerank + parent 回查）。

本模块是智能导诊 Agent 的核心检索层，负责将用户自然语言问题
映射到最合适的挂号科室，并附带可解释的推荐依据。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、整体流程
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    用户 query（如「甲状腺结节挂什么科」）
        │
        ├─ embed_query()  ──→  query 向量（1536 维 ada-002）
        │
        ├─① Milvus dept_symptom_mappings   映射向量 Top-K
        ├─② PG  zy91_dept_mappings         全文检索 GIN Top-K（库内 ts_rank_cd）
        └─③ Milvus dept_chunks_hierarchical child 向量 Top-K
                │
                ▼
        _fuse_candidates()  按 dept_id 去重，通道加权融合
                │
                ▼
        _apply_rerank()     qwen3-vl-rerank 精排 Top-30 → 取 Top-K
                │
                ▼
        _attach_parents()   child 命中 → PG zy91_dept_parents 取整节原文
                │
                ▼
        list[DeptHit]       供 LLM Agent 生成最终推荐话术

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、三路召回各自解决什么问题
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

通道              数据源                          擅长              弱点
────────────────  ──────────────────────────────  ────────────────  ────────────────
mapping_keyword   PG zy91_dept_mappings           精确病名/症状名   无法匹配口语变体
                  （GIN 全文索引，库内检索）        PostgreSQL FTS
                  （LLM 抽取的结构化映射）         如「甲状腺结节」   如「脖子有个包」

mapping_vector    Milvus dept_symptom_mappings    口语化、同义表达   可能偏到相关但
                  （映射 embedding_text 向量）     语义泛化           非首选科室

dept_child        Milvus dept_chunks_hierarchical 科室原文兜底       粒度较粗，Top1
                  （分层 child 切块向量）           无映射覆盖时       分差可能较小

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、recommendable 过滤（三层）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

目标：只向用户推荐「临床可挂号科室」，不推荐医技平台科室（如核医学科、放射科）。
 
    第 1 层 — mapping 向量:  Milvus filter `recommendable == true`
    第 2 层 — mapping lexical: PG GIN 全文检索（search_mappings_lexical）
    第 3 层 — dept child:    dept_whitelist.is_recommendable_dept() 白名单
    第 4 层 — 融合兜底:      _fuse_candidates() 再次校验白名单

白名单定义见 backend/dept_whitelist.py（CLINICAL_DEPT_NAMES）。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、融合与 Rerank 策略
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

融合分 = normalize(通道原始分) × CHANNEL_WEIGHTS[通道]

    mapping_keyword  权重 1.0   精确命中优先
    mapping_vector   权重 0.9   语义补充
    dept_child       权重 0.8   原文兜底

同一 dept_id 只保留一条 DeptHit，sources 列表记录所有命中通道。
Rerank 阶段取融合分 Top-30 送入 qwen3-vl-rerank，最终输出 Top-K。
Rerank 失败时自动回退融合分排序，不中断检索。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
五、依赖与配置
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    EMBEDDING_*     向量化（与 embed 阶段同一模型）
    MILVUS_*        向量检索（zy91_triage 库）
    DATABASE_URL    PG 全文检索 + parent 回查
    RERANK_*        精排（或 DASHSCOPE_API_KEY）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
六、用法
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CLI 调试:
    python -m backend.retriever --query "甲状腺结节挂什么科"
    python -m backend.retriever --query "胃痛反酸" --no-rerank
    python -m backend.verify_retrieval --hybrid

Agent 集成:
    from backend.retriever import search_departments, DepartmentRetriever

    # 单次调用
    hits = search_departments("胸口闷痛", top_k=3)

    # 长会话复用实例（避免重复初始化 Milvus / Embedding 客户端）
    retriever = DepartmentRetriever()
    hits = retriever.search_departments("孩子发烧咳嗽", top_k=5)
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from typing import Any

from pymilvus import MilvusClient

from backend.config import RerankSettings, Settings, get_rerank_settings, get_settings
from backend.db import get_session_factory
from backend.dept_parent_db import get_dept_parents_by_ids
from backend.dept_whitelist import is_recommendable_dept
from backend.embed import build_embeddings, ensure_milvus_database
from backend.mapping_db import search_mappings_by_keywords
from backend.rerank import rerank_documents

# ── 三路召回权重 ──
# 融合分 = 通道原始分（归一化到 [0,1]）× 对应权重
# lexical 通道权重最高：对标准病名（如「甲状腺结节」）命中率远高于纯向量
CHANNEL_WEIGHTS: dict[str, float] = {
    "mapping_keyword": 1.0,
    "mapping_vector": 0.9,
    "dept_child": 0.8,
}

# 每路召回的 Top-K（融合前去重前，每路各取这么多条）
DEFAULT_PER_CHANNEL_K = 10

# 送入 Rerank 模型的最大候选数（控制 API 成本与延迟；qwen3-vl-rerank 文本上限 100）
RERANK_POOL_SIZE = 30

# 检索分调整见 backend.agent.clinical_priors（全局守卫 + ROUTING_RULES）


@dataclass
class DeptHit:
    """科室检索命中 — 融合 / Rerank 后的单条结果，供 Agent 或 CLI 消费。

    字段分三组：
        排序相关  rank, fused_score, rerank_score, source, sources
        科室标识  dept_id, dept_name
        展示依据  evidence, section, category_label, keywords, matched_keywords,
                  parent_text, mapping_id, chunk_id, parent_id, rerank_text
    """

    # ── 排序 ──
    rank: int = 0  # 最终排名（1-based），Rerank 或融合排序后赋值
    source: str = ""  # 最高分来源通道（mapping_keyword / mapping_vector / dept_child）
    fused_score: float = 0.0  # 加权融合分；Rerank 前的粗排分数
    rerank_score: float | None = None  # Rerank 精排分；None 表示未走 Rerank
    sources: list[str] = field(default_factory=list)  # 所有命中该科室的通道（可多项）

    # ── 科室标识 ──
    dept_id: str = ""  # 医院科室 ID，去重主键
    dept_name: str = ""  # 科室名称，展示用

    # ── 推荐依据（给 LLM / 前端展示）──
    evidence: str = ""  # 核心依据文本（mapping.evidence 或 child.text）
    section: str = ""  # child 来源的 Markdown 小节名（如「专科特色」）
    category_label: str = ""  # mapping 来源的专病/方向标签（如「甲状腺良性病变与结节」）
    keywords: list[str] = field(default_factory=list)  # 映射条目的全部关键词
    matched_keywords: list[str] = field(default_factory=list)  # 关键词通道实际命中的词
    parent_text: str | None = None  # PG 回查的 parent 整节原文（child 命中时有值）

    # ── 溯源 ID（调试 / 审计用）──
    mapping_id: str = ""  # 映射条目 ID（mapping 通道命中时）
    chunk_id: str = ""  # child chunk ID（dept_child 通道命中时）
    parent_id: str = ""  # parent chunk ID，用于 _attach_parents 回查

    # ── Rerank 输入 ──
    rerank_text: str = ""  # 送入 Rerank 模型的文档文本（科室名 + 关键词 + 依据）


class DepartmentRetriever:
    """症状/疾病 → 科室混合检索器。

    实例化时创建并复用 Embedding 客户端与 Milvus 连接，
    适合 Agent 长会话中多次调用 search_departments()。

    Attributes:
        settings: Embedding / Milvus 配置。
        rerank_settings: Rerank 配置；None 时每次 search 从 .env 读取。
        per_channel_k: 每路召回条数，默认 DEFAULT_PER_CHANNEL_K。
    """

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        rerank_settings: RerankSettings | None = None,
        per_channel_k: int = DEFAULT_PER_CHANNEL_K,
    ) -> None:
        self.settings = settings or get_settings()
        self.rerank_settings = rerank_settings
        self.per_channel_k = per_channel_k
        # 与 embed 阶段同一模型，保证 query 向量与库内向量在同一空间
        self._embed_model = build_embeddings(self.settings)
        self._milvus = MilvusClient(uri=self.settings.milvus_uri)
        ensure_milvus_database(self._milvus, self.settings.milvus_db)

    def _embed_query(self, query: str) -> list[float]:
        """将用户问题转为 1536 维向量，供 Milvus 两路向量检索共用。"""
        return self._embed_model.embed_query(query)

    # ─────────────────────────────────────────────────────────
    # 通道①：映射向量检索
    # ─────────────────────────────────────────────────────────

    def _search_mapping_vectors(
        self,
        query_vector: list[float],
        *,
        top_k: int,
        recommendable_only: bool = True,
    ) -> list[dict[str, Any]]:
        """Milvus dept_symptom_mappings 向量近邻检索。

        数据来源: extract_dept_mapping → PG → embed --target mappings
        每条 mapping 的 embedding_text = 类型 + keywords + 科室 + 方向 + 依据

        适合: 口语化描述（「脖子有个包」「吃饭总反酸」）
        注意: 纯向量可能对相近但非首选的科室给高分（如核医学科 vs 甲状腺外科），
              需依赖关键词通道 + Rerank 修正。
        """
        collection = self.settings.milvus_mapping_collection
        # Milvus 侧过滤：只召回 recommendable=true 的映射（LLM 抽取时已标注）
        filter_expr = "recommendable == true" if recommendable_only else None

        raw = self._milvus.search(
            collection_name=collection,
            data=[query_vector],
            limit=top_k,
            filter=filter_expr,
            output_fields=[
                "mapping_id",
                "dept_id",
                "dept_name",
                "entity_type",
                "keywords",
                "category_label",
                "evidence",
                "confidence",
                "recommendable",
                "text",  # 即 embedding_text，可直接用作 rerank_text
            ],
        )

        hits: list[dict[str, Any]] = []
        for item in raw[0] if raw else []:
            entity = item["entity"]
            # Milvus COSINE 度量下 distance 字段即为余弦相似度（越大越相似）
            score = float(item["distance"])

            # keywords 在 Milvus 中以 JSON 字符串存储，需反序列化
            keywords_raw = entity.get("keywords") or "[]"
            if isinstance(keywords_raw, str):
                try:
                    keywords = json.loads(keywords_raw)
                except json.JSONDecodeError:
                    keywords = []
            else:
                keywords = keywords_raw

            hits.append(
                {
                    "mapping_id": entity.get("mapping_id", ""),
                    "dept_id": entity.get("dept_id", ""),
                    "dept_name": entity.get("dept_name", ""),
                    "entity_type": entity.get("entity_type", ""),
                    "keywords": keywords,
                    "category_label": entity.get("category_label", ""),
                    "evidence": entity.get("evidence", ""),
                    "confidence": float(entity.get("confidence") or 0),
                    "score": score,
                    "source": "mapping_vector",
                    # text 字段即 embed 时的 embedding_text；缺失时现场拼接
                    "rerank_text": entity.get("text") or _build_mapping_rerank_text(entity, keywords),
                }
            )
        return hits

    # ─────────────────────────────────────────────────────────
    # 通道②：PG 全文 lexical 检索（GIN 索引，库内 Top-K）
    # ─────────────────────────────────────────────────────────

    def _search_mapping_keywords(
        self,
        query: str,
        *,
        top_k: int,
        recommendable_only: bool = True,
    ) -> list[dict[str, Any]]:
        """PostgreSQL zy91_dept_mappings 库内 lexical 检索（backend.mapping_bm25）。

        实现: keywords JSON 子串匹配，在 PG 内打分排序，仅 LIMIT Top-K
        特点: 不加载全表到 Python 内存，多用户并发时内存与返回条数成正比

        适合: 标准病名/症状名（「甲状腺结节」「反酸烧心」「类风湿」）
        """
        factory = get_session_factory()
        with factory() as session:
            rows = search_mappings_by_keywords(
                session,
                query,
                top_k=top_k,
                recommendable_only=recommendable_only,
            )
        # 补充 rerank_text（PG 查询不返回此字段）
        for row in rows:
            row["rerank_text"] = _build_mapping_rerank_text(
                row, row.get("keywords") or [])
        return rows

    # ─────────────────────────────────────────────────────────
    # 通道③：科室 child 向量检索
    # ─────────────────────────────────────────────────────────

    def _search_dept_child_vectors(
        self,
        query_vector: list[float],
        *,
        top_k: int,
        recommendable_only: bool = True,
    ) -> list[dict[str, Any]]:
        """Milvus dept_chunks_hierarchical 向量近邻检索。

        数据来源: chunk --hierarchical → embed --target dept --hierarchical
        每条 child 的 embedding_text 含 parent 前 220 字上下文（Context Enhancement）
        parent 整节原文在 PG zy91_dept_parents，检索后按 parent_id 回查

        适合: 映射未覆盖的新表述、科室原文中的长尾描述
        注意: child  collection 无 recommendable 字段，需在应用层按白名单过滤；
              因此多取 2× 条再在 Python 侧过滤，保证过滤后仍有 top_k 条。
        """
        collection = self.settings.milvus_dept_hier_collection
        raw = self._milvus.search(
            collection_name=collection,
            data=[query_vector],
            # 白名单过滤会丢弃部分结果，所以先多取一倍
            limit=top_k * 2 if recommendable_only else top_k,
            output_fields=[
                "chunk_id",
                "dept_id",
                "dept_name",
                "section",
                "parent_id",
                "text",
            ],
        )

        hits: list[dict[str, Any]] = []
        for item in raw[0] if raw else []:
            entity = item["entity"]
            dept_name = entity.get("dept_name", "")

            # 白名单过滤：排除核医学科、放射科等医技平台科室
            if recommendable_only and not is_recommendable_dept(dept_name):
                continue

            hits.append(
                {
                    "chunk_id": entity.get("chunk_id", ""),
                    "dept_id": entity.get("dept_id", ""),
                    "dept_name": dept_name,
                    "section": entity.get("section", ""),
                    "parent_id": entity.get("parent_id", ""),
                    "evidence": entity.get("text", ""),
                    "score": float(item["distance"]),
                    "source": "dept_child",
                    "rerank_text": _build_dept_child_rerank_text(entity),
                }
            )
            if len(hits) >= top_k:
                break
        return hits

    # ─────────────────────────────────────────────────────────
    # 主入口
    # ─────────────────────────────────────────────────────────

    def search_departments(
        self,
        query: str,
        *,
        top_k: int = 5,
        per_channel_k: int | None = None,
        recommendable_only: bool = True,
        rerank: bool | None = None,
    ) -> list[DeptHit]:
        """执行完整检索 pipeline：三路召回 → 融合 → Rerank → parent 回查。

        Args:
            query: 用户导诊问题，如「胃痛反酸挂什么科」。
            top_k: 最终返回科室数量（通常 1 主推 + 1~2 备选）。
            per_channel_k: 每路召回条数；None 用实例默认值。
            recommendable_only: True 只返回临床可挂号科室。
            rerank: True 强制 Rerank；False 跳过；None 读 RERANK_ENABLED。

        Returns:
            按相关性降序的 DeptHit 列表，rank 从 1 开始。
            空 query 返回 []；三路均无命中返回 []。
        """
        if not query.strip():
            return []

        k = per_channel_k or self.per_channel_k
        # 临床先验改写：女性小腹痛等补「妇科」线索，避免映射漏召
        from backend.agent.clinical_priors import rewrite_query_for_priors

        search_q = rewrite_query_for_priors(query)

        # Step 1: query 向量化（一次 embed，两路 Milvus 共用）
        query_vector = self._embed_query(search_q)

        # Step 2: 三路召回（串行；后续可改 asyncio 并行优化延迟）
        mapping_vec = self._search_mapping_vectors(
            query_vector, top_k=k, recommendable_only=recommendable_only
        )
        mapping_kw = self._search_mapping_keywords(
            search_q, top_k=k, recommendable_only=recommendable_only
        )
        dept_child = self._search_dept_child_vectors(
            query_vector, top_k=k, recommendable_only=recommendable_only
        )

        # Step 3: 按 dept_id 去重融合
        candidates = _fuse_candidates(
            mapping_vec,
            mapping_kw,
            dept_child,
            recommendable_only=recommendable_only,
        )
        if not candidates:
            return []

        # Step 3.5: query 先验（压低肿瘤内科编号科、抬高儿科/精神/妇科等）
        _apply_query_priors(query, candidates)

        # Step 4: Rerank 精排（或融合分直接截断）；精排文档用改写 query
        do_rerank = rerank
        if do_rerank is None:
            rs = (
                self.rerank_settings
                if self.rerank_settings is not None
                else _safe_rerank_settings()
            )
            do_rerank = rs.enabled if rs else False

        if do_rerank:
            candidates = _apply_rerank(search_q, candidates, top_k=max(top_k, 8))
            candidates = _post_rerank_adjust(query, candidates, top_k=top_k)
        else:
            candidates.sort(key=lambda c: c.fused_score, reverse=True)
            candidates = candidates[:top_k]

        # Step 5: child 命中时回查 PG parent 整节原文
        _attach_parents(candidates)

        # Step 6: 赋值最终排名
        for i, hit in enumerate(candidates, start=1):
            hit.rank = i
        return candidates


# ─────────────────────────────────────────────────────────────
# 便捷函数（模块级 API，供 Agent 直接 import）
# ─────────────────────────────────────────────────────────────


def search_departments(
    query: str,
    *,
    top_k: int = 5,
    rerank: bool | None = None,
) -> list[DeptHit]:
    """单次科室混合检索（每次新建 Retriever 实例）。

    适合: 低频调用、脚本测试
    高频: 请用 DepartmentRetriever() 复用实例
    """
    return DepartmentRetriever().search_departments(query, top_k=top_k, rerank=rerank)


def search_doctors(
    query: str,
    *,
    top_k: int = 5,
    dept_hint: str | None = None,
    min_score: float = 0.35,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """医生检索：有科室焦点时优先按科室过滤；否则向量检索并丢弃低分结果。

    独立于科室三路检索，供「哪个医生擅长 X / XX 科专家」类问题。
    精确排班（周几、院区）请走 schedule_db，不在此函数范围。
    """
    from backend.agent.dept_focus import resolve_focus_dept
    from backend.db import get_session_factory
    from backend.schedule_db import list_doctors_by_department

    settings = settings or get_settings()
    q = (query or "").strip()
    hint = (dept_hint or "").strip() or resolve_focus_dept(q) or None

    # 1) 有科室焦点：Milvus 过滤向量 + PG 姓名列表兜底
    if hint:
        filtered = _search_doctors_milvus(
            q or hint,
            top_k=top_k,
            settings=settings,
            dept_filter=hint,
            min_score=0.0,  # 已按科室收窄，放宽分数
        )
        if filtered:
            return filtered
        # PG 结构化兜底
        try:
            factory = get_session_factory()
            with factory() as session:
                rows = list_doctors_by_department(session, keyword=hint, limit=top_k)
            if rows:
                return [
                    {
                        "rank": i,
                        "score": 1.0,
                        "doctor_id": r.get("doctor_id", ""),
                        "name": r.get("name", ""),
                        "dept_id": r.get("dept_id") or "",
                        "dept_name": r.get("department_name") or "",
                        "title": r.get("title") or "",
                        "text": _doctor_pg_text(r),
                        "has_schedule": False,
                    }
                    for i, r in enumerate(rows, start=1)
                ]
        except Exception:
            pass
        return []

    # 2) 无科室焦点：纯向量，低相关直接丢弃（避免乱推血液科等）
    return _search_doctors_milvus(
        q, top_k=top_k, settings=settings, dept_filter=None, min_score=min_score
    )


def _doctor_pg_text(row: dict[str, Any]) -> str:
    parts = [
        f"【{row.get('department_name') or ''} · {row.get('name') or ''} · {row.get('title') or ''}】"
    ]
    if row.get("specialty"):
        parts.append(f"擅长：{row['specialty']}")
    if row.get("profile"):
        parts.append(f"简介：{row['profile']}")
    return "\n".join(parts)


def _search_doctors_milvus(
    query: str,
    *,
    top_k: int,
    settings: Settings,
    dept_filter: str | None,
    min_score: float,
) -> list[dict[str, Any]]:
    if not query.strip():
        return []
    embed_model = build_embeddings(settings)
    query_vector = embed_model.embed_query(query)

    client = MilvusClient(uri=settings.milvus_uri)
    ensure_milvus_database(client, settings.milvus_db)

    search_kwargs: dict[str, Any] = {
        "collection_name": settings.milvus_doctor_collection,
        "data": [query_vector],
        "limit": max(top_k * 3, top_k) if dept_filter else top_k,
        "output_fields": [
            "doctor_id",
            "name",
            "dept_id",
            "dept_name",
            "title",
            "text",
            "has_schedule",
        ],
    }
    if dept_filter:
        # Milvus 表达式：科室名包含关键词
        safe = dept_filter.replace('"', "")
        search_kwargs["filter"] = f'dept_name like "%{safe}%"'

    try:
        raw = client.search(**search_kwargs)
    except Exception:
        if dept_filter:
            # 过滤语法不支持时降级：多取再后过滤
            search_kwargs.pop("filter", None)
            search_kwargs["limit"] = max(50, top_k * 10)
            raw = client.search(**search_kwargs)
        else:
            raise

    results: list[dict[str, Any]] = []
    for item in raw[0] if raw else []:
        entity = item["entity"]
        dept_name = entity.get("dept_name", "") or ""
        score = float(item["distance"])
        if dept_filter and dept_filter not in dept_name:
            continue
        if score < min_score:
            continue
        results.append(
            {
                "rank": 0,
                "score": score,
                "doctor_id": entity.get("doctor_id", ""),
                "name": entity.get("name", ""),
                "dept_id": entity.get("dept_id", ""),
                "dept_name": dept_name,
                "title": entity.get("title", ""),
                "text": entity.get("text", ""),
                "has_schedule": entity.get("has_schedule", False),
            }
        )
        if len(results) >= top_k:
            break
    for i, r in enumerate(results, start=1):
        r["rank"] = i
    return results


# ─────────────────────────────────────────────────────────────
# 内部：融合 / Rerank / parent 回查 / 文本构造
# ─────────────────────────────────────────────────────────────


def _safe_rerank_settings() -> RerankSettings | None:
    """安全读取 Rerank 配置；未配置 API Key 时返回 None（跳过 Rerank）。"""
    try:
        return get_rerank_settings()
    except RuntimeError:
        return None


def _normalize_channel_score(source: str, score: float) -> float:
    """将各通道原始分裁剪到 [0, 1]。

    Milvus COSINE: distance 即余弦相似度，越大越相似，通常已在 [0, 1]。
    PG lexical:    score = match_score × confidence，约 [0, 1]；库内计算仅返回 Top-K。
    """
    return max(0.0, min(1.0, score))


def _apply_query_priors(query: str, candidates: list[DeptHit]) -> None:
    """按 clinical_priors 规则调整融合分（原地修改）。"""
    from backend.agent.clinical_priors import dept_score_multiplier

    for hit in candidates:
        hit.fused_score = round(
            min(hit.fused_score * dept_score_multiplier(query, hit.dept_name), 1.5),
            4,
        )


def _post_rerank_adjust(
    query: str,
    candidates: list[DeptHit],
    *,
    top_k: int,
) -> list[DeptHit]:
    """Rerank 后再按 clinical_priors 微调顺序。"""
    from backend.agent.clinical_priors import dept_score_multiplier

    def _sort_key(hit: DeptHit) -> tuple[float, float]:
        base = hit.rerank_score if hit.rerank_score is not None else hit.fused_score
        mult = dept_score_multiplier(query, hit.dept_name or "")
        return (base * mult, hit.fused_score)

    candidates.sort(key=_sort_key, reverse=True)
    return candidates[:top_k]


def _fuse_candidates(
    mapping_vec: list[dict[str, Any]],
    mapping_kw: list[dict[str, Any]],
    dept_child: list[dict[str, Any]],
    *,
    recommendable_only: bool,
) -> list[DeptHit]:
    """三路结果按科室去重融合为 DeptHit 列表。

    规则:
        1. 去重键优先 dept_id；若同名不同 id，再按 dept_name 合并（避免 Top-K 重复）
        2. 同一科室只保留一条，fused_score 取各通道加权最高分
        3. sources 列表记录所有命中该科室的通道（如 mapping_keyword+mapping_vector）
        4. 处理顺序: 关键词 → 向量 → child（关键词优先写入，后续通道补充 sources）

    示例:
        甲状腺外科同时被 mapping_keyword 和 mapping_vector 命中
        → 一条 DeptHit，sources=["mapping_keyword", "mapping_vector"]
    """
    merged: dict[str, DeptHit] = {}
    name_to_key: dict[str, str] = {}  # dept_name → merged 主键，防止同名重复

    def _upsert(raw: dict[str, Any]) -> None:
        dept_id = str(raw.get("dept_id") or "")
        dept_name = raw.get("dept_name") or ""
        if not dept_id and not dept_name:
            return

        # 兜底白名单：mapping 通道已在 Milvus/PG 侧过滤，此处主要拦截 child 漏网
        if recommendable_only and dept_name and not is_recommendable_dept(dept_name):
            if raw.get("source") not in ("mapping_keyword", "mapping_vector"):
                return

        # 同名科室已存在时并入该条目，避免「消化内科（一）」占两个名额
        if dept_name and dept_name in name_to_key:
            key = name_to_key[dept_name]
        else:
            key = dept_id or dept_name
            if dept_name:
                name_to_key[dept_name] = key

        source = raw.get("source", "")
        weight = CHANNEL_WEIGHTS.get(source, 0.5)
        fused = _normalize_channel_score(
            source, float(raw.get("score", 0))) * weight

        existing = merged.get(key)
        if existing is None:
            # 首次命中该科室：创建新 DeptHit
            merged[key] = DeptHit(
                dept_id=dept_id,
                dept_name=dept_name,
                source=source,
                fused_score=round(fused, 4),
                evidence=raw.get("evidence", ""),
                section=raw.get("section", "") or raw.get(
                    "source_section", ""),
                category_label=raw.get("category_label", ""),
                keywords=list(raw.get("keywords") or []),
                matched_keywords=list(raw.get("matched_keywords") or []),
                mapping_id=raw.get("mapping_id", ""),
                chunk_id=raw.get("chunk_id", ""),
                parent_id=raw.get("parent_id", ""),
                rerank_text=raw.get("rerank_text", ""),
                sources=[source],
            )
        else:
            # 同科室再次被其他通道命中：累加 sources，若本通道分更高则更新主字段
            if source not in existing.sources:
                existing.sources.append(source)
            if fused > existing.fused_score:
                existing.fused_score = round(fused, 4)
                existing.source = source
                # 更新展示字段为更高分通道的内容
                existing.evidence = raw.get("evidence", existing.evidence)
                existing.matched_keywords = list(
                    raw.get("matched_keywords") or existing.matched_keywords
                )
                existing.rerank_text = raw.get(
                    "rerank_text", existing.rerank_text)

    # 关键词优先处理（精确命中权重最高，先写入 merged）
    for batch in (mapping_kw, mapping_vec, dept_child):
        for raw in batch:
            _upsert(raw)

    return list(merged.values())


def _apply_rerank(
    query: str,
    candidates: list[DeptHit],
    *,
    top_k: int,
) -> list[DeptHit]:
    """对融合候选池调用 qwen3-vl-rerank 精排。

    流程:
        1. 按 fused_score 降序取 Top RERANK_POOL_SIZE（默认 30）
        2. 提取各候选的 rerank_text 组成 documents 列表
        3. 调用 rerank_documents() 获取得分
        4. 按 rerank_score 重排，取 Top-K
        5. 失败时回退 fused_score 排序（print 警告，不抛异常）
    """
    settings = _safe_rerank_settings()
    candidates.sort(key=lambda c: c.fused_score, reverse=True)
    pool = candidates[: min(RERANK_POOL_SIZE, len(candidates))]

    if not settings:
        return pool[:top_k]

    documents = [c.rerank_text or _fallback_rerank_text(c) for c in pool]
    try:
        hits = rerank_documents(
            query,
            documents,
            settings=settings,
            top_n=len(pool),
        )
    except Exception as exc:
        print(f"[retriever] Rerank 失败，回退融合分: {exc}")
        return pool[:top_k]

    reranked: list[DeptHit] = []
    seen_names: set[str] = set()
    for rh in hits:
        if 0 <= rh.index < len(pool):
            c = pool[rh.index]
            # Rerank 偶发重复 index / 同名时去重，保证 Top-K 科室互异
            if c.dept_name in seen_names:
                continue
            seen_names.add(c.dept_name)
            c.rerank_score = round(rh.relevance_score, 4)
            reranked.append(c)
        if len(reranked) >= top_k:
            break
    return reranked[:top_k]


def _attach_parents(candidates: list[DeptHit]) -> None:
    """批量回查 PG zy91_dept_parents，填充 parent_text。

    仅 child 通道命中的候选有 parent_id；mapping 通道无 parent。
    parent_text 供 LLM 生成推荐依据时使用（比 child 片段更完整）。
    """
    parent_ids = [c.parent_id for c in candidates if c.parent_id]
    if not parent_ids:
        return
    factory = get_session_factory()
    with factory() as session:
        parents = get_dept_parents_by_ids(session, parent_ids)
    for c in candidates:
        if c.parent_id and c.parent_id in parents:
            c.parent_text = parents[c.parent_id]["text"]


def _build_mapping_rerank_text(entity: dict[str, Any], keywords: list[str]) -> str:
    """构造 mapping 条目送入 Rerank 的文档文本。

    格式与 embed 阶段的 embedding_text 保持一致，便于 Rerank 模型理解语义。
    """
    kw = "、".join(keywords)
    return (
        f"推荐科室：{entity.get('dept_name', '')}\n"
        f"关键词：{kw}\n"
        f"方向：{entity.get('category_label', '')}\n"
        f"依据：{entity.get('evidence', '')}"
    )


def _build_dept_child_rerank_text(entity: dict[str, Any]) -> str:
    """构造 dept child 条目送入 Rerank 的文档文本。"""
    section = entity.get("section") or "科室介绍"
    return (
        f"科室：{entity.get('dept_name', '')}\n"
        f"章节：{section}\n"
        f"{entity.get('text', '')}"
    )


def _fallback_rerank_text(hit: DeptHit) -> str:
    """rerank_text 缺失时的兜底文档（不应常触发）。"""
    return (
        f"推荐科室：{hit.dept_name}\n"
        f"依据：{hit.evidence}"
    )


# ─────────────────────────────────────────────────────────────
# CLI 调试入口
# ─────────────────────────────────────────────────────────────


def _print_hits(query: str, hits: list[DeptHit]) -> None:
    """CLI 格式化输出检索结果。"""
    print(f"\n{'=' * 60}")
    print(f"Q: {query}")
    if not hits:
        print("  (无命中)")
        return
    for h in hits:
        score = (
            f"rerank={h.rerank_score:.4f}"
            if h.rerank_score is not None
            else f"fused={h.fused_score:.4f}"
        )
        src = "+".join(h.sources) if h.sources else h.source
        print(f"  #{h.rank} {score} | {h.dept_name} | [{src}]")
        if h.matched_keywords:
            print(f"      关键词命中: {', '.join(h.matched_keywords)}")
        if h.category_label:
            print(f"      方向: {h.category_label}")
        print(f"      依据: {_preview(h.evidence, 100)}")
        if h.parent_text:
            print(f"      parent: {_preview(h.parent_text, 80)}")


def _preview(text: str, n: int) -> str:
    t = " ".join(text.split())
    return t if len(t) <= n else t[: n - 1] + "…"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="科室混合检索（三路 + Rerank）")
    parser.add_argument("--query", required=True, help="导诊问题")
    parser.add_argument("--top-k", type=int, default=5, help="最终返回科室数")
    parser.add_argument(
        "--per-channel-k",
        type=int,
        default=DEFAULT_PER_CHANNEL_K,
        help="每路召回条数",
    )
    parser.add_argument("--no-rerank", action="store_true",
                        help="跳过 Rerank 精排")
    parser.add_argument(
        "--no-recommendable-filter",
        action="store_true",
        help="不过滤医技平台科室（调试用）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    retriever = DepartmentRetriever(per_channel_k=args.per_channel_k)
    hits = retriever.search_departments(
        args.query,
        top_k=args.top_k,
        recommendable_only=not args.no_recommendable_filter,
        rerank=not args.no_rerank,
    )
    _print_hits(args.query, hits)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
