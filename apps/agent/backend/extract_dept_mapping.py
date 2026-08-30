"""症状/疾病 → 科室 结构化映射：LLM 抽取与校验。

阶段四 LLM 抽取结构化映射：读取科室 Markdown，抽取症状/疾病→科室，
写入 PostgreSQL zy91_dept_mappings（主存储）。

用法:
    python -m backend.extract_dept_mapping              # 抽取 → PG
    python -m backend.embed --target mappings           # PG → Milvus
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, SystemMessage

from backend.config import PROJECT_ROOT, get_llm_settings
from backend.dept_whitelist import is_known_dept, is_recommendable_dept
from backend.llm import build_chat_model
from backend.mapping_db import save_all_mappings

CLEAN_MANIFEST = PROJECT_ROOT / "data" / "clean" / "manifest.json"
PARENTS_JSONL = PROJECT_ROOT / "data" / "chunks" / "dept_parents.jsonl"
MAPPINGS_DIR = PROJECT_ROOT / "data" / "mappings"
EXTRACTION_MANIFEST = MAPPINGS_DIR / "extraction_manifest.json"
RAW_EXTRACTIONS_DIR = MAPPINGS_DIR / "raw"

EntityType = Literal["symptom", "disease", "condition"]


class ExtractedMappingItem(BaseModel):
    """LLM 单条抽取结果。"""

    entity_type: EntityType = Field(description="symptom=症状, disease=疾病, condition=适应症/专病")
    keywords: list[str] = Field(
        min_length=1,
        description="患者可能使用的口语化表述，含近义词，2~6 个",
    )
    category_label: str = Field(description="亚专科/专病方向，如「胃肠肿瘤」「甲状腺结节」")
    source_section: str = Field(description="依据所在小节，如「专科特色」")
    evidence: str = Field(description="原文依据，20~80 字")
    confidence: float = Field(ge=0.0, le=1.0, description="抽取置信度 0~1")


class DeptExtractionResult(BaseModel):
    items: list[ExtractedMappingItem] = Field(default_factory=list)


@dataclass
class ParentSectionRef:
    chunk_id: str
    section: str
    header_path: list[str]
    text: str


@dataclass
class MappingRecord:
    mapping_id: str
    dept_id: str
    dept_name: str
    entity_type: str
    keywords: list[str]
    category_label: str
    source_chunk_id: str
    source_section: str
    source_md: str
    evidence: str
    confidence: float
    recommendable: bool
    validated: bool
    validation_notes: str | None
    extracted_at: str
    llm_model: str


SYSTEM_PROMPT = """你是医院导诊知识库的信息抽取专家。任务：从科室官网简介中抽取「患者可能因什么症状/疾病来挂这个科」的结构化条目。

严格要求：
1. 只抽取原文明确支持的内容，不要臆造科室未提及的疾病或症状。
2. keywords 用患者口语（如「肚子痛」「反酸烧心」），每条 2~6 个近义表述。
3. entity_type：symptom=症状描述，disease=具体疾病名，condition=适应症/专病/检查异常（如「甲状腺结节」「肺结节」）。
4. category_label 填亚专科方向；source_section 填依据小节名；evidence 引用原文关键句。
5. confidence：原文直接写明=0.9+，合理推断=0.7~0.85，较弱关联=0.5~0.69。
6. 科研教学、设备介绍、获奖荣誉不要抽取；专注「看什么病/什么症状」。
7. 每个科室尽量抽取 5~15 条，覆盖简介与专科特色中的诊疗范围。"""


def _stable_mapping_id(
    dept_id: str,
    keywords: list[str],
    entity_type: str,
    category_label: str,
) -> str:
    cleaned = sorted(k.strip() for k in keywords if k.strip())
    key = f"{dept_id}:{entity_type}:{category_label}:{','.join(cleaned)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


def _load_parent_index() -> dict[tuple[str, str], ParentSectionRef]:
    """dept_id + section -> parent chunk。"""
    index: dict[tuple[str, str], ParentSectionRef] = {}
    if not PARENTS_JSONL.is_file():
        return index
    for line in PARENTS_JSONL.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        dept_id = str(data["dept_id"])
        section = data.get("section") or ""
        index[(dept_id, section)] = ParentSectionRef(
            chunk_id=data["chunk_id"],
            section=section,
            header_path=data.get("header_path") or [],
            text=data.get("text") or "",
        )
    return index


def _read_dept_markdown(path: Path) -> tuple[dict[str, str], str]:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}, raw
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}, raw
    meta: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, parts[2].lstrip("\n")


def _match_source_chunk_id(
    parent_index: dict[tuple[str, str], ParentSectionRef],
    *,
    dept_id: str,
    source_section: str,
) -> str:
    ref = parent_index.get((dept_id, source_section))
    if ref:
        return ref.chunk_id
    # 模糊：section 包含关系
    for (did, section), pref in parent_index.items():
        if did == dept_id and section and section in source_section:
            return pref.chunk_id
    # 兜底：该科室第一个 parent
    for (did, _section), pref in parent_index.items():
        if did == dept_id:
            return pref.chunk_id
    return ""


def _validate_item(
    item: ExtractedMappingItem,
    *,
    dept_name: str,
    source_chunk_id: str,
) -> tuple[bool, str | None]:
    notes: list[str] = []
    if not is_known_dept(dept_name):
        notes.append(f"未知科室名: {dept_name}")
    cleaned_keywords = [k.strip() for k in item.keywords if k.strip()]
    if len(cleaned_keywords) < 1:
        notes.append("keywords 为空")
    if item.confidence < 0.5:
        notes.append("置信度过低")
    if not source_chunk_id:
        notes.append("未匹配 source_chunk_id")
    if not item.evidence or len(item.evidence) < 8:
        notes.append("evidence 过短")
    if notes:
        return False, "; ".join(notes)
    return True, None


def extract_one_department(
    *,
    dept_id: str,
    dept_name: str,
    md_path: Path,
    parent_index: dict[tuple[str, str], ParentSectionRef],
    llm_model_name: str,
) -> tuple[list[MappingRecord], dict[str, Any]]:
    meta, body = _read_dept_markdown(md_path)
    source_md = str(md_path.relative_to(PROJECT_ROOT))
    dept_name = meta.get("dept_name", dept_name)
    dept_id = str(meta.get("dept_id", dept_id))

    model = build_chat_model()
    structured = model.with_structured_output(DeptExtractionResult)

    user_prompt = f"""科室：{dept_name}（dept_id={dept_id}）

以下为该科室官网清洗后的 Markdown 正文，请抽取症状/疾病 → 科室映射条目：

---
{body}
---"""

    started = time.perf_counter()
    result: DeptExtractionResult = structured.invoke(
        [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
    )
    elapsed = time.perf_counter() - started

    now = datetime.now(timezone.utc).isoformat()
    records: list[MappingRecord] = []
    for item in result.items:
        keywords = [re.sub(r"\s+", " ", k.strip()) for k in item.keywords if k.strip()]
        if not keywords:
            continue
        source_chunk_id = _match_source_chunk_id(
            parent_index,
            dept_id=dept_id,
            source_section=item.source_section,
        )
        validated, notes = _validate_item(
            item,
            dept_name=dept_name,
            source_chunk_id=source_chunk_id,
        )
        records.append(
            MappingRecord(
                mapping_id=_stable_mapping_id(
                    dept_id, keywords, item.entity_type, item.category_label.strip()
                ),
                dept_id=dept_id,
                dept_name=dept_name,
                entity_type=item.entity_type,
                keywords=keywords,
                category_label=item.category_label.strip(),
                source_chunk_id=source_chunk_id,
                source_section=item.source_section.strip(),
                source_md=source_md,
                evidence=item.evidence.strip(),
                confidence=float(item.confidence),
                recommendable=is_recommendable_dept(dept_name),
                validated=validated,
                validation_notes=notes,
                extracted_at=now,
                llm_model=llm_model_name,
            )
        )

    meta_out = {
        "dept_id": dept_id,
        "dept_name": dept_name,
        "source_md": source_md,
        "item_count": len(records),
        "validated_count": sum(1 for r in records if r.validated),
        "elapsed_sec": round(elapsed, 2),
    }
    return records, meta_out


def extract_all(
    *,
    dept_ids: list[str] | None = None,
    limit: int | None = None,
    sleep_sec: float = 0.5,
) -> dict[str, Any]:
    if not CLEAN_MANIFEST.is_file():
        raise FileNotFoundError(f"缺少 {CLEAN_MANIFEST}")

    llm_settings = get_llm_settings()
    clean_data = json.loads(CLEAN_MANIFEST.read_text(encoding="utf-8"))
    items = [i for i in clean_data.get("items", []) if i.get("ok") and i.get("local_path")]
    if dept_ids:
        wanted = set(dept_ids)
        items = [i for i in items if str(i["dept_id"]) in wanted]
    if limit is not None:
        items = items[:limit]

    parent_index = _load_parent_index()
    MAPPINGS_DIR.mkdir(parents=True, exist_ok=True)
    RAW_EXTRACTIONS_DIR.mkdir(parents=True, exist_ok=True)

    all_records: list[MappingRecord] = []
    dept_summaries: list[dict[str, Any]] = []

    for index, item in enumerate(items, start=1):
        dept_id = str(item["dept_id"])
        dept_name = item.get("dept_name", f"科室{dept_id}")
        md_path = PROJECT_ROOT / item["local_path"]
        print(f"[{index}/{len(items)}] 抽取 {dept_name} …")
        try:
            records, summary = extract_one_department(
                dept_id=dept_id,
                dept_name=dept_name,
                md_path=md_path,
                parent_index=parent_index,
                llm_model_name=llm_settings.model,
            )
        except Exception as exc:
            print(f"  ✗ 失败: {exc}")
            dept_summaries.append(
                {
                    "dept_id": dept_id,
                    "dept_name": dept_name,
                    "ok": False,
                    "error": str(exc),
                }
            )
            continue

        all_records.extend(records)
        raw_path = RAW_EXTRACTIONS_DIR / f"{dept_id}_{dept_name}.json"
        raw_path.write_text(
            json.dumps([asdict(r) for r in records], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        dept_summaries.append({**summary, "ok": True})
        print(
            f"  ✓ {summary['item_count']} 条 "
            f"(校验通过 {summary['validated_count']}) "
            f"{summary['elapsed_sec']}s"
        )
        if sleep_sec > 0 and index < len(items):
            time.sleep(sleep_sec)

    pg_manifest = save_all_mappings([asdict(r) for r in all_records])

    validated_total = sum(1 for r in all_records if r.validated)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "llm_model": llm_settings.model,
        "llm_api_base": llm_settings.api_base,
        "source_clean_manifest": str(CLEAN_MANIFEST.relative_to(PROJECT_ROOT)),
        "total_departments": len(items),
        "success_departments": sum(1 for s in dept_summaries if s.get("ok")),
        "failed_departments": sum(1 for s in dept_summaries if not s.get("ok")),
        "total_mappings": len(all_records),
        "validated_mappings": validated_total,
        "recommendable_mappings": sum(1 for r in all_records if r.recommendable),
        "storage": "postgresql:zy91_dept_mappings",
        "pg_loaded_count": pg_manifest["mapping_count"],
        "items": dept_summaries,
    }
    EXTRACTION_MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LLM 抽取症状/疾病→科室结构化映射")
    parser.add_argument("--dept-id", action="append", help="仅抽取指定 dept_id，可重复")
    parser.add_argument("--limit", type=int, help="最多处理 N 个科室（试跑）")
    parser.add_argument("--sleep", type=float, default=0.5, help="科室间请求间隔秒数")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    manifest = extract_all(
        dept_ids=args.dept_id,
        limit=args.limit,
        sleep_sec=args.sleep,
    )
    print("---")
    print(
        f"完成: {manifest['success_departments']}/{manifest['total_departments']} 科室, "
        f"{manifest['total_mappings']} 条映射 → PG zy91_dept_mappings "
        f"(校验通过 {manifest['validated_mappings']})"
    )
    print(f"Manifest: {EXTRACTION_MANIFEST}")
    print("下一步: python -m backend.embed --target mappings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
