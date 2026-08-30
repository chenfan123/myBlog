"""爬取浙江大学医学院附属第一医院官网科室详情页原始 HTML。

知识库 pipeline 的第一步：只负责「发现链接 → 抓取原文 → 落盘」，
不做正文清洗 / 切分 / 向量化（那些属于后续功能）。

数据源：https://www.zy91.com/department

用法（在项目根目录）:
    python -m backend.crawl
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# 常量：数据源与抓取策略
# ---------------------------------------------------------------------------

LIST_URL = "https://www.zy91.com/department"
BASE_URL = "https://www.zy91.com"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# 详情页路径形如 /department/dept/73/5
DETAIL_PATH_RE = re.compile(r"^/department/dept/(\d+)/(\d+)$")

GENERIC_LINK_NAMES = frozenset({"科室导航", "更多", "详情", "查看", "患者服务"})

REQUEST_INTERVAL_SEC = 0.5
MAX_RETRIES = 3
TIMEOUT_SEC = 30.0
MIN_EXPECTED_DEPARTMENTS = 70

# ---------------------------------------------------------------------------
# 路径
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
DEPARTMENTS_DIR = RAW_DIR / "departments"
MANIFEST_PATH = RAW_DIR / "manifest.json"


@dataclass(frozen=True)
class DepartmentRef:
    """列表页解析出的科室引用。"""

    site_id: str
    dept_id: str
    name: str
    url: str


@dataclass
class ManifestEntry:
    """manifest.json 单条记录。"""

    site_id: str
    dept_id: str
    name: str
    url: str
    local_path: str | None
    http_status: int | None
    fetched_at: str
    ok: bool
    error: str | None = None
    attempts: int = 1


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\s]+", "_", name.strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "unknown"


def _pick_best_name(candidates: list[str]) -> str:
    """从多个锚文本中选出最合适的科室名。"""
    names = [n.strip() for n in candidates if n and n.strip()]
    if not names:
        return ""
    non_generic = [n for n in names if n not in GENERIC_LINK_NAMES]
    pool = non_generic or names
    return max(pool, key=len)


def discover_departments(html: str, base_url: str = BASE_URL) -> list[DepartmentRef]:
    """从科室导航页解析去重后的详情链接（按 dept_id 去重）。"""
    soup = BeautifulSoup(html, "lxml")
    name_candidates: dict[str, list[str]] = {}
    refs: dict[str, DepartmentRef] = {}

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        match = DETAIL_PATH_RE.match(parsed.path or "")
        if not match:
            continue

        site_id, dept_id = match.group(1), match.group(2)
        name = (
            (a.get("title") or "").strip()
            or a.get_text(strip=True)
            or f"科室{dept_id}"
        )
        name_candidates.setdefault(dept_id, []).append(name)
        url = f"{base_url}/department/dept/{site_id}/{dept_id}"
        refs[dept_id] = DepartmentRef(
            site_id=site_id,
            dept_id=dept_id,
            name=name,
            url=url,
        )

    result: list[DepartmentRef] = []
    for dept_id, ref in refs.items():
        best = _pick_best_name(name_candidates.get(dept_id, [ref.name]))
        result.append(
            DepartmentRef(
                site_id=ref.site_id,
                dept_id=dept_id,
                name=best or ref.name,
                url=ref.url,
            )
        )

    return sorted(result, key=lambda d: int(d.dept_id))


def _decode_response(response: httpx.Response) -> str:
    text = response.text
    if text and "\ufffd" not in text[:2000]:
        return text
    for encoding in ("utf-8", "gbk", "gb2312"):
        try:
            return response.content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return response.content.decode("utf-8", errors="replace")


def fetch_with_retries(
    client: httpx.Client,
    url: str,
    *,
    max_retries: int = MAX_RETRIES,
) -> tuple[int, str | None, str | None, int]:
    last_error: str | None = None
    last_status = 0
    for attempt in range(1, max_retries + 1):
        try:
            response = client.get(url)
            last_status = response.status_code
            if response.status_code == 200 and response.content:
                return response.status_code, _decode_response(response), None, attempt
            last_error = f"HTTP {response.status_code} or empty body"
        except httpx.HTTPError as exc:
            last_error = str(exc)
        if attempt < max_retries:
            time.sleep(0.6 * attempt)
    return last_status, None, last_error, max_retries


def crawl_all(
    *,
    list_url: str = LIST_URL,
    output_dir: Path = DEPARTMENTS_DIR,
    manifest_path: Path = MANIFEST_PATH,
    request_interval: float = REQUEST_INTERVAL_SEC,
) -> list[ManifestEntry]:
    """执行完整爬取：发现科室 → 逐页抓取 → 写 HTML + manifest。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": f"{BASE_URL}/",
    }
    entries: list[ManifestEntry] = []

    with httpx.Client(headers=headers, timeout=TIMEOUT_SEC, follow_redirects=True) as client:
        status, list_html, err, _ = fetch_with_retries(client, list_url)
        if not list_html:
            raise RuntimeError(f"无法获取科室列表页: status={status}, error={err}")

        departments = discover_departments(list_html)
        print(f"发现科室详情页 {len(departments)} 个（去重后）")
        if len(departments) < MIN_EXPECTED_DEPARTMENTS:
            raise RuntimeError(
                f"科室数量过少（{len(departments)} < {MIN_EXPECTED_DEPARTMENTS}），"
                "列表页结构可能已变更"
            )

        for index, dept in enumerate(departments, start=1):
            print(f"[{index}/{len(departments)}] 抓取 {dept.name} ({dept.url})")
            http_status, html, error, attempts = fetch_with_retries(client, dept.url)
            fetched_at = datetime.now(timezone.utc).isoformat()

            if html:
                filename = f"{dept.dept_id}_{_safe_name(dept.name)}.html"
                file_path = output_dir / filename
                file_path.write_text(html, encoding="utf-8")
                rel = str(file_path.relative_to(PROJECT_ROOT))
                entries.append(
                    ManifestEntry(
                        site_id=dept.site_id,
                        dept_id=dept.dept_id,
                        name=dept.name,
                        url=dept.url,
                        local_path=rel,
                        http_status=http_status,
                        fetched_at=fetched_at,
                        ok=True,
                        error=None,
                        attempts=attempts,
                    )
                )
            else:
                entries.append(
                    ManifestEntry(
                        site_id=dept.site_id,
                        dept_id=dept.dept_id,
                        name=dept.name,
                        url=dept.url,
                        local_path=None,
                        http_status=http_status or None,
                        fetched_at=fetched_at,
                        ok=False,
                        error=error,
                        attempts=attempts,
                    )
                )
                print(f"  ! 失败: {error}")

            time.sleep(request_interval)

    payload = {
        "hospital": "浙江大学医学院附属第一医院",
        "source_list_url": list_url,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(entries),
        "success": sum(1 for e in entries if e.ok),
        "failed": sum(1 for e in entries if not e.ok),
        "items": [asdict(e) for e in entries],
    }
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return entries


def main(argv: Iterable[str] | None = None) -> int:
    del argv
    entries = crawl_all()
    success = sum(1 for e in entries if e.ok)
    failed = [e for e in entries if not e.ok]
    print("---")
    print(f"完成: 成功 {success}/{len(entries)}")
    print(f"HTML 目录: {DEPARTMENTS_DIR}")
    print(f"Manifest: {MANIFEST_PATH}")
    if failed:
        print("失败科室:")
        for e in failed:
            print(f"  - {e.name} ({e.url}): {e.error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
