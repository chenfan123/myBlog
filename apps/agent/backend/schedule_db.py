"""排班与医生结构化数据：PostgreSQL 模型、导入与查询。

表前缀 zy91_，与 myblog 等同库其他业务隔离。

用法:
    python -m backend.load_schedule_db
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Index, String, Text, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.config import PROJECT_ROOT
from backend.db import get_engine, get_session_factory

SCHEDULE_JSON = PROJECT_ROOT / "data" / "schedule" / "schedule.json"
DOCTORS_JSONL = PROJECT_ROOT / "data" / "schedule" / "doctors.jsonl"
LOAD_MANIFEST = PROJECT_ROOT / "data" / "schedule" / "db_manifest.json"


class Base(DeclarativeBase):
    pass


class Zy91Doctor(Base):
    __tablename__ = "zy91_doctors"

    site_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    doctor_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    dept_id: Mapped[str | None] = mapped_column(String(16), index=True)
    department_name: Mapped[str | None] = mapped_column(String(128), index=True)
    gender: Mapped[str | None] = mapped_column(String(8))
    education: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(64))
    profile: Mapped[str | None] = mapped_column(Text)
    specialty: Mapped[str | None] = mapped_column(Text)
    research: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(512))
    dept_ids: Mapped[list[str] | None] = mapped_column(JSON)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str | None] = mapped_column(Text)
    source_html: Mapped[str | None] = mapped_column(String(512))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Zy91ScheduleEntry(Base):
    """扁平化排班：每个 slot×doctor 一行；无医生时 doctor 字段为空。"""

    __tablename__ = "zy91_schedule_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    campus: Mapped[str] = mapped_column(String(32), index=True)
    clinic_type: Mapped[str] = mapped_column(String(32), index=True)
    department_name: Mapped[str] = mapped_column(String(128), index=True)
    period: Mapped[str | None] = mapped_column(String(16), index=True)
    weekday: Mapped[str | None] = mapped_column(String(16), index=True)
    schedule_text: Mapped[str | None] = mapped_column(String(128))
    site_id: Mapped[str | None] = mapped_column(String(16), index=True)
    doctor_id: Mapped[str | None] = mapped_column(String(32), index=True)
    doctor_name: Mapped[str | None] = mapped_column(String(64), index=True)
    badge: Mapped[str | None] = mapped_column(String(8))
    dept_id: Mapped[str | None] = mapped_column(String(16), index=True)
    source_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_zy91_schedule_dept_weekday_campus", "dept_id", "weekday", "campus"),
    )


def init_tables() -> None:
    Base.metadata.create_all(get_engine())


def _parse_generated_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _load_doctors(session: Session) -> dict[tuple[str, str], Zy91Doctor]:
    if not DOCTORS_JSONL.is_file():
        raise FileNotFoundError(f"缺少 {DOCTORS_JSONL}，请先运行 python -m backend.crawl_schedule")

    session.execute(delete(Zy91Doctor))
    now = datetime.now(timezone.utc)
    doctor_index: dict[tuple[str, str], Zy91Doctor] = {}

    for line in DOCTORS_JSONL.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        site_id = str(data.get("site_id", ""))
        doctor_id = str(data.get("doctor_id", ""))
        if not site_id or not doctor_id:
            continue
        row = Zy91Doctor(
            site_id=site_id,
            doctor_id=doctor_id,
            name=data.get("name") or "",
            dept_id=str(data["dept_id"]) if data.get("dept_id") is not None else None,
            department_name=data.get("department_name"),
            gender=data.get("gender"),
            education=data.get("education"),
            title=data.get("title"),
            profile=data.get("profile"),
            specialty=data.get("specialty"),
            research=data.get("research"),
            url=data.get("url"),
            dept_ids=[str(x) for x in data.get("dept_ids") or []] or None,
            ok=bool(data.get("ok", True)),
            error=data.get("error"),
            source_html=data.get("source_html"),
            updated_at=now,
        )
        session.add(row)
        doctor_index[(site_id, doctor_id)] = row

    return doctor_index


def _load_schedule_entries(session: Session, doctor_index: dict[tuple[str, str], Zy91Doctor]) -> int:
    if not SCHEDULE_JSON.is_file():
        raise FileNotFoundError(f"缺少 {SCHEDULE_JSON}，请先运行 python -m backend.crawl_schedule")

    payload = json.loads(SCHEDULE_JSON.read_text(encoding="utf-8"))
    generated_at = _parse_generated_at(payload.get("generated_at"))
    session.execute(delete(Zy91ScheduleEntry))

    count = 0
    for slot in payload.get("items", []):
        doctors = slot.get("doctors") or []
        if doctors:
            for doc in doctors:
                site_id = str(doc.get("site_id", ""))
                doctor_id = str(doc.get("doctor_id", ""))
                doctor_row = doctor_index.get((site_id, doctor_id))
                session.add(
                    Zy91ScheduleEntry(
                        campus=slot.get("campus") or "",
                        clinic_type=slot.get("clinic_type") or "",
                        department_name=slot.get("department_name") or "",
                        period=slot.get("period"),
                        weekday=slot.get("weekday"),
                        schedule_text=slot.get("schedule_text"),
                        site_id=site_id or None,
                        doctor_id=doctor_id or None,
                        doctor_name=doc.get("name"),
                        badge=doc.get("badge"),
                        dept_id=doctor_row.dept_id if doctor_row else None,
                        source_generated_at=generated_at,
                    )
                )
                count += 1
        else:
            session.add(
                Zy91ScheduleEntry(
                    campus=slot.get("campus") or "",
                    clinic_type=slot.get("clinic_type") or "",
                    department_name=slot.get("department_name") or "",
                    period=slot.get("period"),
                    weekday=slot.get("weekday"),
                    schedule_text=slot.get("schedule_text"),
                    site_id=None,
                    doctor_id=None,
                    doctor_name=None,
                    badge=None,
                    dept_id=None,
                    source_generated_at=generated_at,
                )
            )
            count += 1
    return count


def load_all() -> dict[str, Any]:
    init_tables()
    factory = get_session_factory()
    with factory() as session:
        doctor_index = _load_doctors(session)
        entry_count = _load_schedule_entries(session, doctor_index)
        session.commit()
        doctor_count = len(doctor_index)

    manifest = {
        "loaded_at": datetime.now(timezone.utc).isoformat(),
        "database_url": "<from env DATABASE_URL>",
        "doctors": doctor_count,
        "schedule_entries": entry_count,
        "source_schedule": str(SCHEDULE_JSON.relative_to(PROJECT_ROOT)),
        "source_doctors": str(DOCTORS_JSONL.relative_to(PROJECT_ROOT)),
    }
    LOAD_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def get_doctor_schedule(session: Session, *, name: str) -> list[dict[str, Any]]:
    stmt = (
        select(Zy91ScheduleEntry)
        .where(Zy91ScheduleEntry.doctor_name == name)
        .order_by(Zy91ScheduleEntry.weekday, Zy91ScheduleEntry.period, Zy91ScheduleEntry.campus)
    )
    return [_entry_to_dict(row) for row in session.scalars(stmt).all()]


def list_schedule_by_dept(
    session: Session,
    *,
    dept_id: str | None = None,
    department_name: str | None = None,
    dept_keyword: str | None = None,
    weekday: str | None = None,
    campus: str | None = None,
) -> list[dict[str, Any]]:
    stmt = select(Zy91ScheduleEntry)
    if dept_id:
        stmt = stmt.where(Zy91ScheduleEntry.dept_id == dept_id)
    if department_name:
        stmt = stmt.where(Zy91ScheduleEntry.department_name == department_name)
    elif dept_keyword:
        stmt = stmt.where(Zy91ScheduleEntry.department_name.contains(dept_keyword))
    if weekday:
        stmt = stmt.where(Zy91ScheduleEntry.weekday == weekday)
    if campus:
        stmt = stmt.where(Zy91ScheduleEntry.campus == campus)
    stmt = stmt.order_by(
        Zy91ScheduleEntry.weekday,
        Zy91ScheduleEntry.period,
        Zy91ScheduleEntry.doctor_name,
    )
    return [_entry_to_dict(row) for row in session.scalars(stmt).all()]


def get_doctor_by_name(session: Session, name: str) -> list[dict[str, Any]]:
    stmt = select(Zy91Doctor).where(Zy91Doctor.name == name)
    return [_doctor_to_dict(row) for row in session.scalars(stmt).all()]


def list_doctors_by_department(
    session: Session,
    *,
    keyword: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """按科室名关键词模糊查医生（PG），用于专家意图精确落科。"""
    kw = (keyword or "").strip()
    if not kw:
        return []
    stmt = (
        select(Zy91Doctor)
        .where(
            Zy91Doctor.ok.is_(True),
            Zy91Doctor.department_name.is_not(None),
            Zy91Doctor.department_name.contains(kw),
        )
        .order_by(Zy91Doctor.department_name, Zy91Doctor.name)
        .limit(limit)
    )
    return [_doctor_to_dict(row) for row in session.scalars(stmt).all()]


def _entry_to_dict(row: Zy91ScheduleEntry) -> dict[str, Any]:
    return {
        "campus": row.campus,
        "clinic_type": row.clinic_type,
        "department_name": row.department_name,
        "period": row.period,
        "weekday": row.weekday,
        "schedule_text": row.schedule_text,
        "doctor_id": row.doctor_id,
        "doctor_name": row.doctor_name,
        "badge": row.badge,
        "dept_id": row.dept_id,
    }


def _doctor_to_dict(row: Zy91Doctor) -> dict[str, Any]:
    return {
        "site_id": row.site_id,
        "doctor_id": row.doctor_id,
        "name": row.name,
        "dept_id": row.dept_id,
        "department_name": row.department_name,
        "title": row.title,
        "specialty": row.specialty,
        "profile": row.profile,
    }
