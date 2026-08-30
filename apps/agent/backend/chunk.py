"""将科室清洗 Markdown 自适应切分为 RAG Chunk。

知识库 pipeline 第三步：读取 data/clean/ 的 Markdown，按科室结构自动选择切分策略。
浙大一院清洗结果多为「科室简介 / 专科特色 / 科研教学」三小节，通常走 by_h2 策略。

用法（在项目根目录，需先跑过 clean）:
    python -m backend.chunk                  # 扁平切分 → chunks.jsonl
    python -m backend.chunk --hierarchical   # 分层切分 → chunks_hierarchical.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# 路径与切分参数
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CLEAN_MANIFEST = PROJECT_ROOT / "data" / "clean" / "manifest.json"
CHUNKS_DIR = PROJECT_ROOT / "data" / "chunks"
CHUNKS_JSONL = CHUNKS_DIR / "chunks.jsonl"
CHUNK_MANIFEST = CHUNKS_DIR / "manifest.json"

WHOLE_MAX_CHARS = 400
TARGET_CHUNK_CHARS = 600
MAX_CHUNK_CHARS = 900
MIN_CHUNK_CHARS = 120
OVERLAP_CHARS = 100

PLAIN_LABELS = (
    "科室概况",
    "专科特色",
    "科研教学",
    "科室简介",
    "技术特色",
    "人才梯队",
    "诊疗范围",
)
_LABEL_ALT = "|".join(re.escape(label) for label in PLAIN_LABELS)
STANDALONE_LABEL_RE = re.compile(rf"^({_LABEL_ALT})\s*$", re.MULTILINE)
INLINE_LABEL_RE = re.compile(rf"(?<=\S)\s+({_LABEL_ALT})(?=\s|$|\n)")
H2_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)
PAREN_HEADING_RE = re.compile(r"^（[一二三四五六七八九十百千]+）\s*(.*)$", re.MULTILINE)
TOP_NUMBERED_RE = re.compile(r"^(\d+)[、.]\s*(.*)$", re.MULTILINE)
SUB_NUMBERED_RE = re.compile(r"^\d+\.\d+")


@dataclass
class SectionBlock:
    """一切分单元：带小节标题与正文。"""

    section: str
    text: str


@dataclass
class ChunkRecord:
    """写入 JSONL 的一条 Chunk。"""

    chunk_id: str
    dept_id: str
    dept_name: str
    section: str
    chunk_index: int
    text: str
    char_count: int
    strategy: str
    source_md: str


@dataclass
class DeptChunkSummary:
    """科室级切分摘要。"""

    dept_id: str
    dept_name: str
    source_md: str
    strategy: str
    chunk_count: int
    total_chars: int
    ok: bool
    error: str | None = None


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """分离 YAML frontmatter 与正文。"""
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
    return meta, parts[2].lstrip("\n")


def _count_plain_labels(body: str) -> int:
    """统计独立行与行内小节标签出现次数。"""
    count = len(STANDALONE_LABEL_RE.findall(body))
    count += len(INLINE_LABEL_RE.findall(body))
    return count


def _normalize_plain_labels(body: str) -> str:
    """将行内/独立行小节标签统一为 ## 标题，便于按小节切分。"""
    lines: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if STANDALONE_LABEL_RE.fullmatch(stripped):
            lines.append(f"## {stripped}")
            lines.append("")
            continue
        normalized = INLINE_LABEL_RE.sub(r"\n\n## \1\n\n", line)
        lines.extend(normalized.splitlines())
    body = "\n".join(lines)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body


def detect_strategy(body: str) -> str:
    """根据正文结构选择主切分策略。"""
    text = body.strip()
    if len(text) <= WHOLE_MAX_CHARS:
        return "whole"
    if len(H2_RE.findall(text)) >= 2:
        return "by_h2"
    if _count_plain_labels(text) >= 2:
        return "by_plain_label"
    if len(PAREN_HEADING_RE.findall(text)) >= 2:
        return "by_paren"
    top_numbered = [
        m for m in TOP_NUMBERED_RE.finditer(text) if not SUB_NUMBERED_RE.match(m.group(0))
    ]
    if len(top_numbered) >= 3:
        return "by_numbered"
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip() and not p.strip().startswith("##")]
    max_para = max((len(p) for p in paragraphs), default=0)
    if max_para > 1000:
        return "by_fixed_size"
    return "by_paragraph"


def _split_by_h2(body: str) -> list[SectionBlock]:
    """按 ## 标题切分为小节块。"""
    matches = list(H2_RE.finditer(body))
    if not matches:
        return [SectionBlock(section="", text=body.strip())]
    blocks: list[SectionBlock] = []
    prefix = body[: matches[0].start()].strip()
    if prefix:
        blocks.append(SectionBlock(section="", text=prefix))
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        section_text = body[start:end].strip()
        if section_text:
            blocks.append(SectionBlock(section=match.group(1).strip(), text=section_text))
    return blocks


def _split_by_paren(body: str) -> list[SectionBlock]:
    """按（一）（二）子节切分。"""
    matches = list(PAREN_HEADING_RE.finditer(body))
    if len(matches) < 2:
        return [SectionBlock(section="", text=body.strip())]
    # 标题前的前言
    blocks: list[SectionBlock] = []
    prefix = body[: matches[0].start()].strip()
    if prefix:
        blocks.append(SectionBlock(section="", text=prefix))
    for index, match in enumerate(matches):
        title = match.group(0).split("\n", 1)[0].strip()
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        section_text = body[start:end].strip()
        if section_text:
            blocks.append(SectionBlock(section=title, text=section_text))
    return blocks


def _split_by_numbered(body: str) -> list[SectionBlock]:
    """按顶层 1、2、 编号项切分。"""
    # 去掉首个 ## 科室标题行
    lines = body.splitlines()
    if lines and lines[0].startswith("## "):
        body = "\n".join(lines[1:]).strip()

    matches = [
        m
        for m in TOP_NUMBERED_RE.finditer(body)
        if not SUB_NUMBERED_RE.match(m.group(0))
    ]
    if len(matches) < 3:
        return [SectionBlock(section="", text=body.strip())]

    blocks: list[SectionBlock] = []
    prefix = body[: matches[0].start()].strip()
    if prefix:
        blocks.append(SectionBlock(section="", text=prefix))

    for index, match in enumerate(matches):
        number = match.group(1)
        title_hint = match.group(2).strip()
        section_title = f"{number}、{title_hint[:40]}".rstrip("、")
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        section_text = body[start:end].strip()
        if section_text:
            blocks.append(SectionBlock(section=section_title, text=section_text))
    return blocks


def _split_by_paragraph(body: str) -> list[SectionBlock]:
    """按空行段落切分，去掉重复科室 ## 标题。"""
    lines = body.splitlines()
    if lines and lines[0].startswith("## "):
        body = "\n".join(lines[1:]).strip()
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
    return [SectionBlock(section="", text=p) for p in paragraphs]


def _split_fixed_size(text: str) -> list[str]:
    """固定长度滑窗切分，带 overlap。"""
    text = text.strip()
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + MAX_CHUNK_CHARS, len(text))
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - OVERLAP_CHARS, start + 1)
    return [c for c in chunks if c]


def _subsplit_block(block: SectionBlock) -> list[str]:
    """对过长小节做二次切分：编号 → 段落 → 固定长度。"""
    text = block.text.strip()
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]

    numbered = _split_by_numbered(text)
    if len(numbered) >= 2 and any(len(b.text) <= MAX_CHUNK_CHARS for b in numbered):
        parts: list[str] = []
        for sub in numbered:
            parts.extend(_subsplit_block(sub))
        return [p for p in parts if p]

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(paragraphs) >= 2:
        parts = []
        for para in paragraphs:
            parts.extend(_split_fixed_size(para) if len(para) > MAX_CHUNK_CHARS else [para])
        return [p for p in parts if p]

    return _split_fixed_size(text)


def _is_header_only(text: str) -> bool:
    """判断是否为仅标题、无实质正文的片段。"""
    stripped = text.strip()
    if len(stripped) >= 80:
        return False
    if STANDALONE_LABEL_RE.fullmatch(stripped):
        return True
    if stripped.endswith(("：", ":")) and len(stripped) < 40:
        return True
    if re.match(r"^[一二三四五六七八九十]+、", stripped) and len(stripped) < 40:
        return True
    return False


def _finalize_pairs(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """将仅含标题的短片段与下一段合并。"""
    if not pairs:
        return pairs
    result: list[tuple[str, str]] = []
    index = 0
    while index < len(pairs):
        section, text = pairs[index]
        if _is_header_only(text) and index + 1 < len(pairs):
            next_section, next_text = pairs[index + 1]
            merged_section = section or next_section
            result.append((merged_section, f"{text}\n\n{next_text}"))
            index += 2
            continue
        result.append((section, text))
        index += 1
    return result


def _merge_small_parts(parts: list[str]) -> list[str]:
    """合并过短相邻片段（同 section 内）。"""
    if not parts:
        return []
    merged: list[str] = []
    buffer = parts[0]
    for part in parts[1:]:
        if len(buffer) < MIN_CHUNK_CHARS and len(buffer) + len(part) + 1 <= MAX_CHUNK_CHARS:
            buffer = f"{buffer}\n\n{part}"
        else:
            merged.append(buffer)
            buffer = part
    merged.append(buffer)
    return merged


def _blocks_to_text_parts(blocks: list[SectionBlock]) -> list[tuple[str, str]]:
    """将 SectionBlock 列表展开为 (section, text) 对。"""
    result: list[tuple[str, str]] = []
    for block in blocks:
        parts = _subsplit_block(block)
        parts = _merge_small_parts(parts)
        for part in parts:
            result.append((block.section, part))
    return _finalize_pairs(result)


def chunk_body(body: str, *, strategy: str, dept_name: str) -> list[tuple[str, str]]:
    """按策略切分正文，返回 (section, text) 列表。"""
    body = body.strip()
    if strategy == "whole":
        return [("", body)]

    if strategy == "by_h2":
        blocks = _split_by_h2(body)
    elif strategy == "by_plain_label":
        normalized = _normalize_plain_labels(body)
        blocks = _split_by_h2(normalized)
        if len(blocks) <= 1:
            blocks = _split_by_paragraph(normalized)
    elif strategy == "by_paren":
        blocks = _split_by_paren(body)
    elif strategy == "by_numbered":
        blocks = _split_by_numbered(body)
    elif strategy == "by_fixed_size":
        lines = body.splitlines()
        if lines and lines[0].startswith("## "):
            body = "\n".join(lines[1:]).strip()
        texts = _split_fixed_size(body)
        return [("", t) for t in texts]
    else:
        blocks = _split_by_paragraph(body)

    pairs = _blocks_to_text_parts(blocks)
    if not pairs:
        return [("", body)]
    return _finalize_pairs(pairs)


def _format_chunk_text(dept_name: str, section: str, text: str) -> str:
    """为检索上下文补上科室名与小节标题。"""
    header_parts = [dept_name]
    if section:
        header_parts.append(section)
    header = " · ".join(header_parts)
    return f"【{header}】\n{text}"


def chunk_markdown_file(path: Path) -> tuple[list[ChunkRecord], str]:
    """切分单个科室 Markdown 文件。"""
    raw = path.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(raw)
    dept_id = meta.get("dept_id", path.stem.split("_", 1)[0])
    dept_name = meta.get("dept_name", path.stem)
    source_md = str(path.relative_to(PROJECT_ROOT))

    strategy = detect_strategy(body)
    pairs = chunk_body(body, strategy=strategy, dept_name=dept_name)

    records: list[ChunkRecord] = []
    for index, (section, text) in enumerate(pairs):
        formatted = _format_chunk_text(dept_name, section, text)
        records.append(
            ChunkRecord(
                chunk_id=f"{dept_id}_{index:03d}",
                dept_id=dept_id,
                dept_name=dept_name,
                section=section,
                chunk_index=index,
                text=formatted,
                char_count=len(formatted),
                strategy=strategy,
                source_md=source_md,
            )
        )
    return records, strategy


def chunk_all(
    *,
    clean_manifest_path: Path = CLEAN_MANIFEST,
    output_jsonl: Path = CHUNKS_JSONL,
    manifest_path: Path = CHUNK_MANIFEST,
) -> tuple[list[ChunkRecord], list[DeptChunkSummary]]:
    """批量切分：读 clean manifest → 写 JSONL + chunk manifest。"""
    if not clean_manifest_path.is_file():
        raise FileNotFoundError(f"缺少 clean manifest: {clean_manifest_path}，请先运行 python -m backend.clean")

    clean_data = json.loads(clean_manifest_path.read_text(encoding="utf-8"))
    items = [i for i in clean_data.get("items", []) if i.get("ok") and i.get("local_path")]
    if not items:
        raise RuntimeError("clean manifest 中没有成功的 Markdown 条目")

    CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
    all_chunks: list[ChunkRecord] = []
    summaries: list[DeptChunkSummary] = []

    for index, item in enumerate(items, start=1):
        dept_id = str(item["dept_id"])
        dept_name = item.get("dept_name", f"科室{dept_id}")
        source_md_rel = item["local_path"]
        md_path = PROJECT_ROOT / source_md_rel

        print(f"[{index}/{len(items)}] 切分 {dept_name}")
        try:
            if not md_path.is_file():
                raise FileNotFoundError(f"Markdown 不存在: {md_path}")
            records, strategy = chunk_markdown_file(md_path)
            all_chunks.extend(records)
            summaries.append(
                DeptChunkSummary(
                    dept_id=dept_id,
                    dept_name=dept_name,
                    source_md=source_md_rel,
                    strategy=strategy,
                    chunk_count=len(records),
                    total_chars=sum(r.char_count for r in records),
                    ok=True,
                )
            )
            print(f"  策略={strategy}, chunks={len(records)}")
        except (OSError, ValueError) as exc:
            summaries.append(
                DeptChunkSummary(
                    dept_id=dept_id,
                    dept_name=dept_name,
                    source_md=source_md_rel,
                    strategy="",
                    chunk_count=0,
                    total_chars=0,
                    ok=False,
                    error=str(exc),
                )
            )
            print(f"  ! 失败: {exc}")

    with output_jsonl.open("w", encoding="utf-8") as fh:
        for record in all_chunks:
            fh.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

    strategy_counts: dict[str, int] = {}
    for summary in summaries:
        if summary.ok:
            strategy_counts[summary.strategy] = strategy_counts.get(summary.strategy, 0) + 1

    payload = {
        "source_clean_manifest": str(clean_manifest_path.relative_to(PROJECT_ROOT)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_departments": len(summaries),
        "success": sum(1 for s in summaries if s.ok),
        "failed": sum(1 for s in summaries if not s.ok),
        "total_chunks": len(all_chunks),
        "strategy_distribution": strategy_counts,
        "items": [asdict(s) for s in summaries],
    }
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return all_chunks, summaries


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。全部成功返回 0；存在失败科室返回 1。"""
    parser = argparse.ArgumentParser(description="科室 Markdown 切分")
    parser.add_argument(
        "--hierarchical",
        action="store_true",
        help="分层切分（parent-child + context enhancement）→ chunks_hierarchical.jsonl",
    )
    args = parser.parse_args(argv)

    if args.hierarchical:
        from backend.hierarchical_chunk import (
            HIERARCHICAL_JSONL,
            HIERARCHICAL_MANIFEST,
            PARENTS_JSONL,
            chunk_all_hierarchical,
        )

        _, _, manifest = chunk_all_hierarchical()
        print("---")
        print(
            f"完成: {manifest['total_departments']} 科室, "
            f"{manifest['parent_chunks']} parent → PG, "
            f"{manifest['child_chunks']} child → Milvus"
        )
        print(f"Parents JSONL: {PARENTS_JSONL}")
        print(f"Children JSONL: {HIERARCHICAL_JSONL}")
        print(f"Manifest: {HIERARCHICAL_MANIFEST}")
        print("下一步: python -m backend.load_dept_parents")
        return 0

    chunks, summaries = chunk_all()
    success = sum(1 for s in summaries if s.ok)
    failed = [s for s in summaries if not s.ok]
    print("---")
    print(f"完成: 成功 {success}/{len(summaries)} 科室, 共 {len(chunks)} 个 Chunk")
    print(f"JSONL: {CHUNKS_JSONL}")
    print(f"Manifest: {CHUNK_MANIFEST}")
    if failed:
        print("失败科室:")
        for s in failed:
            print(f"  - {s.dept_name}: {s.error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
