"""用户意图识别：导诊 / 排班 / 专家 / 拒答（闲聊·探测）。"""

from __future__ import annotations

import re

from backend.agent.dept_focus import extract_dept_mentions, is_dept_correction, is_dept_challenge
from backend.agent.safety import is_chitchat, is_prompt_probe
from backend.agent.state import Intent, Stage
from backend.agent.sufficiency import has_age_info, has_duration_info, looks_serious
from backend.agent.timeparse import is_schedule_followup

_SCHEDULE_HINTS = (
    "出诊", "排班", "门诊时间", "周几", "星期", "上午", "下午",
    "哪个院区", "有号", "挂号时间", "什么时候看", "挂谁", "谁的号",
    "能挂", "号源", "下周", "有谁出诊",
)
_EXPERT_HINTS = (
    "专家", "名医", "哪个医生", "哪位医生", "推荐医生", "主任医师", "找个医生",
    "有哪些医生", "医生列表",
)
_TRIAGE_HINTS = (
    "挂什么科", "看什么科", "哪个科", "什么科", "不舒服", "症状", "疼", "痛",
    "发烧", "咳嗽", "复查", "难受", "恶心", "头晕", "腹泻", "皮疹",
    "包块", "肿块", "结节", "肿瘤",
)

# 结束问诊：按钮文案 + 口语
_END_EXACT = {
    "结束问诊", "结束咨询", "结束对话", "结束", "不问了", "不聊了",
    "到此结束", "问诊结束", "咨询结束", "重新开始", "新的问诊", "新开对话",
    "再见", "拜拜", "bye", "goodbye",
}
_END_PATTERNS = (
    r"结束(本次)?(问诊|咨询|对话|会话)",
    r"(不想|不用|不要)(再)?(问|聊|说)了",
    r"(先(这样|到这)|就这样(吧|子)?|可以了|没事了)",
    r"(谢谢|感谢).{0,6}(再见|拜拜)",
    r"^(重新开始|换个问题|新开(一)?(次|个)?(问诊|对话))",
)


def is_end_consultation(text: str) -> bool:
    """是否表达结束本轮问诊 / 重新开始。"""
    t = (text or "").strip()
    if not t:
        return False
    low = t.lower()
    if t in _END_EXACT or low in _END_EXACT:
        return True
    # 含明确症状时不当作结束（如「结束肚子疼」极少见，但「不想再疼了」）
    if any(x in t for x in ("痛", "疼", "烧", "咳", "晕", "泻", "肿", "挂什么科")):
        if not re.search(r"结束(本次)?(问诊|咨询|对话)", t):
            return False
    for pat in _END_PATTERNS:
        if re.search(pat, t, flags=re.IGNORECASE):
            return True
    return False


def classify_intent(
    text: str,
    *,
    last_intent: Intent | None = None,
    last_stage: Stage | str | None = None,
    focus_dept: str | None = None,
    has_recommendation: bool = False,
    symptom_summary: str | None = None,
) -> Intent:
    """规则优先意图分类。"""
    t = (text or "").strip()
    if not t:
        return "other"

    if is_prompt_probe(t):
        return "other"

    # 结束问诊优先于闲聊（「结束问诊」仅 4 字易被误判闲聊）
    if is_end_consultation(t):
        return "end"

    # 推荐后质疑某科室（为什么不考虑妇科）→ 重新导诊，勿走专家列表
    if (
        (has_recommendation or last_stage == "recommend")
        and is_dept_challenge(t)
        and not is_schedule_followup(t)
    ):
        return "triage"

    # 澄清轮：短答一律视为导诊补充，绝不走闲聊拒答
    if last_stage == "clarify" and not is_schedule_followup(t) and not is_prompt_probe(t):
        return "triage"

    # 澄清后 / 导诊中补充年龄/病程等 → 继续导诊
    if last_stage == "clarify" or (
        last_intent == "triage" and symptom_summary and len(symptom_summary) >= 4
    ):
        if has_age_info(t) or has_duration_info(t) or looks_serious(t):
            if not is_schedule_followup(t):
                return "triage"

    if (focus_dept or has_recommendation) and is_schedule_followup(t):
        return "schedule"

    if is_chitchat(t):
        return "other"

    if last_intent in ("expert", "schedule") or focus_dept or has_recommendation:
        if is_dept_correction(t) or (
            extract_dept_mentions(t)
            and not any(h in t for h in ("挂什么科", "看什么科", "不舒服"))
            and not is_schedule_followup(t)
        ):
            return "expert"

    if (
        (focus_dept or has_recommendation or last_intent == "triage")
        and is_schedule_followup(t)
        and not any(h in t for h in ("挂什么科", "看什么科", "不舒服", "头疼", "头痛"))
    ):
        return "schedule"

    expert_score = sum(1 for h in _EXPERT_HINTS if h in t)
    schedule_score = sum(1 for h in _SCHEDULE_HINTS if h in t)
    if is_schedule_followup(t):
        schedule_score = max(schedule_score, 2)
    triage_score = sum(1 for h in _TRIAGE_HINTS if h in t)

    if expert_score and schedule_score:
        return "expert"
    if expert_score >= 1 and expert_score >= schedule_score:
        return "expert"
    if schedule_score >= 1 and schedule_score >= triage_score:
        return "schedule"
    if triage_score >= 1:
        return "triage"

    body_cues = ("痛", "疼", "烧", "咳", "晕", "泻", "肿", "痒", "麻", "吐", "闷", "炎", "块")
    symptom_blood = any(x in t for x in ("便血", "吐血", "咳血", "血尿", "出血", "流血", "贫血"))
    if len(t) >= 6 and (any(c in t for c in body_cues) or symptom_blood or looks_serious(t)):
        if (focus_dept or has_recommendation) and is_schedule_followup(t):
            return "schedule"
        return "triage"
    if extract_dept_mentions(t) and len(t) <= 24:
        return "expert"
    if re.search(r"[?？]", t) and len(t) < 8:
        return "other"
    return "other"
