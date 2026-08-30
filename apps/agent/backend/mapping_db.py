"""症状/疾病→科室 结构化映射：PostgreSQL 为主存储。

Pipeline:
    extract_dept_mapping  →  zy91_dept_mappings（PG）
    embed --target mappings  ←  PG 读取 → Milvus dept_symptom_mappings
    BM25/lexical 检索        ←  PG 库内 keywords 匹配（search_mappings_lexical，仅 Top-K）

用法:
    python -m backend.extract_dept_mapping
    python -m backend.embed --target mappings
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, String, Text, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.config import PROJECT_ROOT
from backend.db import get_engine, get_session_factory
from backend.mapping_bm25 import search_mappings_lexical

# 仅用于从旧 JSONL 一次性迁移；正常运行不依赖此文件
LEGACY_MAPPINGS_JSONL = PROJECT_ROOT / "data" / "mappings" / "dept_symptom_mapping.jsonl"
LOAD_MANIFEST = PROJECT_ROOT / "data" / "mappings" / "db_manifest.json"

_ENTITY_TYPE_LABEL = {
    "symptom": "症状",
    "disease": "疾病",
    "condition": "专病",
}


class Base(DeclarativeBase):
    pass


class Zy91DeptMapping(Base):
    __tablename__ = "zy91_dept_mappings"

    mapping_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    dept_id: Mapped[str] = mapped_column(String(16), index=True)
    dept_name: Mapped[str] = mapped_column(String(128), index=True)
    entity_type: Mapped[str] = mapped_column(String(16), index=True)
    keywords: Mapped[list[str]] = mapped_column(JSON)
    category_label: Mapped[str] = mapped_column(String(128), default="")
    source_chunk_id: Mapped[str | None] = mapped_column(String(32), index=True)
    source_section: Mapped[str | None] = mapped_column(String(128))
    source_md: Mapped[str | None] = mapped_column(String(512))
    evidence: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    recommendable: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    validated: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    validation_notes: Mapped[str | None] = mapped_column(Text)
    llm_model: Mapped[str | None] = mapped_column(String(64))
    extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_zy91_dept_mappings_dept_entity", "dept_id", "entity_type"),
    )


def init_tables() -> None:
    Base.metadata.create_all(get_engine())


def build_mapping_embedding_text(record: dict[str, Any]) -> str:
    """构造映射条目的 embedding 输入文本。"""
    keywords = record.get("keywords") or []
    kw_text = "、".join(keywords)
    entity_type = record.get("entity_type", "condition")
    type_label = _ENTITY_TYPE_LABEL.get(entity_type, entity_type)
    return (
        f"{type_label}：{kw_text}\n"
        f"推荐科室：{record.get('dept_name', '')}\n"
        f"方向：{record.get('category_label', '')}\n"
        f"依据：{record.get('evidence', '')}"
    )


def _parse_extracted_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _row_from_dict(data: dict[str, Any], *, updated_at: datetime) -> Zy91DeptMapping:
    return Zy91DeptMapping(
        mapping_id=data["mapping_id"],
        dept_id=str(data["dept_id"]),
        dept_name=data["dept_name"],
        entity_type=data["entity_type"],
        keywords=data.get("keywords") or [],
        category_label=data.get("category_label") or "",
        source_chunk_id=data.get("source_chunk_id") or None,
        source_section=data.get("source_section") or None,
        source_md=data.get("source_md"),
        evidence=data["evidence"],
        confidence=float(data.get("confidence", 0)),
        recommendable=bool(data.get("recommendable", True)),
        validated=bool(data.get("validated", True)),
        validation_notes=data.get("validation_notes"),
        llm_model=data.get("llm_model"),
        extracted_at=_parse_extracted_at(data.get("extracted_at")),
        updated_at=updated_at,
    )


def save_mappings(session: Session, records: list[dict[str, Any]]) -> int:
    """全量替换 zy91_dept_mappings。"""
    session.execute(delete(Zy91DeptMapping))
    now = datetime.now(timezone.utc)
    for data in records:
        session.add(_row_from_dict(data, updated_at=now))
    return len(records)


def save_all_mappings(records: list[dict[str, Any]]) -> dict[str, Any]:
    init_tables()
    factory = get_session_factory()
    with factory() as session:
        count = save_mappings(session, records)
        session.commit()

    manifest = {
        "loaded_at": datetime.now(timezone.utc).isoformat(),
        "mapping_count": count,
        "table": "zy91_dept_mappings",
        "source": "extract_pipeline",
    }
    LOAD_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def load_mappings_from_jsonl(
    session: Session,
    *,
    path: Path = LEGACY_MAPPINGS_JSONL,
) -> int:
    """从旧 JSONL 迁移（仅兼容/补救，非常规路径）。"""
    if not path.is_file():
        raise FileNotFoundError(f"缺少 {path}")

    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return save_mappings(session, records)


def load_all(*, path: Path = LEGACY_MAPPINGS_JSONL) -> dict[str, Any]:
    """从 JSONL 导入 PG（legacy 命令，常规请走 extract 自动入库）。"""
    init_tables()
    factory = get_session_factory()
    with factory() as session:
        count = load_mappings_from_jsonl(session, path=path)
        session.commit()

    manifest = {
        "loaded_at": datetime.now(timezone.utc).isoformat(),
        "mapping_count": count,
        "source_jsonl": str(path.relative_to(PROJECT_ROOT)),
        "table": "zy91_dept_mappings",
    }
    LOAD_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def count_mappings(session: Session) -> int:
    return len(session.scalars(select(Zy91DeptMapping)).all())


def list_mappings_for_embed(
    session: Session,
    *,
    validated_only: bool = True,
) -> list[dict[str, Any]]:
    """从 PG 读取映射，供 Milvus 向量化。"""
    stmt = select(Zy91DeptMapping)
    if validated_only:
        stmt = stmt.where(Zy91DeptMapping.validated.is_(True))
    stmt = stmt.order_by(Zy91DeptMapping.dept_id, Zy91DeptMapping.mapping_id)

    results: list[dict[str, Any]] = []
    for row in session.scalars(stmt).all():
        item = _mapping_to_dict(row)
        item["embedding_text"] = build_mapping_embedding_text(item)
        results.append(item)
    return results


def fetch_mappings_for_embed(*, validated_only: bool = True) -> list[dict[str, Any]]:
    init_tables()
    factory = get_session_factory()
    with factory() as session:
        rows = list_mappings_for_embed(session, validated_only=validated_only)
        if not rows:
            raise RuntimeError(
                "zy91_dept_mappings 为空，请先运行 python -m backend.extract_dept_mapping"
            )
        return rows


def _normalize_query(text: str) -> str:
    return re.sub(r"\s+", "", text.strip().lower())


def search_mappings_by_keywords(
    session: Session,
    query: str,
    *,
    top_k: int = 10,
    recommendable_only: bool = True,
    validated_only: bool = True,
    min_confidence: float = 0.5,
) -> list[dict[str, Any]]:
    """PostgreSQL 库内 lexical 检索（混合检索第②路，仅返回 Top-K）。

    实现见 backend.mapping_bm25.search_mappings_lexical；保留函数名兼容 retriever。
    """
    return search_mappings_lexical(
        session,
        query,
        top_k=top_k,
        recommendable_only=recommendable_only,
        validated_only=validated_only,
        min_confidence=min_confidence,
    )


def _mapping_to_dict(row: Zy91DeptMapping) -> dict[str, Any]:
    return {
        "mapping_id": row.mapping_id,
        "dept_id": row.dept_id,
        "dept_name": row.dept_name,
        "entity_type": row.entity_type,
        "keywords": row.keywords or [],
        "category_label": row.category_label,
        "source_chunk_id": row.source_chunk_id or "",
        "source_section": row.source_section or "",
        "source_md": row.source_md,
        "evidence": row.evidence,
        "confidence": row.confidence,
        "recommendable": row.recommendable,
        "validated": row.validated,
        "llm_model": row.llm_model,
    }
