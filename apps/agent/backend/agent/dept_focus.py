"""会话科室焦点：从用户话里抽取目标科室 / 否定科室。"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from backend.config import PROJECT_ROOT

# 口语别名 → 用于过滤的关键词（匹配 dept_name 子串）
_ALIAS_TO_KEY = {
    "消化内科": "消化",
    "消化科": "消化",
    "消化": "消化",
    "疼痛科": "疼痛",
    "疼痛": "疼痛",
    "全科医学科": "全科",
    "全科": "全科",
    "血液科": "血液",
    "血液病": "血液",
    "骨髓移植": "骨髓移植",
    "心内科": "心血管内科",
    "心血管内科": "心血管内科",
    "呼吸科": "呼吸",
    "呼吸内科": "呼吸",
    "肾内科": "肾脏",
    "肾脏病": "肾脏",
    "骨科": "骨科",
    "妇科": "妇科",
    "产科": "产科",
    "儿科": "儿科",
    "神经内科": "神经内科",
    "神经外科": "神经外科",
    "肿瘤内科": "肿瘤内科",
    "中医科": "中医",
    "内分泌": "内分泌",
    "风湿免疫": "风湿",
    "皮肤科": "皮肤",
    "眼科": "眼科",
    "耳鼻喉": "耳鼻咽喉",
    "口腔科": "口腔",
    "泌尿外科": "泌尿",
    "普外科": "普通外科",
    "肝胆": "肝胆",
    "感染科": "感染",
    "精神科": "精神",
    "精神卫生": "精神",
}


@lru_cache(maxsize=1)
def _known_dept_names() -> tuple[str, ...]:
    path = PROJECT_ROOT / "data" / "chunks" / "doctors.jsonl"
    names: set[str] = set()
    if path.is_file():
        import json

        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            dept = json.loads(line).get("dept_name") or ""
            if dept:
                names.add(dept)
    return tuple(sorted(names, key=len, reverse=True))


def extract_dept_mentions(text: str) -> list[str]:
    """从文本抽出科室提及（长名优先），如「消化内科」「血液科」。"""
    t = (text or "").strip()
    if not t:
        return []
    found: list[str] = []
    # 1) 完整库内科室名
    for name in _known_dept_names():
        bare = re.sub(r"[（(].*?[）)]", "", name)
        if name in t or (bare and bare in t):
            if name not in found:
                found.append(name)
    # 2) 别名
    for alias in sorted(_ALIAS_TO_KEY.keys(), key=len, reverse=True):
        if alias in t and alias not in found:
            found.append(alias)
    # 3) 泛化「XX科/中心」
    for m in re.finditer(r"([\u4e00-\u9fff]{2,12}?(?:科|中心|门诊))", t):
        phrase = m.group(1)
        if phrase not in found and phrase not in ("什么科", "哪个科", "挂什么科", "看什么科"):
            found.append(phrase)
    return found


def extract_negated_depts(text: str) -> list[str]:
    """「不是血液科 / 别推血液科」等否定。"""
    t = text or ""
    out: list[str] = []
    for m in re.finditer(
        r"(?:不是|不要|别推|别看|别挂|非|搞错了|说的不是)\s*([\u4e00-\u9fff]{2,16}?(?:科|中心|门诊)?)",
        t,
    ):
        out.append(m.group(1).strip("，。；、 "))
    return out


def is_dept_challenge(text: str) -> bool:
    """质疑/追问某科室是否应考虑，如「为什么不考虑妇科」「要不要看妇科」。"""
    t = (text or "").strip()
    if not t:
        return False
    if not extract_dept_mentions(t):
        return False
    return bool(
        re.search(
            r"(为什么|为啥).{0,8}(不考虑|不是|没(?:有)?(?:推|荐|提)|漏了)"
            r"|(要不要|可不可以|能不能|是否|是不是).{0,6}(看|挂|考虑)"
            r"|不考虑.{0,10}(科|中心)",
            t,
        )
    )


def resolve_focus_dept(text: str, previous: str | None = None) -> str | None:
    """结合本轮肯定/否定与上一轮焦点，得到当前目标科室关键词。"""
    mentions = extract_dept_mentions(text)
    negated = extract_negated_depts(text)

    def _hit_neg(name: str) -> bool:
        return any(n and (n in name or name in n) for n in negated)

    positive = [m for m in mentions if not _hit_neg(m)]
    # 「消化内科，不是血液科」→ 保留消化内科
    if positive:
        # 优先更具体的库内科室名
        positive.sort(key=len, reverse=True)
        return _to_filter_key(positive[0])

    prev = (previous or "").strip() or None
    if prev and _hit_neg(prev):
        return None
    if prev:
        return prev
    return None


def _to_filter_key(mention: str) -> str:
    """转成用于 dept_name LIKE 的关键词。"""
    m = mention.strip()
    for alias, key in sorted(_ALIAS_TO_KEY.items(), key=lambda x: -len(x[0])):
        if alias in m or m in alias:
            return key
    # 去掉院区括号
    m = re.sub(r"[（(].*?[）)]", "", m)
    # 「消化内科」→ 消化内科；过长则取科名前缀
    if m.endswith("科") and len(m) > 2:
        return m
    return m


def is_dept_correction(text: str) -> bool:
    """是否像在纠正科室（多轮专家/导诊上下文）。"""
    t = (text or "").strip()
    if not t:
        return False
    # 「为什么不考虑妇科」是质疑导诊，不是改挂专家
    if is_dept_challenge(t):
        return False
    if extract_negated_depts(t):
        return True
    if re.search(r"(说的是|我要|我想看|改成|换成)", t) and extract_dept_mentions(t):
        return True
    # 仅科室名短句
    mentions = extract_dept_mentions(t)
    if mentions and len(t) <= 20 and not any(x in t for x in ("痛", "疼", "烧", "咳", "晕", "不舒服")):
        return True
    return False
