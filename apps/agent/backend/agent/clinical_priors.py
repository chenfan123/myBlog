"""可扩展临床先验规则层：检索加权、候选重排、确定性择科。

设计原则
--------
- 已知路由模式（女性小腹痛→妇科、儿童→儿科等）在此集中声明，新增场景只加 RULES 条目。
- LLM 复核（review.py）只做通用质控：候选是否合理、是否编造、重大专科是否缺信息。
- 规则命中且目标科在候选中时，直接定主推，不再把专科路由写进 _REVIEW_SYSTEM。

扩展方式
--------
在 ROUTING_RULES 末尾追加 ClinicalRule，设置 require_* / boost / prefer_primary / reason 即可。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

# ── 全局守卫（无对应意图时压低易误召科室）────────────────────────────

_NUMBERED_ONCOLOGY = frozenset({f"肿瘤内科（{n}）" for n in ("一", "二", "三", "四", "五")})
_ONCOLOGY_INTENT = ("化疗", "放疗", "靶向", "免疫治疗", "肿瘤内科", "癌症", "癌", "肿瘤", "恶性")
_CRITICAL_INTENT = ("危重", "抢救", "昏迷", "呼吸衰竭", "休克", "icu", "ICU", "上呼吸机")


@dataclass(frozen=True)
class ClinicalRule:
    """单条临床路由规则。"""

    id: str
    priority: int = 0
    # 匹配：require_groups 每组至少一词；require_any 至少一词；unless_any 命中则跳过
    require_groups: tuple[tuple[str, ...], ...] = ()
    require_any: tuple[str, ...] = ()
    unless_any: tuple[str, ...] = ()
    query_hints: tuple[str, ...] = ()
    boost: tuple[tuple[str, float], ...] = ()  # (科室全名, 乘子)
    demote_contains: tuple[tuple[str, float], ...] = ()  # (科室名子串, 乘子)
    prefer_primary: str | None = None
    reason: str = ""


# 新增场景在此追加；priority 越高越优先定主推
ROUTING_RULES: tuple[ClinicalRule, ...] = (
    ClinicalRule(
        id="female_lower_abdomen",
        priority=10,
        require_groups=(
            ("女", "女性", "姑娘"),
            ("小腹", "小肚", "下腹", "盆腔"),
        ),
        unless_any=("肿瘤", "癌症", "癌", "恶性", "包块", "肿块", "化疗", "放疗"),
        query_hints=("女性下腹痛", "妇科", "盆腔"),
        boost=(("妇科", 1.85),),
        demote_contains=(
            ("肿瘤外科", 0.4),
            ("肿瘤内科", 0.45),
            ("放疗", 0.5),
        ),
        prefer_primary="妇科",
        reason="女性下腹/小腹痛，优先妇科排查",
    ),
    ClinicalRule(
        id="pediatric",
        priority=5,
        require_any=("孩子", "小孩", "儿童", "宝宝", "小儿", "幼儿", "婴儿"),
        boost=(("儿科", 1.4),),
        reason="儿童症状优先儿科",
    ),
    ClinicalRule(
        id="psych",
        priority=5,
        require_any=("失眠", "焦虑", "抑郁", "睡不着", "精神", "情绪低落", "心理"),
        boost=(("精神卫生科", 1.4),),
        reason="精神心理相关症状优先精神卫生科",
    ),
)


@dataclass
class PriorSelection:
    primary_idx: int
    alt_idx: int | None
    reason: str
    rule_id: str
    challenged_dept: str = ""


def _has_any(text: str, hints: tuple[str, ...]) -> bool:
    return any(h in text for h in hints)


def rule_matches(rule: ClinicalRule, text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if rule.unless_any and _has_any(t, rule.unless_any):
        return False
    if rule.require_any and not _has_any(t, rule.require_any):
        return False
    for group in rule.require_groups:
        if not _has_any(t, group):
            return False
    if not rule.require_any and not rule.require_groups:
        return False
    return True


def active_rules(text: str) -> list[ClinicalRule]:
    return [r for r in ROUTING_RULES if rule_matches(r, text)]


def rewrite_query_for_priors(query: str) -> str:
    """检索前补临床线索（映射库覆盖不足时）。"""
    q = (query or "").strip()
    if not q:
        return q
    extras: list[str] = []
    for rule in active_rules(q):
        for hint in rule.query_hints:
            if hint not in q and hint not in extras:
                extras.append(hint)
    if not extras:
        return q
    return f"{q} {' '.join(extras)}"


def dept_score_multiplier(text: str, dept_name: str) -> float:
    """检索融合分 / Rerank 后排序乘子（全局守卫 + 命中规则）。"""
    name = dept_name or ""
    t = text or ""
    mult = 1.0
    oncology = _has_any(t, _ONCOLOGY_INTENT)
    critical = _has_any(t, _CRITICAL_INTENT)

    if not oncology:
        if name in _NUMBERED_ONCOLOGY:
            mult *= 0.45
        if "肿瘤外科" in name:
            mult *= 0.4
    if not critical and name == "重症医学科":
        mult *= 0.4

    for rule in active_rules(t):
        for dept, boost in rule.boost:
            if name == dept:
                mult *= boost
        for pat, demote in rule.demote_contains:
            if pat in name:
                mult *= demote
    return mult


def reorder_candidates(
    text: str,
    candidates: list[dict[str, Any]],
    *,
    focus_dept: str | None = None,
) -> list[dict[str, Any]]:
    """推荐前按规则与用户焦点重排候选（确定性，不依赖 LLM）。"""
    if not candidates:
        return candidates
    ordered = list(candidates)

    def _move_front(pred: Callable[[dict[str, Any]], bool]) -> None:
        nonlocal ordered
        hit = [c for c in ordered if pred(c)]
        rest = [c for c in ordered if not pred(c)]
        if hit:
            ordered = hit + rest

    if focus_dept:
        _move_front(lambda c: focus_dept in (c.get("dept_name") or ""))

    for rule in sorted(active_rules(text), key=lambda r: -r.priority):
        if rule.prefer_primary:
            _move_front(lambda c, p=rule.prefer_primary: (c.get("dept_name") or "") == p)

    return ordered


def _pick_alt(
    candidates: list[dict[str, Any]],
    primary_idx: int,
    *,
    skip_high_stakes: bool = False,
) -> int | None:
    from backend.agent.sufficiency import is_high_stakes_dept

    n = len(candidates)
    if n <= 1:
        return None
    for j in range(n):
        if j == primary_idx:
            continue
        name = candidates[j].get("dept_name") or ""
        if skip_high_stakes and is_high_stakes_dept(name):
            continue
        return j
    return next((j for j in range(n) if j != primary_idx), None)


def try_deterministic_selection(
    text: str,
    candidates: list[dict[str, Any]],
    *,
    focus_dept: str | None = None,
    challenged_dept: str = "",
) -> PriorSelection | None:
    """规则足够明确时直接定主推/备选，跳过 LLM 择科。"""
    if not candidates:
        return None

    # 用户质疑某科（如「为什么不考虑妇科」）且该科在候选中
    if challenged_dept:
        from backend.agent.dept_focus import resolve_focus_dept

        key = resolve_focus_dept(challenged_dept, None) or challenged_dept
        for i, c in enumerate(candidates):
            name = c.get("dept_name") or ""
            if key in name or challenged_dept in name:
                return PriorSelection(
                    primary_idx=i,
                    alt_idx=_pick_alt(candidates, i),
                    reason=f"您提到的【{name}】结合当前症状值得优先考虑",
                    rule_id="user_challenge",
                    challenged_dept=challenged_dept,
                )

    matched = sorted(active_rules(text), key=lambda r: -r.priority)
    for rule in matched:
        if not rule.prefer_primary:
            continue
        for i, c in enumerate(candidates):
            if (c.get("dept_name") or "") == rule.prefer_primary:
                skip_hs = rule.id == "female_lower_abdomen"
                return PriorSelection(
                    primary_idx=i,
                    alt_idx=_pick_alt(candidates, i, skip_high_stakes=skip_hs),
                    reason=rule.reason,
                    rule_id=rule.id,
                )

    # 有焦点科室但无 prefer_primary 规则时，若焦点在候选第一位已满足
    if focus_dept and candidates:
        for i, c in enumerate(candidates):
            if focus_dept in (c.get("dept_name") or ""):
                return PriorSelection(
                    primary_idx=i,
                    alt_idx=_pick_alt(candidates, i),
                    reason="按您关注的科室与症状匹配推荐",
                    rule_id="focus_dept",
                )
    return None


def challenge_reply_preface(
    summary: str,
    challenged_dept: str,
    primary_dept: str,
) -> str:
    """用户质疑科室时的开场说明。"""
    if not challenged_dept:
        return ""
    from backend.agent.dept_focus import resolve_focus_dept

    key = resolve_focus_dept(challenged_dept, None) or challenged_dept
    if key in primary_dept or challenged_dept in primary_dept:
        snippet = (summary or "")[:40]
        return (
            f"您问得对：结合「{snippet}」这类情况，"
            f"【{primary_dept}】确实应优先考虑，先前若未突出说明不够妥当。\n"
        )
    return (
        f"关于【{challenged_dept}】：当前知识库匹配更接近【{primary_dept}】；"
        f"若症状与月经/白带/怀孕相关，也建议一并考虑妇科面诊。\n"
    )
