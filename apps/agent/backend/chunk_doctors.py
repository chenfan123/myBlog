"""将医生详情合成为 RAG Chunk（每人一条）。

知识库 pipeline：读取 data/schedule/doctors.jsonl，生成 data/chunks/doctors.jsonl，
供向量化写入 Milvus doctor_profiles。

用法（在项目根目录，需先跑过 crawl_schedule）:
    python -m backend.chunk_doctors
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOCTORS_JSONL = PROJECT_ROOT / "data" / "schedule" / "doctors.jsonl"
CHUNKS_DIR = PROJECT_ROOT / "data" / "chunks"
DOCTOR_CHUNKS_JSONL = CHUNKS_DIR / "doctors.jsonl"
DOCTOR_CHUNK_MANIFEST = CHUNKS_DIR / "doctors_manifest.json"


@dataclass
class DoctorChunkRecord:
    chunk_id: str
    doctor_id: str
    name: str
    dept_id: str
    dept_name: str
    title: str
    text: str
    char_count: int
    has_schedule: bool
    source: str


def _format_schedule_slots(doctor: dict) -> str:
    slots = doctor.get("schedule_page_slots") or doctor.get("outpatient_slots") or []
    if not slots:
        return "暂无公开出诊信息"
    parts: list[str] = []
    for slot in slots:
        if "weekday" in slot:
            campus = slot.get("campus", "")
            period = slot.get("period", "")
            clinic = slot.get("clinic_type", "")
            dept = slot.get("department_name", doctor.get("department_name", ""))
            label = " ".join(x for x in [campus, dept, slot.get("weekday", ""), period, clinic] if x)
            parts.append(label.strip())
        else:
            time_label = slot.get("time", "")
            location = slot.get("location", "")
            parts.append(" ".join(x for x in [location, time_label] if x))
    # 去重并保持顺序
    seen: set[str] = set()
    unique: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.add(part)
            unique.append(part)
    return "；".join(unique)


def build_doctor_text(doctor: dict) -> str:
    dept_name = doctor.get("department_name") or "未知科室"
    name = doctor.get("name") or "未知医生"
    title = doctor.get("title") or "职称未知"
    header = f"【{dept_name} · {name} · {title}】"

    meta_parts: list[str] = []
    if doctor.get("gender"):
        meta_parts.append(f"性别：{doctor['gender']}")
    if doctor.get("education"):
        meta_parts.append(f"学历：{doctor['education']}")
    meta_line = " | ".join(meta_parts)

    sections: list[str] = [header]
    if meta_line:
        sections.append(meta_line)
    if doctor.get("specialty"):
        sections.append(f"擅长：{doctor['specialty']}")
    if doctor.get("profile"):
        sections.append(f"简介：{doctor['profile']}")
    if doctor.get("research"):
        sections.append(f"研究方向：{doctor['research']}")
    sections.append(f"出诊：{_format_schedule_slots(doctor)}")
    return "\n".join(sections)


def chunk_doctor_record(doctor: dict) -> DoctorChunkRecord | None:
    if not doctor.get("ok", True):
        return None
    doctor_id = str(doctor.get("doctor_id", "")).strip()
    if not doctor_id:
        return None

    dept_id = str(doctor.get("dept_id") or (doctor.get("dept_ids") or [""])[0])
    dept_name = doctor.get("department_name") or ""
    name = doctor.get("name") or ""
    title = doctor.get("title") or ""
    text = build_doctor_text(doctor)
    slots = doctor.get("schedule_page_slots") or doctor.get("outpatient_slots") or []

    return DoctorChunkRecord(
        chunk_id=f"doctor_{doctor_id}",
        doctor_id=doctor_id,
        name=name,
        dept_id=dept_id,
        dept_name=dept_name,
        title=title,
        text=text,
        char_count=len(text),
        has_schedule=bool(slots),
        source="data/schedule/doctors.jsonl",
    )


def chunk_all(
    *,
    doctors_path: Path = DOCTORS_JSONL,
    output_jsonl: Path = DOCTOR_CHUNKS_JSONL,
    manifest_path: Path = DOCTOR_CHUNK_MANIFEST,
) -> tuple[list[DoctorChunkRecord], dict]:
    if not doctors_path.is_file():
        raise FileNotFoundError(
            f"缺少 doctors 文件: {doctors_path}，请先运行 python -m backend.crawl_schedule"
        )

    records: list[DoctorChunkRecord] = []
    skipped = 0
    for line in doctors_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        doctor = json.loads(line)
        record = chunk_doctor_record(doctor)
        if record is None:
            skipped += 1
            continue
        records.append(record)

    if not records:
        raise RuntimeError("没有可用的医生 Chunk")

    CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
    with output_jsonl.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

    with_schedule = sum(1 for r in records if r.has_schedule)
    manifest = {
        "source_doctors": str(doctors_path.relative_to(PROJECT_ROOT)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_doctors": len(records),
        "skipped": skipped,
        "with_schedule": with_schedule,
        "avg_char_count": round(sum(r.char_count for r in records) / len(records)),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return records, manifest


def main() -> int:
    records, manifest = chunk_all()
    print("---")
    print(f"完成: {manifest['total_doctors']} 位医生 Chunk（跳过 {manifest['skipped']}）")
    print(f"含出诊信息: {manifest['with_schedule']}")
    print(f"JSONL: {DOCTOR_CHUNKS_JSONL}")
    print(f"Manifest: {DOCTOR_CHUNK_MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
