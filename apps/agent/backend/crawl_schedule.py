"""抓取浙大一院门诊排班与医生详情。

知识库 pipeline 扩展：读取 https://www.zy91.com/server 门诊排班（#a2），
解析三院区排班表格，抓取医生详情页，关联 dept_id。

用法（在项目根目录）:
    python -m backend.crawl_schedule
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup, Tag

SCHEDULE_URL = "https://www.zy91.com/server"
BASE_URL = "https://www.zy91.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

DOCTOR_PATH_RE = re.compile(r"^/department/doctor/(\d+)/(\d+)$")
DEPT_ID_RE = re.compile(r"[?&]dept_id=(\d+)")
BADGE_CHARS = "※★◆▲●○◎"
BADGE_RE = re.compile(rf"[{re.escape(BADGE_CHARS)}]+")

CAMPUS_NAMES = ("庆春院区", "总部一期", "之江院区")
CLINIC_TYPES = ("名医专家门诊", "专科门诊", "普通门诊")

REQUEST_INTERVAL_SEC = 0.4
MAX_RETRIES = 3
TIMEOUT_SEC = 60.0

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_DIR = PROJECT_ROOT / "data" / "schedule"
SCHEDULE_HTML = SCHEDULE_DIR / "schedule_page.html"
SCHEDULE_JSON = SCHEDULE_DIR / "schedule.json"
DOCTORS_JSONL = SCHEDULE_DIR / "doctors.jsonl"
DOCTORS_HTML_DIR = SCHEDULE_DIR / "doctors"
MANIFEST_PATH = SCHEDULE_DIR / "manifest.json"
RAW_MANIFEST = PROJECT_ROOT / "data" / "raw" / "manifest.json"


@dataclass
class DoctorRef:
    site_id: str
    doctor_id: str
    name: str
    url: str
    badge: str | None = None


@dataclass
class ScheduleSlot:
    campus: str
    clinic_type: str
    department_name: str
    period: str | None
    weekday: str | None
    schedule_text: str | None
    doctors: list[DoctorRef] = field(default_factory=list)


@dataclass
class DoctorDetail:
    site_id: str
    doctor_id: str
    name: str
    url: str
    dept_id: str | None
    department_name: str | None
    gender: str | None
    education: str | None
    title: str | None
    profile: str | None
    specialty: str | None
    research: str | None
    outpatient_slots: list[dict[str, str]]
    schedule_page_slots: list[dict[str, str]]
    source_html: str | None
    ok: bool
    error: str | None = None


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _clean_doctor_name(name: str) -> str:
    return BADGE_RE.sub("", name).strip()


def _extract_badge(name: str) -> str | None:
    badges = BADGE_RE.findall(name)
    return badges[0] if badges else None


def _parse_doctor_link(a: Tag, base_url: str = BASE_URL) -> DoctorRef | None:
    href = a.get("href", "").strip()
    absolute = urljoin(base_url, href)
    match = DOCTOR_PATH_RE.match(urlparse(absolute).path)
    if not match:
        return None
    site_id, doctor_id = match.group(1), match.group(2)
    raw_name = _normalize_text(a.get_text())
    if not raw_name:
        return None
    return DoctorRef(
        site_id=site_id,
        doctor_id=doctor_id,
        name=_clean_doctor_name(raw_name),
        url=absolute,
        badge=_extract_badge(raw_name),
    )


def _parse_weekly_table(
    table: Tag,
    *,
    campus: str,
    clinic_type: str,
) -> list[ScheduleSlot]:
    """解析名医专家门诊周网格表。"""
    rows = table.find_all("tr")
    if not rows:
        return []

    header_cells = rows[0].find_all(["th", "td"])
    header = [_normalize_text(c.get_text()) for c in header_cells]
    if len(header) < 3 or header[0] not in ("科别", "科室"):
        return []

    weekdays = header[2:]
    slots: list[ScheduleSlot] = []
    current_dept = ""

    for row in rows[1:]:
        cells = row.find_all("td")
        if not cells:
            continue

        if len(cells) == len(header):
            dept_text = _normalize_text(cells[0].get_text())
            if dept_text:
                current_dept = dept_text
            period = _normalize_text(cells[1].get_text())
            day_cells = cells[2:]
        elif len(cells) == len(header) - 1:
            period = _normalize_text(cells[0].get_text())
            day_cells = cells[1:]
        else:
            continue

        for weekday, cell in zip(weekdays, day_cells):
            doctors: list[DoctorRef] = []
            for a in cell.find_all("a", href=True):
                ref = _parse_doctor_link(a)
                if ref:
                    doctors.append(ref)
            if not doctors:
                continue
            slots.append(
                ScheduleSlot(
                    campus=campus,
                    clinic_type=clinic_type,
                    department_name=current_dept,
                    period=period or None,
                    weekday=weekday,
                    schedule_text=None,
                    doctors=doctors,
                )
            )

    return slots


def _parse_text_schedule_table(
    table: Tag,
    *,
    campus: str,
    clinic_type: str,
) -> list[ScheduleSlot]:
    """解析专科/普通门诊文字时段表（三列一组：科室|时段）。"""
    rows = table.find_all("tr")
    if not rows:
        return []

    slots: list[ScheduleSlot] = []
    for row in rows[1:]:
        cells = row.find_all("td")
        if not cells:
            continue
        pairs: list[tuple[str, str]] = []
        i = 0
        while i + 1 < len(cells):
            dept = _normalize_text(cells[i].get_text())
            when = _normalize_text(cells[i + 1].get_text())
            if dept and when and dept not in ("科室", "时段"):
                pairs.append((dept, when))
            i += 2
        for dept, when in pairs:
            slots.append(
                ScheduleSlot(
                    campus=campus,
                    clinic_type=clinic_type,
                    department_name=dept,
                    period=None,
                    weekday=None,
                    schedule_text=when,
                    doctors=[],
                )
            )
    return slots


def _detect_table_kind(table: Tag) -> str:
    header = _normalize_text(table.find("tr").get_text()) if table.find("tr") else ""
    if "星期一" in header:
        return "weekly"
    return "text"


def parse_schedule_html(html: str) -> list[ScheduleSlot]:
    """从排班页 HTML 解析全部 slot。"""
    soup = BeautifulSoup(html, "lxml")
    a2 = soup.select_one("#a2")
    if a2 is None:
        raise ValueError("未找到 #a2 门诊排班区域")

    all_slots: list[ScheduleSlot] = []
    campus_blocks = a2.select(".item-schedule")
    if not campus_blocks:
        raise ValueError("未找到 .item-schedule 院区面板")

    for index, block in enumerate(campus_blocks):
        campus = CAMPUS_NAMES[index] if index < len(CAMPUS_NAMES) else f"院区{index + 1}"
        tables = block.find_all("table")
        for ti, table in enumerate(tables):
            clinic_type = CLINIC_TYPES[ti] if ti < len(CLINIC_TYPES) else f"门诊类型{ti + 1}"
            kind = _detect_table_kind(table)
            if kind == "weekly":
                all_slots.extend(
                    _parse_weekly_table(table, campus=campus, clinic_type=clinic_type)
                )
            else:
                all_slots.extend(
                    _parse_text_schedule_table(table, campus=campus, clinic_type=clinic_type)
                )

    return all_slots


def _section_after_heading(main: Tag, heading: str) -> str | None:
    for h in main.find_all(["h3", "h4"]):
        if _normalize_text(h.get_text()) != heading:
            continue
        sibling = h.find_next_sibling()
        while sibling is not None and isinstance(sibling, Tag) and sibling.name in ("br", "span"):
            sibling = sibling.find_next_sibling()
        if sibling and isinstance(sibling, Tag):
            text = _normalize_text(sibling.get_text())
            if text and not text.startswith("注："):
                return text
    return None


def _parse_outpatient_table(main: Tag) -> list[dict[str, str]]:
    table = main.select_one(".m-table1-t1 table, div.m-table1-t1 table")
    if table is None:
        return []
    rows = table.find_all("tr")
    if len(rows) < 2:
        return []
    slots: list[dict[str, str]] = []
    for row in rows[1:]:
        cells = [_normalize_text(c.get_text()) for c in row.find_all(["td", "th"])]
        if len(cells) >= 2:
            slots.append({"time": cells[0], "location": cells[1]})
    return slots


def _parse_meta_fields(main: Tag) -> dict[str, str]:
    fields: dict[str, str] = {}
    for p in main.select("div.desc p"):
        span = p.find("span")
        if not span:
            continue
        label = _normalize_text(span.get_text()).replace("：", "").replace(":", "")
        value = _normalize_text(p.get_text())
        if span.get_text(strip=True) in value:
            value = value.replace(_normalize_text(span.get_text()), "", 1).strip()
        if label and value:
            fields[label.replace(" ", "")] = value
    return fields


def parse_doctor_html(html: str, *, url: str, site_id: str, doctor_id: str) -> DoctorDetail:
    """解析医生详情页。"""
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("div.main") or soup

    name_el = main.select_one("h3.tit") or main.find("h3")
    name = _clean_doctor_name(name_el.get_text()) if name_el else f"医生{doctor_id}"

    dept_link = main.select_one("a.morehos[href*='dept_id=']")
    dept_id: str | None = None
    if dept_link:
        match = DEPT_ID_RE.search(dept_link.get("href", ""))
        if match:
            dept_id = match.group(1)

    meta = _parse_meta_fields(main)
    department_name = meta.get("科室") or meta.get("科 室")

    return DoctorDetail(
        site_id=site_id,
        doctor_id=doctor_id,
        name=name,
        url=url,
        dept_id=dept_id,
        department_name=department_name,
        gender=meta.get("性别") or meta.get("性 别"),
        education=meta.get("最高学历、学位"),
        title=meta.get("职称") or meta.get("职 称"),
        profile=_section_after_heading(main, "个人简介"),
        specialty=_section_after_heading(main, "专业擅长"),
        research=_section_after_heading(main, "研究方向"),
        outpatient_slots=_parse_outpatient_table(main),
        schedule_page_slots=[],
        source_html=None,
        ok=True,
    )


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
) -> tuple[int, str | None, str | None]:
    last_error: str | None = None
    last_status = 0
    for attempt in range(1, max_retries + 1):
        try:
            response = client.get(url)
            last_status = response.status_code
            if response.status_code == 200 and response.content:
                return response.status_code, _decode_response(response), None
            last_error = f"HTTP {response.status_code} or empty body"
        except httpx.HTTPError as exc:
            last_error = str(exc)
        if attempt < max_retries:
            time.sleep(0.6 * attempt)
    return last_status, None, last_error


def _load_dept_name_index() -> dict[str, list[str]]:
    """dept_name → [dept_id]（来自 raw manifest）。"""
    if not RAW_MANIFEST.is_file():
        return {}
    data = json.loads(RAW_MANIFEST.read_text(encoding="utf-8"))
    index: dict[str, list[str]] = {}
    for item in data.get("items", []):
        if not item.get("ok"):
            continue
        dept_id = str(item["dept_id"])
        name = item.get("name", "")
        index.setdefault(name, []).append(dept_id)
    return index


def _slot_to_dict(slot: ScheduleSlot) -> dict:
    return {
        "campus": slot.campus,
        "clinic_type": slot.clinic_type,
        "department_name": slot.department_name,
        "period": slot.period,
        "weekday": slot.weekday,
        "schedule_text": slot.schedule_text,
        "doctors": [asdict(d) for d in slot.doctors],
    }


def crawl_schedule(
    *,
    schedule_url: str = SCHEDULE_URL,
    output_dir: Path = SCHEDULE_DIR,
    request_interval: float = REQUEST_INTERVAL_SEC,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    DOCTORS_HTML_DIR.mkdir(parents=True, exist_ok=True)

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": f"{BASE_URL}/",
    }

    dept_index = _load_dept_name_index()
    generated_at = datetime.now(timezone.utc).isoformat()

    with httpx.Client(headers=headers, timeout=TIMEOUT_SEC, follow_redirects=True) as client:
        print(f"抓取排班页 {schedule_url}")
        status, schedule_html, err = fetch_with_retries(client, schedule_url)
        if not schedule_html:
            raise RuntimeError(f"无法获取排班页: status={status}, error={err}")

        SCHEDULE_HTML.write_text(schedule_html, encoding="utf-8")
        slots = parse_schedule_html(schedule_html)
        print(f"解析排班 slot: {len(slots)} 条")

        # 汇总医生引用
        doctor_refs: dict[str, DoctorRef] = {}
        slot_dicts: list[dict] = []
        for slot in slots:
            slot_dicts.append(_slot_to_dict(slot))
            for doc in slot.doctors:
                doctor_refs[doc.doctor_id] = doc

        print(f"去重医生: {len(doctor_refs)} 位，开始抓取详情…")

        doctor_records: list[dict] = []
        failed: list[str] = []

        for index, (doctor_id, ref) in enumerate(sorted(doctor_refs.items(), key=lambda x: int(x[0])), start=1):
            print(f"[{index}/{len(doctor_refs)}] {ref.name} ({ref.url})")
            http_status, html, error = fetch_with_retries(client, ref.url)
            rel_html: str | None = None

            if html:
                html_path = DOCTORS_HTML_DIR / f"{doctor_id}_{ref.name}.html"
                html_path.write_text(html, encoding="utf-8")
                rel_html = str(html_path.relative_to(PROJECT_ROOT))
                try:
                    detail = parse_doctor_html(
                        html, url=ref.url, site_id=ref.site_id, doctor_id=doctor_id
                    )
                    detail.source_html = rel_html
                except (ValueError, AttributeError) as exc:
                    detail = DoctorDetail(
                        site_id=ref.site_id,
                        doctor_id=doctor_id,
                        name=ref.name,
                        url=ref.url,
                        dept_id=None,
                        department_name=None,
                        gender=None,
                        education=None,
                        title=None,
                        profile=None,
                        specialty=None,
                        research=None,
                        outpatient_slots=[],
                        schedule_page_slots=[],
                        source_html=rel_html,
                        ok=False,
                        error=str(exc),
                    )
            else:
                detail = DoctorDetail(
                    site_id=ref.site_id,
                    doctor_id=doctor_id,
                    name=ref.name,
                    url=ref.url,
                    dept_id=None,
                    department_name=None,
                    gender=None,
                    education=None,
                    title=None,
                    profile=None,
                    specialty=None,
                    research=None,
                    outpatient_slots=[],
                    schedule_page_slots=[],
                    source_html=None,
                    ok=False,
                    error=error,
                )
                failed.append(ref.name)

            # 合并排班页 slot
            page_slots = []
            for slot in slots:
                for doc in slot.doctors:
                    if doc.doctor_id != doctor_id:
                        continue
                    page_slots.append(
                        {
                            "campus": slot.campus,
                            "clinic_type": slot.clinic_type,
                            "department_name": slot.department_name,
                            "period": slot.period,
                            "weekday": slot.weekday,
                            "badge": doc.badge,
                        }
                    )
            detail.schedule_page_slots = page_slots

            dept_ids: list[str] = []
            if detail.dept_id:
                dept_ids.append(detail.dept_id)
            elif detail.department_name and detail.department_name in dept_index:
                dept_ids.extend(dept_index[detail.department_name])

            record = asdict(detail)
            record["dept_ids"] = dept_ids
            record["http_status"] = http_status if html else status
            doctor_records.append(record)

            time.sleep(request_interval)

    schedule_payload = {
        "source_url": schedule_url,
        "generated_at": generated_at,
        "total_slots": len(slot_dicts),
        "slots_with_doctors": sum(1 for s in slot_dicts if s.get("doctors")),
        "text_only_slots": sum(1 for s in slot_dicts if s.get("schedule_text")),
        "items": slot_dicts,
    }
    SCHEDULE_JSON.write_text(json.dumps(schedule_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    with DOCTORS_JSONL.open("w", encoding="utf-8") as fh:
        for record in doctor_records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    manifest = {
        "source_url": schedule_url,
        "generated_at": generated_at,
        "total_doctors": len(doctor_records),
        "success": sum(1 for d in doctor_records if d.get("ok")),
        "failed": sum(1 for d in doctor_records if not d.get("ok")),
        "total_schedule_slots": len(slot_dicts),
        "unique_doctors_in_schedule": len(doctor_refs),
        "failed_doctors": failed,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main(argv: Iterable[str] | None = None) -> int:
    del argv
    manifest = crawl_schedule()
    print("---")
    print(f"排班 slot: {manifest['total_schedule_slots']}")
    print(f"医生: 成功 {manifest['success']}/{manifest['total_doctors']}")
    print(f"Schedule JSON: {SCHEDULE_JSON}")
    print(f"Doctors JSONL: {DOCTORS_JSONL}")
    print(f"Manifest: {MANIFEST_PATH}")
    if manifest["failed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
