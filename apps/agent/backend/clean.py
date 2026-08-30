"""将科室原始 HTML 清洗为 Markdown 正文。

知识库 pipeline 第二步：读取 data/raw/ 的 HTML，抽取科室简介/专科特色/科研教学，
按科室写出 data/clean/departments/*.md。不做 Chunk 切分。

数据源：浙江大学医学院附属第一医院 https://www.zy91.com/department

用法（在项目根目录，需先跑过 crawl）:
    python -m backend.clean
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_MANIFEST = PROJECT_ROOT / "data" / "raw" / "manifest.json"
CLEAN_DIR = PROJECT_ROOT / "data" / "clean"
CLEAN_DEPARTMENTS_DIR = CLEAN_DIR / "departments"
CLEAN_MANIFEST = CLEAN_DIR / "manifest.json"

# 页面小节标题（非科室名）
SECTION_LABELS = frozenset(
    {
        "科室简介",
        "专科特色",
        "科研教学",
        "院内位置",
        "人才荟萃",
        "患者服务",
        "预约挂号",
        "门诊安排",
    }
)

TITLE_SUFFIX_RE = re.compile(r"\s*[-|｜]\s*浙江大学医学院附属第一医院\s*$")


@dataclass
class CleanedDepartment:
    dept_id: str
    dept_name: str
    source_url: str
    source_html: str
    markdown: str
    char_count: int


@dataclass
class CleanManifestEntry:
    dept_id: str
    dept_name: str
    source_url: str
    source_html: str
    local_path: str | None
    char_count: int
    cleaned_at: str
    ok: bool
    error: str | None = None


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\s]+", "_", name.strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "unknown"


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _parse_dept_name(soup: BeautifulSoup, fallback: str) -> str:
    """从详情页解析科室名：优先非小节标题的 h3。"""
    for h3 in soup.find_all("h3"):
        name = _normalize_text(h3.get_text())
        if name and name not in SECTION_LABELS and len(name) <= 40:
            return name
    title_tag = soup.find("title")
    if title_tag:
        title = TITLE_SUFFIX_RE.sub("", title_tag.get_text(strip=True))
        if title and title not in SECTION_LABELS:
            return title
    return fallback


def _node_to_paragraphs(node: Tag) -> list[str]:
    """将内容节点转为段落列表。"""
    paragraphs: list[str] = []
    for child in node.descendants:
        if isinstance(child, Tag) and child.name == "p":
            text = _normalize_text(child.get_text())
            if text:
                paragraphs.append(text)
    if paragraphs:
        return paragraphs
    text = _normalize_text(node.get_text("\n"))
    if not text:
        return []
    parts = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    return parts or [text]


def _extract_section(soup: BeautifulSoup, heading: str) -> str | None:
    """按小节标题抽取正文（科室简介 / 专科特色 / 科研教学）。"""
    if heading == "科室简介":
        block = soup.select_one("div.row-kshD1-1027")
        if block:
            info = block.select_one("div.info") or block
            paras = _node_to_paragraphs(info)
            if paras:
                return "\n\n".join(paras)
    if heading == "专科特色":
        block = soup.select_one("div.row-kshD3-d div.txt")
        if block:
            paras = _node_to_paragraphs(block)
            if paras:
                return "\n\n".join(paras)
    if heading == "科研教学":
        block = soup.select_one("div.row-kshD4-d div.kshD-desc, div.row-kshD4-d div.con")
        if block:
            paras = _node_to_paragraphs(block)
            if paras:
                return "\n\n".join(paras)

    # 回退：按 h3/h4 标题定位相邻内容
    for tag_name in ("h3", "h4"):
        for h in soup.find_all(tag_name):
            if _normalize_text(h.get_text()) != heading:
                continue
            parent = h.find_parent("div")
            if parent is None:
                continue
            content = parent.select_one("div.txt, div.info, div.con, div.kshD-desc")
            if content:
                paras = _node_to_paragraphs(content)
                if paras:
                    return "\n\n".join(paras)
    return None


def _html_to_markdown_body(soup: BeautifulSoup, dept_name: str) -> str:
    """抽取科室简介、专科特色、科研教学，转为 Markdown。"""
    sections: list[tuple[str, str]] = []
    for heading in ("科室简介", "专科特色", "科研教学"):
        body = _extract_section(soup, heading)
        if body:
            sections.append((heading, body))

    if not sections:
        # 最后回退：取专科特色区块或主内容区
        fallback = soup.select_one("div.row-kshD3-d div.txt, div.main div.txt")
        if fallback:
            paras = _node_to_paragraphs(fallback)
            if paras:
                sections.append(("专科特色", "\n\n".join(paras)))

    if not sections:
        raise ValueError("未找到可抽取的正文小节")

    lines: list[str] = []
    for heading, body in sections:
        lines.append(f"## {heading}")
        lines.append("")
        lines.append(body)
        lines.append("")

    return "\n".join(lines).strip()


def extract_from_html(html: str, *, dept_id: str, fallback_name: str, source_url: str) -> CleanedDepartment:
    soup = BeautifulSoup(html, "lxml")
    dept_name = _parse_dept_name(soup, fallback_name)
    body = _html_to_markdown_body(soup, dept_name)
    if len(body) < 80:
        raise ValueError("正文过短，可能抽取失败")

    return CleanedDepartment(
        dept_id=dept_id,
        dept_name=dept_name,
        source_url=source_url,
        source_html="",
        markdown=body,
        char_count=len(body),
    )


def _build_markdown_file(cleaned: CleanedDepartment, source_html_rel: str, cleaned_at: str) -> str:
    frontmatter = "\n".join(
        [
            "---",
            f"dept_id: {cleaned.dept_id}",
            f"dept_name: {cleaned.dept_name}",
            f"source_url: {cleaned.source_url}",
            f"source_html: {source_html_rel}",
            f"cleaned_at: {cleaned_at}",
            f"char_count: {cleaned.char_count}",
            "---",
            "",
        ]
    )
    return frontmatter + cleaned.markdown + "\n"


def clean_all(
    *,
    raw_manifest_path: Path = RAW_MANIFEST,
    output_dir: Path = CLEAN_DEPARTMENTS_DIR,
    manifest_path: Path = CLEAN_MANIFEST,
) -> list[CleanManifestEntry]:
    if not raw_manifest_path.is_file():
        raise FileNotFoundError(f"缺少 raw manifest: {raw_manifest_path}，请先运行 python -m backend.crawl")

    raw_data = json.loads(raw_manifest_path.read_text(encoding="utf-8"))
    items = [i for i in raw_data.get("items", []) if i.get("ok") and i.get("local_path")]
    if not items:
        raise RuntimeError("raw manifest 中没有成功的 HTML 条目")

    output_dir.mkdir(parents=True, exist_ok=True)
    entries: list[CleanManifestEntry] = []

    for index, item in enumerate(items, start=1):
        dept_id = str(item["dept_id"])
        fallback_name = item.get("name", f"科室{dept_id}")
        source_url = item.get("url", "")
        source_html_rel = item["local_path"]
        html_path = PROJECT_ROOT / source_html_rel

        print(f"[{index}/{len(items)}] 清洗 {fallback_name}")
        cleaned_at = datetime.now(timezone.utc).isoformat()

        try:
            if not html_path.is_file():
                raise FileNotFoundError(f"HTML 不存在: {html_path}")
            html = html_path.read_text(encoding="utf-8")
            cleaned = extract_from_html(
                html,
                dept_id=dept_id,
                fallback_name=fallback_name,
                source_url=source_url,
            )
            # 同名科室（不同 dept_id）用 id 区分文件名
            filename = f"{dept_id}_{_safe_name(cleaned.dept_name)}.md"
            out_path = output_dir / filename
            out_rel = str(out_path.relative_to(PROJECT_ROOT))
            file_content = _build_markdown_file(cleaned, source_html_rel, cleaned_at)
            out_path.write_text(file_content, encoding="utf-8")
            entries.append(
                CleanManifestEntry(
                    dept_id=dept_id,
                    dept_name=cleaned.dept_name,
                    source_url=source_url,
                    source_html=source_html_rel,
                    local_path=out_rel,
                    char_count=cleaned.char_count,
                    cleaned_at=cleaned_at,
                    ok=True,
                )
            )
        except (OSError, ValueError) as exc:
            entries.append(
                CleanManifestEntry(
                    dept_id=dept_id,
                    dept_name=fallback_name,
                    source_url=source_url,
                    source_html=source_html_rel,
                    local_path=None,
                    char_count=0,
                    cleaned_at=cleaned_at,
                    ok=False,
                    error=str(exc),
                )
            )
            print(f"  ! 失败: {exc}")

    payload = {
        "hospital": raw_data.get("hospital", "浙江大学医学院附属第一医院"),
        "source_raw_manifest": str(raw_manifest_path.relative_to(PROJECT_ROOT)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(entries),
        "success": sum(1 for e in entries if e.ok),
        "failed": sum(1 for e in entries if not e.ok),
        "items": [asdict(e) for e in entries],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return entries


def main() -> int:
    entries = clean_all()
    success = sum(1 for e in entries if e.ok)
    failed = [e for e in entries if not e.ok]
    print("---")
    print(f"完成: 成功 {success}/{len(entries)}")
    print(f"Markdown 目录: {CLEAN_DEPARTMENTS_DIR}")
    print(f"Manifest: {CLEAN_MANIFEST}")
    if failed:
        print("失败科室:")
        for e in failed:
            print(f"  - {e.dept_name}: {e.error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
