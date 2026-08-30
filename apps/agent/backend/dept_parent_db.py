"""科室分层 parent 块：PostgreSQL 存储与查询。

parent 存完整小节原文，child 向量在 Milvus；检索 child 后按 parent_id 回查。

用法:
    python -m backend.load_dept_parents
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.config import PROJECT_ROOT
from backend.db import get_engine, get_session_factory

PARENTS_JSONL = PROJECT_ROOT / "data" / "chunks" / "dept_parents.jsonl"
LOAD_MANIFEST = PROJECT_ROOT / "data" / "chunks" / "dept_parents_db_manifest.json"


class Base(DeclarativeBase):
    pass


class Zy91DeptParent(Base):
    """科室 Markdown 分层切块中的 parent（整节原文，不参与向量检索）。"""

    __tablename__ = "zy91_dept_parents"

    chunk_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    doc_id: Mapped[str] = mapped_column(String(32), index=True)
    dept_id: Mapped[str] = mapped_column(String(16), index=True)
    dept_name: Mapped[str] = mapped_column(String(128), index=True)
    section: Mapped[str] = mapped_column(String(128), default="")
    level: Mapped[int] = mapped_column(Integer, default=0)
    header_path: Mapped[list[str] | None] = mapped_column(JSON)
    text: Mapped[str] = mapped_column(Text)
    source_md: Mapped[str | None] = mapped_column(String(512))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_zy91_dept_parents_dept_section", "dept_id", "section"),)


def init_tables() -> None:
    Base.metadata.create_all(get_engine())


def load_parents_from_jsonl(
    session: Session,
    *,
    path: Path = PARENTS_JSONL,
) -> int:
    """全量替换 zy91_dept_parents（与 load_schedule_db 策略一致）。"""
    if not path.is_file():
        raise FileNotFoundError(
            f"缺少 {path}，请先运行 python -m backend.chunk --hierarchical"
        )

    session.execute(delete(Zy91DeptParent))
    now = datetime.now(timezone.utc)
    count = 0

    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        session.add(
            Zy91DeptParent(
                chunk_id=data["chunk_id"],
                doc_id=data["doc_id"],
                dept_id=str(data["dept_id"]),
                dept_name=data["dept_name"],
                section=data.get("section") or "",
                level=int(data.get("level", 0)),
                header_path=data.get("header_path") or [],
                text=data["text"],
                source_md=data.get("source_md"),
                updated_at=now,
            )
        )
        count += 1

    return count


def load_all(*, path: Path = PARENTS_JSONL) -> dict[str, Any]:
    init_tables()
    factory = get_session_factory()
    with factory() as session:
        count = load_parents_from_jsonl(session, path=path)
        session.commit()

    manifest = {
        "loaded_at": datetime.now(timezone.utc).isoformat(),
        "database_url": "<from env DATABASE_URL>",
        "parent_count": count,
        "source_jsonl": str(path.relative_to(PROJECT_ROOT)),
        "table": "zy91_dept_parents",
    }
    LOAD_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def get_dept_parent(session: Session, parent_id: str) -> dict[str, Any] | None:
    row = session.get(Zy91DeptParent, parent_id)
    return _parent_to_dict(row) if row else None


def get_dept_parents_by_ids(
    session: Session,
    parent_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not parent_ids:
        return {}
    stmt = select(Zy91DeptParent).where(Zy91DeptParent.chunk_id.in_(parent_ids))
    return {row.chunk_id: _parent_to_dict(row) for row in session.scalars(stmt).all()}


def _parent_to_dict(row: Zy91DeptParent) -> dict[str, Any]:
    return {
        "chunk_id": row.chunk_id,
        "doc_id": row.doc_id,
        "dept_id": row.dept_id,
        "dept_name": row.dept_name,
        "section": row.section,
        "level": row.level,
        "header_path": row.header_path or [],
        "text": row.text,
        "source_md": row.source_md,
    }
