"""科室 Markdown 分层切块（Parent-Child + Context Enhancement）。

每个科室 Markdown → 文档树（## 小节）→ 每节 1 个 parent + N 个 child。
- parent：完整小节原文 → dept_parents.jsonl → PostgreSQL zy91_dept_parents
- child：细粒度片段 + embedding_text → chunks_hierarchical.jsonl → Milvus

用法（由 backend.chunk --hierarchical 调用）:
    python -m backend.chunk --hierarchical
    python -m backend.load_dept_parents
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CHUNKS_DIR = PROJECT_ROOT / "data" / "chunks"
HIERARCHICAL_JSONL = CHUNKS_DIR / "chunks_hierarchical.jsonl"
PARENTS_JSONL = CHUNKS_DIR / "dept_parents.jsonl"
HIERARCHICAL_MANIFEST = CHUNKS_DIR / "hierarchical_manifest.json"

# 与 chunk.py 对齐的长度参数
CHUNK_SIZE = 600
CHUNK_OVERLAP = 100
PARENT_CONTEXT_SIZE = 220

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
_BOUNDARY_RE = re.compile(r"\n\n+|(?<=[。！？!?；;])|\n")


@dataclass(frozen=True)
class HierarchicalConfig:
    chunk_size: int = CHUNK_SIZE
    chunk_overlap: int = CHUNK_OVERLAP
    parent_context_size: int = PARENT_CONTEXT_SIZE


@dataclass
class DocumentSection:
    title: str
    level: int
    header_path: list[str]
    content: str = ""
    start_index: int = 0
    children: list[DocumentSection] = field(default_factory=list)


@dataclass
class DeptParentRecord:
    """parent 完整小节，写入 PostgreSQL，不参与 Milvus 向量化。"""

    chunk_id: str
    doc_id: str
    dept_id: str
    dept_name: str
    level: int
    section: str
    header_path: list[str]
    text: str
    char_count: int
    source_md: str
    strategy: str = "hierarchical"


@dataclass
class HierarchicalChunkRecord:
    """child 片段，写入 Milvus。"""

    chunk_id: str
    doc_id: str
    dept_id: str
    dept_name: str
    parent_id: str
    level: int
    section: str
    header_path: list[str]
    text: str
    embedding_text: str
    char_count: int
    source_md: str
    strategy: str = "hierarchical"


def _stable_chunk_id(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
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


def analyze_document(text: str, *, root_title: str) -> DocumentSection:
    """解析 Markdown 标题树；无标题时全文作为根节点内容。"""
    root = DocumentSection(title=root_title, level=0, header_path=[root_title])
    matches = list(_HEADING_RE.finditer(text))
    if not matches:
        root.content = text.strip()
        return root

    root.content = text[: matches[0].start()].strip()
    stack: list[DocumentSection] = [root]
    for index, match in enumerate(matches):
        level = len(match.group(1))
        title = match.group(2).strip()
        content_start = match.end()
        content_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        while stack[-1].level >= level:
            stack.pop()
        parent = stack[-1]
        node = DocumentSection(
            title=title,
            level=level,
            header_path=[*parent.header_path, title],
            content=text[content_start:content_end].strip(),
            start_index=content_start,
        )
        parent.children.append(node)
        stack.append(node)
    return root


def _split_text(text: str, size: int, overlap: int) -> list[tuple[str, int, int]]:
    text = text.strip()
    if not text:
        return []
    chunks: list[tuple[str, int, int]] = []
    start = 0
    while start < len(text):
        hard_end = min(start + size, len(text))
        end = hard_end
        if hard_end < len(text):
            candidates = [m.end() for m in _BOUNDARY_RE.finditer(text, start, hard_end)]
            useful = [pos for pos in candidates if pos >= start + size // 2]
            if useful:
                end = useful[-1]
        chunk = text[start:end].strip()
        if chunk:
            actual_start = text.find(chunk, start, end)
            chunks.append((chunk, actual_start, actual_start + len(chunk)))
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks


def _iter_sections(root: DocumentSection) -> Iterable[DocumentSection]:
    yield root
    for child in root.children:
        yield from _iter_sections(child)


def _build_child_embedding_text(
    *,
    header_path: list[str],
    dept_name: str,
    parent_context: str,
    body: str,
) -> str:
    path_text = " > ".join(header_path) or dept_name
    return (
        f"科室：{dept_name}\n"
        f"标题路径：{path_text}\n"
        f"章节上下文：{parent_context}\n"
        f"当前内容：{body}"
    )


def chunk_markdown_hierarchical(
    path: Path,
    *,
    config: HierarchicalConfig | None = None,
) -> tuple[list[DeptParentRecord], list[HierarchicalChunkRecord]]:
    """对单个科室 Markdown 做分层切块，返回 (parents, children)。"""
    config = config or HierarchicalConfig()
    raw = path.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(raw)
    dept_id = meta.get("dept_id", path.stem.split("_", 1)[0])
    dept_name = meta.get("dept_name", path.stem)
    source_md = str(path.relative_to(PROJECT_ROOT))
    doc_id = str(dept_id)

    root = analyze_document(body, root_title=dept_name)
    parents: list[DeptParentRecord] = []
    children: list[HierarchicalChunkRecord] = []

    for section_no, section in enumerate(_iter_sections(root)):
        if not section.content:
            continue
        path_text = " > ".join(section.header_path) or dept_name
        section_label = section.title if section.level > 0 else ""
        parent_key = f"{doc_id}:section:{section_no}:{path_text}"
        parent_chunk_id = _stable_chunk_id(parent_key)
        parent_full_text = section.content

        parents.append(
            DeptParentRecord(
                chunk_id=parent_chunk_id,
                doc_id=doc_id,
                dept_id=dept_id,
                dept_name=dept_name,
                level=section.level,
                section=section_label,
                header_path=section.header_path,
                text=parent_full_text,
                char_count=len(parent_full_text),
                source_md=source_md,
            )
        )

        parent_context = parent_full_text[: config.parent_context_size]
        for child_no, (child_text, _rel_start, _rel_end) in enumerate(
            _split_text(section.content, config.chunk_size, config.chunk_overlap)
        ):
            child_key = f"{parent_chunk_id}:child:{child_no}"
            child_chunk_id = _stable_chunk_id(child_key)
            child_embed = _build_child_embedding_text(
                header_path=section.header_path,
                dept_name=dept_name,
                parent_context=parent_context,
                body=child_text,
            )
            children.append(
                HierarchicalChunkRecord(
                    chunk_id=child_chunk_id,
                    doc_id=doc_id,
                    dept_id=dept_id,
                    dept_name=dept_name,
                    parent_id=parent_chunk_id,
                    level=section.level + 1,
                    section=section_label,
                    header_path=section.header_path,
                    text=child_text,
                    embedding_text=child_embed,
                    char_count=len(child_embed),
                    source_md=source_md,
                )
            )
    return parents, children


def chunk_all_hierarchical(
    *,
    clean_manifest_path: Path = PROJECT_ROOT / "data" / "clean" / "manifest.json",
    output_jsonl: Path = HIERARCHICAL_JSONL,
    manifest_path: Path = HIERARCHICAL_MANIFEST,
    config: HierarchicalConfig | None = None,
) -> tuple[list[DeptParentRecord], list[HierarchicalChunkRecord], dict]:
    if not clean_manifest_path.is_file():
        raise FileNotFoundError(f"缺少 clean manifest: {clean_manifest_path}")

    clean_data = json.loads(clean_manifest_path.read_text(encoding="utf-8"))
    items = [i for i in clean_data.get("items", []) if i.get("ok") and i.get("local_path")]
    if not items:
        raise RuntimeError("clean manifest 中没有成功的 Markdown 条目")

    CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
    all_parents: list[DeptParentRecord] = []
    all_children: list[HierarchicalChunkRecord] = []
    dept_summaries: list[dict] = []

    for index, item in enumerate(items, start=1):
        dept_id = str(item["dept_id"])
        dept_name = item.get("dept_name", f"科室{dept_id}")
        md_path = PROJECT_ROOT / item["local_path"]
        print(f"[{index}/{len(items)}] 分层切分 {dept_name}")
        parents, children = chunk_markdown_hierarchical(md_path, config=config)
        all_parents.extend(parents)
        all_children.extend(children)
        dept_summaries.append(
            {
                "dept_id": dept_id,
                "dept_name": dept_name,
                "source_md": item["local_path"],
                "parent_count": len(parents),
                "child_count": len(children),
                "total": len(parents) + len(children),
            }
        )
        print(f"  parent={len(parents)}, child={len(children)}")

    with PARENTS_JSONL.open("w", encoding="utf-8") as fh:
        for record in all_parents:
            fh.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

    with output_jsonl.open("w", encoding="utf-8") as fh:
        for record in all_children:
            fh.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

    manifest = {
        "source_clean_manifest": str(clean_manifest_path.relative_to(PROJECT_ROOT)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "strategy": "hierarchical",
        "chunk_size": (config or HierarchicalConfig()).chunk_size,
        "chunk_overlap": (config or HierarchicalConfig()).chunk_overlap,
        "parent_context_size": (config or HierarchicalConfig()).parent_context_size,
        "total_departments": len(dept_summaries),
        "parent_chunks": len(all_parents),
        "child_chunks": len(all_children),
        "parent_jsonl": str(PARENTS_JSONL.relative_to(PROJECT_ROOT)),
        "child_jsonl": str(output_jsonl.relative_to(PROJECT_ROOT)),
        "parent_storage": "postgresql:zy91_dept_parents",
        "child_storage": "milvus:dept_chunks_hierarchical",
        "items": dept_summaries,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return all_parents, all_children, manifest


def main() -> int:
    _parents, _children, manifest = chunk_all_hierarchical()
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


if __name__ == "__main__":
    raise SystemExit(main())
