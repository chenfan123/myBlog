"""相对日期 / 星期解析（导诊排班用）。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

_WEEKDAY_CN = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")
_DAY_CHAR_TO_IDX = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}


@dataclass(frozen=True)
class ScheduleTarget:
    """排班查询的目标时段。"""

    weekday: str  # 与排班库 weekday 一致，如「星期一」
    label: str  # 展示用：今天 / 明天 / 星期一
    explicit: bool  # 用户是否明确指定（否则为系统默认「当前合理时间」）


def weekday_cn(d: date) -> str:
    return _WEEKDAY_CN[d.weekday()]


def parse_weekday(text: str, *, today: date | None = None) -> str | None:
    """从用户话解析目标星期中文名（与排班库 weekday 字段一致）。

    支持：下周一、本周三、周一、星期一。
    若同时出现「今天周日」与「下周一」，优先取带「下/本」的目标日。
    """
    t = (text or "").strip()
    if not t:
        return None
    today = today or date.today()

    matches = list(re.finditer(r"(下|本)?(周|星期)([一二三四五六日天])", t))
    if not matches:
        return None

    preferred = [m for m in matches if m.group(1)]
    chosen = preferred[-1] if preferred else matches[-1]

    scope = chosen.group(1) or ""
    day_ch = chosen.group(3)
    idx = _DAY_CHAR_TO_IDX.get(day_ch)
    if idx is None:
        return None
    if scope == "下":
        target = today + timedelta(days=1)
        while target.weekday() != idx:
            target += timedelta(days=1)
    return _WEEKDAY_CN[idx]


def resolve_schedule_target(
    text: str,
    *,
    today: date | None = None,
    now: datetime | None = None,
) -> ScheduleTarget | None:
    """解析排班查询的目标日；无明确日期时默认「今天」（当前合理时间）。"""
    t = (text or "").strip()
    if not t:
        return None
    today = today or date.today()
    now = now or datetime.now()

    if re.search(r"明[天日]|明日", t):
        d = today + timedelta(days=1)
        return ScheduleTarget(weekday_cn(d), "明天", True)
    if "后天" in t:
        d = today + timedelta(days=2)
        return ScheduleTarget(weekday_cn(d), "后天", True)
    if "大后天" in t:
        d = today + timedelta(days=3)
        return ScheduleTarget(weekday_cn(d), "大后天", True)
    if re.search(r"今[天日]|今日", t):
        return ScheduleTarget(weekday_cn(today), "今天", True)

    w = parse_weekday(t, today=today)
    if w:
        label = w
        if re.search(r"下(周|星期)", t):
            label = f"下{w[-1]}" if len(w) >= 3 else w
        return ScheduleTarget(w, label, True)

    if is_schedule_followup(t):
        label = "今天" if weekday_cn(today) else weekday_cn(today)
        return ScheduleTarget(weekday_cn(today), label, False)

    return None


def weekday_sort_key(weekday: str | None) -> int:
    if weekday in _WEEKDAY_CN:
        return _WEEKDAY_CN.index(weekday)
    return 99


def sort_rows_by_weekday_period(
    rows: list[dict],
    *,
    primary_weekday: str | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """排班行排序：主目标日优先；今天且已过上午则下午靠前。"""
    now = now or datetime.now()
    hour = now.hour

    def _key(r: dict) -> tuple:
        wd = r.get("weekday") or ""
        period = r.get("period") or ""
        is_primary = 0 if wd == primary_weekday else 1
        wd_order = weekday_sort_key(wd)
        # 今天且当前已是下午：上午排后
        period_bias = 0
        if primary_weekday and wd == primary_weekday and hour >= 12:
            if "上午" in period:
                period_bias = 1
            elif "下午" in period:
                period_bias = 0
            else:
                period_bias = 0
        else:
            period_bias = 0 if "上午" in period else (1 if "下午" in period else 2)
        return (is_primary, wd_order, period_bias, period, r.get("campus") or "")

    return sorted(rows, key=_key)


def partition_schedule_rows(
    rows: list[dict],
    target: ScheduleTarget,
    *,
    now: datetime | None = None,
) -> tuple[list[dict], list[dict]]:
    """拆成「目标时段」与「其他时段」。"""
    now = now or datetime.now()
    primary = [r for r in rows if (r.get("weekday") or "") == target.weekday and r.get("doctor_name")]
    others = [r for r in rows if (r.get("weekday") or "") != target.weekday and r.get("doctor_name")]
    primary = sort_rows_by_weekday_period(primary, primary_weekday=target.weekday, now=now)
    others = sort_rows_by_weekday_period(others, primary_weekday=None, now=now)
    return primary, others


def is_schedule_followup(text: str) -> bool:
    """是否像在追问号源/出诊（可无科室名）。"""
    t = (text or "").strip()
    if not t:
        return False
    cues = (
        "出诊", "排班", "有号", "号源", "挂号", "挂谁", "谁的号", "能挂",
        "门诊时间", "哪个院区", "什么时候看", "有谁", "哪位医生出诊",
        "哪些医生", "什么医生", "哪个医生", "哪些大夫",
        "明天", "后天", "大后天", "今天", "今日", "明日",
        "下周", "周一", "周二", "周三", "周四", "周五", "周六", "周日", "周天",
        "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日",
        "上午", "下午",
    )
    return any(c in t for c in cues)
