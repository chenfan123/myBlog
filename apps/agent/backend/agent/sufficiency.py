"""问诊信息充分性：一次列出少量核心问题，避免一问一答拖沓。"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from backend.llm import build_chat_model

_HIGH_STAKES_DEPT_KEYS = (
    "肿瘤外科",
    "肿瘤内科",
    "放疗",
    "骨髓移植",
    "器官移植",
    "心脏大血管",
    "神经外科",
    "重症",
)

_SERIOUS_SYMPTOM_HINTS = (
    "肿瘤", "癌症", "癌", "恶性", "转移", "包块", "肿块", "肿物",
    "淋巴结", "复查肿瘤", "化疗", "放疗", "活检", "穿刺",
)

_NODULE_LIKE_HINTS = ("结节", "包块", "肿块", "肿物", "甲状腺", "乳腺")

_MAX_QUESTIONS = 4


@dataclass
class SufficiencyResult:
    enough: bool
    risk_tier: str = "low"  # low | medium | high
    missing: list[str] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    question: str = ""  # 格式化后的编号列表文案
    raw: str = ""


def has_age_info(text: str) -> bool:
    t = text or ""
    if re.search(r"\d{1,3}\s*岁", t):
        return True
    if re.search(r"\d{1,3}\s*个?\s*月", t):
        return True
    if re.search(r"\d{1,3}\s*周", t) and ("龄" in t or "大" in t or "宝宝" in t or "婴儿" in t):
        return True
    if re.search(r"(年龄|周岁|月龄).{0,6}\d{1,3}", t):
        return True
    if any(
        x in t
        for x in ("小儿", "婴儿", "幼儿", "儿童", "老人", "老年", "成年", "中年", "青年", "新生儿")
    ):
        return True
    return False


def has_duration_info(text: str) -> bool:
    t = text or ""
    return bool(
        re.search(
            r"\d+\s*(分钟|小时|天|日|周|星期|月|年)"
            r"|半\s*(天|小时|日)"
            r"|[一两三四五六七八九十数几]+\s*(天|日|周|个月|小时)"
            r"|昨[天日晚]|今[天日早]|刚[刚才]|持续|反复|多久|几天|好久|一会儿",
            t,
        )
    )


def has_sex_info(text: str) -> bool:
    t = text or ""
    return any(x in t for x in ("男", "女", "性别"))


def has_pain_site(text: str) -> bool:
    """疼痛/不适是否已有相对具体的部位描述（含小肚、小腹等口语）。"""
    t = text or ""
    if re.search(
        r"(上腹|下腹|左|右|脐|胸|头|腰|咽|喉|肩|背|膝|小肚|小腹|中腹|胃|盆腔|全腹|整个|中间|周边|心口|肋)",
        t,
    ):
        return True
    if ("肚子" in t or "腹痛" in t or "胃痛" in t) and re.search(
        r"(左|右|上|下|角|侧|小|中|全|周|围|里面|里面|里头)",
        t,
    ):
        return True
    return False


def has_exam_info(text: str) -> bool:
    t = text or ""
    if re.search(r"(未查|没查|没有查|尚未|还没查|无检查)", t):
        return True
    return bool(
        re.search(r"(超声|B超|彩超|CT|MRI|核磁|穿刺|活检|甲功|化验|影像|检查结果|拍片)", t)
    )


def has_symptom_status_info(text: str) -> bool:
    """是否已说明有无伴随症状/不适。"""
    t = text or ""
    if re.search(r"(无症状|没有症状|无不适|无其他|都没|并无|暂无不适)", t):
        return True
    return bool(
        re.search(
            r"(压迫|吞咽|声音|嘶哑|心慌|手抖|发热|疼痛|胀痛|不适|恶心|乏力|消瘦|肿大)",
            t,
        )
    )


def is_nodule_like(summary: str) -> bool:
    return any(h in (summary or "") for h in _NODULE_LIKE_HINTS)


def is_abdominal_pain_case(summary: str) -> bool:
    s = summary or ""
    return any(x in s for x in ("痛", "疼", "胀", "酸")) and (
        "肚子" in s or "腹" in s or has_pain_site(s)
    )


def is_partial_clarify_reply(user_text: str, *, clarify_count: int) -> bool:
    """用户可能只回答了编号问题中的一项。"""
    if clarify_count < 1:
        return False
    t = (user_text or "").strip()
    if not t:
        return False
    if len(t) > 28:
        return False
    if t.count("，") >= 1 or t.count("；") >= 1 or t.count("\n") >= 1:
        return False
    if re.search(r"[1-4][\.、]", t):
        return False
    return True


def looks_serious(text: str) -> bool:
    return any(h in (text or "") for h in _SERIOUS_SYMPTOM_HINTS)


def is_high_stakes_dept(dept_name: str) -> bool:
    n = dept_name or ""
    return any(k in n for k in _HIGH_STAKES_DEPT_KEYS)


def is_practically_enough(summary: str) -> bool:
    """常规症状「部位较具体 + 病程」即可推荐，不因缺年龄直接卡死。"""
    s = (summary or "").strip()
    if len(s) < 6:
        return False
    if looks_serious(s):
        return has_age_info(s) and (has_duration_info(s) or len(s) >= 24)
    # 疼痛类
    if any(x in s for x in ("痛", "疼", "胀", "酸")):
        return has_pain_site(s) and has_duration_info(s)
    # 发热等
    if any(x in s for x in ("烧", "热", "咳", "泻", "吐", "晕")):
        return has_duration_info(s) and (has_age_info(s) or "宝宝" not in s or has_age_info(s))
    return has_duration_info(s) and len(s) >= 12


def is_enough_after_clarify(summary: str, clarify_count: int) -> bool:
    """澄清后：仅对常规腹痛等场景放宽；结节/慢病不因只答一项就视为足够。"""
    if clarify_count < 1:
        return False
    s = (summary or "").strip()
    if len(s) < 10:
        return False
    if looks_serious(s) and not has_age_info(s):
        return False
    if is_nodule_like(s):
        return False
    if is_abdominal_pain_case(s):
        if any(x in s for x in ("痛", "疼", "胀", "酸")):
            return has_duration_info(s) and (
                has_pain_site(s) or has_sex_info(s) or has_age_info(s)
            )
    return False


def format_followup_clarify_block(questions: list[str]) -> str:
    return format_clarify_block(
        questions,
        intro="感谢补充，还请继续说明以下几项（可一次或分次回复）：",
    )


def _question_satisfied(summary: str, question: str) -> bool:
    q = question or ""
    if any(k in q for k in ("多久", "发现", "病程", "持续", "几年", "几个月", "逐渐", "突然")):
        return has_duration_info(summary)
    if any(
        k in q
        for k in ("症状", "压迫", "吞咽", "声音", "嘶哑", "心慌", "手抖", "不适", "伴随", "颈部")
    ):
        return has_symptom_status_info(summary)
    if any(k in q for k in ("超声", "检查", "化验", "穿刺", "B超", "甲功", "影像", "彩超", "TI-RADS", "报告")):
        return has_exam_info(summary)
    if "年龄" in q or "性别" in q:
        return has_age_info(summary) or has_sex_info(summary)
    if "部位" in q or "哪里" in q:
        return has_pain_site(summary) or len(summary) >= 16
    return False


def filter_open_questions(summary: str, questions: list[str]) -> list[str]:
    """去掉已回答过的追问，只保留仍开放的项。"""
    open_qs: list[str] = []
    seen: set[str] = set()
    for q in questions:
        if not q or _question_satisfied(summary, q):
            continue
        key = q.strip()
        if key in seen:
            continue
        seen.add(key)
        open_qs.append(q)
    if open_qs:
        return open_qs[:_MAX_QUESTIONS]
    return _questions_from_missing(summary, _collect_missing(summary))[:_MAX_QUESTIONS]


def format_clarify_block(
    questions: list[str],
    *,
    intro: str = "为更准确帮您分诊，请补充以下几项（可一次性回复）：",
) -> str:
    """把问题收成 1. 2. 3. 列表，最多 4 条。"""
    qs = [q.strip().rstrip("？?。") for q in questions if q and str(q).strip()]
    # 去重保序
    seen: set[str] = set()
    uniq: list[str] = []
    for q in qs:
        if q in seen:
            continue
        seen.add(q)
        uniq.append(q)
    uniq = uniq[:_MAX_QUESTIONS]
    if not uniq:
        uniq = ["具体哪里不舒服", "大概持续多久", "年龄（宝宝请说月龄）"]
    lines = [intro]
    for i, q in enumerate(uniq, 1):
        lines.append(f"{i}. {q}？")
    lines.append("例如：右下腹痛两天，男，30 岁。")
    return "\n".join(lines)


def assess_sufficiency(
    summary: str,
    *,
    clarify_count: int = 0,
    last_questions: list[str] | None = None,
    user_text: str = "",
) -> SufficiencyResult:
    """判断是否足以推荐；不足则一次给出少量核心问题列表。"""
    summary = (summary or "").strip()
    last_questions = list(last_questions or [])
    if len(summary) < 4:
        qs = ["哪里不舒服、什么感觉", "大概持续多久了", "年龄（宝宝请说几岁/几个月）"]
        block = format_clarify_block(qs)
        return SufficiencyResult(
            enough=False,
            risk_tier="medium",
            missing=["症状描述"],
            questions=qs,
            question=block,
        )

    heuristic = _collect_missing(summary)
    try:
        llm = build_chat_model(temperature=0)
        prompt = (
            "你是医院导诊助手。判断患者描述是否足够推荐挂号科室（非确诊）。\n"
            "若不够，请列出最关键的 2～4 个核心问题（不要超过 4 个），让用户一次性回答；\n"
            "不要一问一答式只出一题。勿诊断、勿推荐科室。只输出 JSON。\n\n"
            f"已澄清轮次：{clarify_count}\n"
            f"患者描述：{summary}\n"
            f"规则侧已缺项参考：{heuristic}\n"
        )
        if clarify_count >= 1:
            prompt += (
                "\n注意：用户可能只回答了上一轮中的部分问题。"
                "若仍有缺项，必须 enough=false；questions 只列尚未回答的问题，"
                "不要重复已答过的病程/检查/症状项。常规腹痛已有部位+病程+性别/年龄时可 enough=true；"
                "结节/包块类需有病程，且最好有伴随症状或检查信息。\n"
            )
        prompt += (
            "\n输出："
            '{"enough":true/false,"risk_tier":"low|medium|high",'
            '"missing":["部位"],"questions":["具体疼痛部位","持续多久","年龄或性别"]}'
        )
        msg = llm.invoke(prompt)
        raw = getattr(msg, "content", str(msg)).strip()
        data = _parse_json(raw)
        if not data:
            return _from_missing(
                summary,
                heuristic,
                clarify_count=clarify_count,
                user_text=user_text,
                last_questions=last_questions,
            )

        enough = bool(data.get("enough"))
        if looks_serious(summary) and not has_age_info(summary):
            enough = False
        if is_partial_clarify_reply(user_text, clarify_count=clarify_count) and _collect_missing(
            summary
        ):
            enough = False
        if is_nodule_like(summary) and (
            not has_symptom_status_info(summary) and not has_exam_info(summary)
        ):
            enough = False
        # 常规腹痛等：部位+病程已够，或已澄清且为腹痛场景，覆盖模型过严
        if (
            is_practically_enough(summary)
            or (is_abdominal_pain_case(summary) and is_enough_after_clarify(summary, clarify_count))
        ) and not (looks_serious(summary) and not has_age_info(summary)):
            if not (is_nodule_like(summary) and is_partial_clarify_reply(user_text, clarify_count=clarify_count)):
                enough = True
        missing = data.get("missing") or heuristic
        if not isinstance(missing, list):
            missing = [str(missing)]
        # enough 时清空缺项
        if enough:
            return SufficiencyResult(
                enough=True,
                risk_tier=str(data.get("risk_tier") or "low"),
                missing=[],
                questions=[],
                question="",
                raw=raw,
            )
        questions = data.get("questions") or []
        if not isinstance(questions, list):
            questions = [str(questions)]
        questions = [str(q).strip() for q in questions if str(q).strip()]
        if not questions:
            questions = _questions_from_missing(summary, [str(x) for x in missing])
        # 仅合并仍缺失的规则项，避免把已满足的「病程」再问一遍
        still = _collect_missing(summary)
        for q in _questions_from_missing(summary, still):
            if q not in questions:
                questions.append(q)
        questions = questions[:_MAX_QUESTIONS]
        if clarify_count >= 1 and last_questions:
            questions = filter_open_questions(summary, last_questions)
        elif clarify_count >= 1:
            questions = filter_open_questions(summary, questions)
        if not questions:
            questions = _questions_from_missing(summary, _collect_missing(summary))[:_MAX_QUESTIONS]
        block = (
            format_followup_clarify_block(questions)
            if clarify_count >= 1
            else format_clarify_block(questions)
        )
        return SufficiencyResult(
            enough=False,
            risk_tier=str(data.get("risk_tier") or "medium"),
            missing=[str(x) for x in missing],
            questions=questions,
            question=block,
            raw=raw,
        )
    except Exception:
        return _from_missing(
            summary,
            heuristic,
            clarify_count=clarify_count,
            user_text=user_text,
            last_questions=last_questions,
        )


def needs_clarify_for_candidates(summary: str, candidates: list[dict[str, Any]]) -> str | None:
    """检索后重大专科缺关键信息时，返回编号问题列表。"""
    if not candidates:
        return None
    top = candidates[0].get("dept_name") or ""
    if not is_high_stakes_dept(top):
        return None
    qs: list[str] = []
    if not has_age_info(summary):
        qs.append("年龄（或月龄）")
    if not has_duration_info(summary):
        qs.append("相关情况持续多久、有无加重")
    if looks_serious(summary):
        qs.append("是否已有病理/影像等检查结果")
    if not qs:
        return None
    return format_clarify_block(
        qs,
        intro=f"目前更接近【{top}】方向，推荐前还请补充（可一次性回复）：",
    )


def _collect_missing(summary: str) -> list[str]:
    missing: list[str] = []
    if not has_age_info(summary) and (
        looks_serious(summary) or "宝宝" in summary or "发烧" in summary or "发热" in summary
    ):
        missing.append("年龄")
    if not has_duration_info(summary):
        missing.append("病程")
    if is_nodule_like(summary):
        if not has_symptom_status_info(summary):
            missing.append("伴随症状")
        if not has_exam_info(summary):
            missing.append("检查结果")
    site_ok = any(c in summary for c in ("痛", "疼", "肿", "块", "泻", "咳", "晕", "疹", "酸", "胀"))
    # 「肚子疼」太笼统
    if re.search(r"(肚子疼|腹痛|胃痛)$", summary.strip()) or (
        ("肚子" in summary or "腹痛" in summary) and not has_pain_site(summary)
    ):
        missing.append("部位")
    elif not site_ok and len(summary) < 12:
        missing.append("部位或具体症状")
    if ("肚子" in summary or "腹痛" in summary or "盆腔" in summary) and not has_sex_info(summary):
        missing.append("性别")
    return missing


def _questions_from_missing(summary: str, missing: list[str]) -> list[str]:
    qs: list[str] = []
    mapping = {
        "年龄": "年龄（宝宝请说几岁或几个月）",
        "病程": "大概持续多久、是突然还是逐渐出现",
        "部位": "具体哪个部位最明显（如右下腹/上腹）",
        "部位或具体症状": "具体哪里不舒服、什么感觉",
        "性别": "性别",
        "症状描述": "哪里不舒服、什么感觉",
        "细节": "关键伴随症状（如发烧、恶心）",
        "伴随症状": "有无颈部压迫、吞咽困难、声音嘶哑、心慌手抖等不适",
        "检查结果": "近期是否做过甲状腺超声或相关检查",
    }
    for m in missing:
        q = mapping.get(m, m)
        if q not in qs:
            qs.append(q)
    if not qs:
        qs = ["具体部位", "持续多久", "年龄"]
    # 腹痛默认带上性别若还没有
    if ("肚子" in summary or "腹痛" in summary) and "性别" not in "".join(qs):
        if not has_sex_info(summary) and len(qs) < _MAX_QUESTIONS:
            qs.append("性别")
    return qs[:_MAX_QUESTIONS]


def _from_missing(
    summary: str,
    missing: list[str],
    *,
    clarify_count: int = 0,
    user_text: str = "",
    last_questions: list[str] | None = None,
) -> SufficiencyResult:
    partial = is_partial_clarify_reply(user_text, clarify_count=clarify_count)
    if is_abdominal_pain_case(summary) and is_enough_after_clarify(summary, clarify_count):
        return SufficiencyResult(enough=True, risk_tier="low")
    if is_practically_enough(summary) and not (
        is_nodule_like(summary) and partial and missing
    ):
        return SufficiencyResult(enough=True, risk_tier="low")
    if (
        not missing
        and len(summary) >= 8
        and has_duration_info(summary)
        and not is_nodule_like(summary)
        and not re.search(r"(肚子疼|腹痛|胃痛)$", summary.strip())
    ):
        return SufficiencyResult(enough=True, risk_tier="low")
    if not missing and len(summary) < 8:
        missing = ["细节"]
    qs = _questions_from_missing(summary, missing or ["细节"])
    if clarify_count >= 1:
        qs = filter_open_questions(summary, (last_questions or []) + qs)
    block = (
        format_followup_clarify_block(qs)
        if clarify_count >= 1
        else format_clarify_block(qs)
    )
    return SufficiencyResult(
        enough=False,
        risk_tier="high" if "年龄" in missing else "medium",
        missing=missing,
        questions=qs,
        question=block,
    )


def _default_question(summary: str, missing: list[str]) -> str:
    return format_clarify_block(_questions_from_missing(summary, missing))


def _parse_json(text: str) -> dict[str, Any] | None:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
