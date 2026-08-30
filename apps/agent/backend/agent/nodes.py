"""问诊节点实现。"""

from __future__ import annotations

import json
import re
from typing import Any

from backend.agent.clinical_priors import (
    challenge_reply_preface,
    reorder_candidates,
    try_deterministic_selection,
)
from backend.agent.dept_focus import resolve_focus_dept, is_dept_challenge, extract_dept_mentions
from backend.agent.intent import classify_intent, is_end_consultation, llm_classify_intent
from backend.agent.review import review_department_candidates
from backend.agent.safety import (
    OFF_TOPIC_REPLY,
    PROBE_REFUSE_REPLY,
    is_prompt_probe,
    sanitize_reply,
    scrub_symptom_append,
)
from backend.agent.state import TriageState
from backend.agent.sufficiency import (
    assess_sufficiency,
    is_abdominal_pain_case,
    is_enough_after_clarify,
    is_high_stakes_dept,
    is_nodule_like,
    is_partial_clarify_reply,
    is_practically_enough,
    needs_clarify_for_candidates,
)
from backend.agent.timeparse import (
    ScheduleTarget,
    partition_schedule_rows,
    resolve_schedule_target,
    weekday_cn,
)
from backend.db import get_session_factory
from backend.emergency import assess_emergency
from backend.llm import build_chat_model
from backend.retriever import DepartmentRetriever, search_doctors
from backend.schedule_db import list_schedule_by_dept

DISCLAIMER = (
    "温馨提示：以上为导诊建议，不能替代医师面诊与诊断，紧急情况请拨打 120 或前往急诊。"
)

END_CONSULTATION_REPLY = (
    "好的，本次问诊已结束。祝您早日康复。"
    "如需再次导诊，直接描述症状或询问出诊即可。"
)

_MIN_RETRIEVAL_SCORE = 0.35
_retriever: DepartmentRetriever | None = None


def _get_retriever() -> DepartmentRetriever:
    global _retriever
    if _retriever is None:
        _retriever = DepartmentRetriever()
    return _retriever


def node_ingest(state: TriageState) -> dict[str, Any]:
    """接入本轮用户输入：追加 messages，累积 symptom_summary。

    注意：不改写 stage，保留上一轮 clarify/recommend 等，供意图与上下文补全使用。
    结束问诊话术不写入 symptom_summary，避免污染后续新开问诊。
    """
    text = (state.get("user_text") or "").strip()
    messages = list(state.get("messages") or [])
    if text:
        messages.append({"role": "user", "content": text})
    summary = state.get("symptom_summary") or ""
    if text and not is_end_consultation(text):
        summary = f"{summary}；{text}".strip("；") if summary else text
    return {
        "messages": messages,
        "symptom_summary": summary,
    }


def node_intent(state: TriageState) -> dict[str, Any]:
    """意图识别：先做上下文补全，再分类。"""
    from backend.agent.context_enrich import enrich_user_utterance, last_assistant_text

    raw = (state.get("user_text") or "").strip()
    prev_focus = state.get("focus_dept")
    last_intent = state.get("last_intent") or state.get("intent")
    last_stage = state.get("stage")
    rec = state.get("recommendation")
    has_rec = bool(rec and rec.get("primary"))
    # ingest 已把原文拼进 summary，补全时用去掉本轮原文的摘要更干净
    summary_all = state.get("symptom_summary") or ""
    summary_before = scrub_symptom_append(summary_all, raw)
    assistant_q = last_assistant_text(state.get("messages"))

    # 结束问诊：跳过补全与摘要污染
    if is_end_consultation(raw):
        return {
            "intent": "end",
            "last_intent": "end",
            "route_after_intent": "end",
            "user_text": raw,
            "symptom_summary": summary_before,
            "focus_dept": prev_focus,
        }

    enriched = enrich_user_utterance(
        raw,
        symptom_summary=summary_before,
        last_assistant=assistant_q,
        last_stage=last_stage,
    )
    # 用补全后的话替换 summary 中的短原文，便于后续充分性/检索
    if enriched and enriched != raw and summary_all.endswith(raw):
        summary_all = (summary_before + ("；" if summary_before else "") + enriched).strip("；")

    # 首轮先让大模型理解自然语言，再由规则做安全兜底；后续轮次沿用上下文规则，减少成本和延迟。
    llm_intent = llm_classify_intent(enriched) if not state.get("messages") or len(state.get("messages") or []) <= 1 else None
    intent = llm_intent or classify_intent(
        enriched,
        last_intent=last_intent,  # type: ignore[arg-type]
        last_stage=last_stage,
        focus_dept=prev_focus,
        has_recommendation=has_rec,
        symptom_summary=summary_before or summary_all,
    )
    focus = resolve_focus_dept(enriched, prev_focus)
    if not focus and prev_focus:
        focus = prev_focus
    if not focus and has_rec:
        pname = (rec.get("primary") or {}).get("deptName") or ""
        focus = resolve_focus_dept(pname, None) or pname or None

    # 「为什么不考虑妇科」：把提及的科室设为焦点，后续检索优先纳入
    challenge_note = ""
    if is_dept_challenge(raw) or is_dept_challenge(enriched):
        mentions = extract_dept_mentions(enriched) or extract_dept_mentions(raw)
        if mentions:
            focus = resolve_focus_dept(mentions[0], None) or focus
            challenge_note = mentions[0]

    if intent == "end":
        return {
            "intent": "end",
            "last_intent": "end",
            "route_after_intent": "end",
            "user_text": enriched,
            "symptom_summary": summary_before,
            "focus_dept": focus,
        }

    if intent == "other":
        summary = scrub_symptom_append(summary_all, raw)
        if enriched != raw:
            summary = scrub_symptom_append(summary, enriched)
        probe = is_prompt_probe(raw)
        return {
            "intent": intent,
            "last_intent": intent,
            "route_after_intent": "refuse",
            "symptom_summary": summary,
            "focus_dept": focus,
            "user_text": enriched,
            "reply": PROBE_REFUSE_REPLY if probe else OFF_TOPIC_REPLY,
        }

    updates: dict[str, Any] = {
        "intent": intent,
        "last_intent": intent,
        "focus_dept": focus,
        "user_text": enriched,
        "symptom_summary": summary_all,
    }
    if challenge_note:
        # 质疑科室不拼进症状摘要，避免污染检索
        updates["symptom_summary"] = summary_before or summary_all
        updates["pending_clarify_question"] = f"__challenge__:{challenge_note}"
    if intent in ("expert", "schedule"):
        updates["symptom_summary"] = scrub_symptom_append(summary_all, raw)
        if enriched != raw:
            updates["symptom_summary"] = scrub_symptom_append(
                updates["symptom_summary"], enriched
            )
        updates["route_after_intent"] = intent
    else:
        updates["route_after_intent"] = "triage"
    return updates


def node_end(state: TriageState) -> dict[str, Any]:
    """结束问诊：友好收尾并清空导诊上下文，便于下一轮新开。"""
    reply = sanitize_reply(END_CONSULTATION_REPLY)
    messages = list(state.get("messages") or [])
    messages.append({"role": "assistant", "content": reply})
    return {
        "reply": reply,
        "messages": messages,
        "stage": "end",
        "intent": "end",
        "last_intent": "end",
        "symptom_summary": "",
        "clarify_count": 0,
        "enough_info": False,
        "pending_clarify_question": "",
        "emergency_triggered": False,
        "emergency_message": "",
        "high_risk": False,
        "candidates": [],
        "recommendation": None,
        "schedule_hints": [],
        "focus_dept": None,
    }


def node_refuse(state: TriageState) -> dict[str, Any]:
    """拒答出口：闲聊 / 超范围 / 提示词探测，不进入检索与推荐。"""
    reply = sanitize_reply(state.get("reply") or OFF_TOPIC_REPLY)
    messages = list(state.get("messages") or [])
    messages.append({"role": "assistant", "content": reply})
    return {
        "reply": reply,
        "messages": messages,
        "stage": "refuse",
    }


def node_emergency(state: TriageState) -> dict[str, Any]:
    """急诊红旗：命中则 route→emergency_exit，否则→check_info。"""
    blob = state.get("symptom_summary") or state.get("user_text") or ""
    result = assess_emergency(blob)
    if result.triggered:
        return {
            "emergency_triggered": True,
            "emergency_message": result.message,
            "high_risk": True,
            "reply": result.message,
            "stage": "emergency",
            "route_after_emergency": "emergency_exit",
        }
    return {
        "emergency_triggered": False,
        "high_risk": False,
        "route_after_emergency": "check_info",
    }


def node_check_info(state: TriageState) -> dict[str, Any]:
    """信息充分性（LLM+规则）：够→retrieve；不够→clarify；澄清超限尽量仍检索。"""
    summary = (state.get("symptom_summary") or "").strip()
    user_text = (state.get("user_text") or "").strip()
    clarify_count = int(state.get("clarify_count") or 0)
    max_clarify = int(state.get("max_clarify") or 4)
    last_questions = list(state.get("last_clarify_questions") or [])

    result = assess_sufficiency(
        summary,
        clarify_count=clarify_count,
        last_questions=last_questions,
        user_text=user_text,
    )
    enough = result.enough or is_practically_enough(summary)
    if is_abdominal_pain_case(summary):
        enough = enough or is_enough_after_clarify(summary, clarify_count)
    if is_partial_clarify_reply(user_text, clarify_count=clarify_count) and result.missing:
        enough = False
    elif is_nodule_like(summary) and result.missing:
        enough = False

    if enough:
        pending = state.get("pending_clarify_question") or ""
        keep = pending if pending.startswith("__challenge__:") else ""
        return {
            "enough_info": True,
            "route_after_sufficiency": "retrieve",
            "pending_clarify_question": keep,
        }

    _SYMPTOM_RETRIEVE_CUES = (
        "痛", "疼", "烧", "咳", "泻", "晕", "肿", "块", "吐", "热", "结节", "甲状腺", "包块",
    )
    if clarify_count >= max_clarify:
        if len(summary) >= 6 and any(x in summary for x in _SYMPTOM_RETRIEVE_CUES):
            return {
                "enough_info": True,
                "route_after_sufficiency": "retrieve",
                "pending_clarify_question": "",
            }
        return {
            "enough_info": False,
            "route_after_sufficiency": "fallback",
            "reply": (
                "目前掌握的信息仍较少，暂不能稳妥推荐科室。"
                "建议补充具体部位、持续时间后重试，或前往医院导诊台咨询。\n"
                f"{DISCLAIMER}"
            ),
            "stage": "fallback",
        }

    question = result.question or _build_clarify_question(summary, result.missing)
    return {
        "enough_info": False,
        "route_after_sufficiency": "clarify",
        "pending_clarify_question": question,
        "pending_clarify_questions": result.questions,
    }


def node_clarify(state: TriageState) -> dict[str, Any]:
    """一次列出少量核心问题（编号），本轮结束等用户合并回复。"""
    count = int(state.get("clarify_count") or 0) + 1
    summary = state.get("symptom_summary") or ""
    question = (state.get("pending_clarify_question") or "").strip()
    questions = list(state.get("pending_clarify_questions") or [])
    if not question:
        question = _build_clarify_question(summary, [])
    if not questions:
        questions = _parse_numbered_questions(question)
    question = sanitize_reply(question)
    messages = list(state.get("messages") or [])
    messages.append({"role": "assistant", "content": question})
    return {
        "clarify_count": count,
        "reply": question,
        "messages": messages,
        "stage": "clarify",
        "pending_clarify_question": "",
        "pending_clarify_questions": [],
        "last_clarify_questions": questions,
    }


def _parse_numbered_questions(block: str) -> list[str]:
    """从编号澄清文案中解析问题列表。"""
    qs: list[str] = []
    for line in (block or "").splitlines():
        m = re.match(r"^\s*\d+\.\s*(.+)\s*$", line.strip())
        if m:
            q = m.group(1).strip().rstrip("？?。")
            if q and not q.startswith("例如"):
                qs.append(q)
    return qs[:4]


def _build_clarify_question(summary: str, missing: list[str] | None = None) -> str:
    from backend.agent.sufficiency import format_clarify_block, _questions_from_missing

    missing = missing or []
    try:
        llm = build_chat_model(temperature=0.2)
        prompt = (
            "你是医院导诊助手。根据患者描述，列出 2～4 个最关键的补充问题（不要超过 4 个），"
            "用于一次性收集信息。不要诊断，不要推荐科室。只输出 JSON："
            '{"questions":["问题1","问题2"]}。\n'
            f"已有描述：{summary or '（很少）'}\n"
            f"已知缺项：{missing or '（按常识判断）'}"
        )
        msg = llm.invoke(prompt)
        raw = getattr(msg, "content", str(msg)).strip()
        data = None
        try:
            import json
            import re

            m = re.search(r"\{[\s\S]*\}", raw)
            data = json.loads(m.group(0) if m else raw)
        except Exception:
            data = None
        if isinstance(data, dict) and data.get("questions"):
            qs = [str(x) for x in data["questions"] if str(x).strip()]
            if qs:
                return format_clarify_block(qs)
    except Exception:
        pass
    return format_clarify_block(_questions_from_missing(summary, missing))


def node_retrieve(state: TriageState) -> dict[str, Any]:
    """混合检索科室；置信达标→recommend，否则→fallback。"""
    query = state.get("symptom_summary") or state.get("user_text") or ""
    focus = (state.get("focus_dept") or "").strip()
    # 用户点名/质疑某科时，把焦点并入检索 query
    if focus and focus not in query:
        query = f"{query} {focus}".strip()
    try:
        hits = _get_retriever().search_departments(query, top_k=5, rerank=True)
    except Exception as exc:
        return {
            "candidates": [],
            "route_after_retrieve": "fallback",
            "reply": (
                f"知识库检索暂时不可用（{type(exc).__name__}），请稍后再试或前往导诊台咨询。\n"
                f"{DISCLAIMER}"
            ),
            "stage": "fallback",
        }
    candidates = [
        {
            "dept_id": h.dept_id,
            "dept_name": h.dept_name,
            "score": h.rerank_score if h.rerank_score is not None else h.fused_score,
            "evidence": h.evidence,
            "sources": h.sources,
            "category_label": h.category_label,
        }
        for h in hits
    ]
    if not candidates:
        return {
            "candidates": [],
            "route_after_retrieve": "fallback",
            "reply": (
                "暂时未能从知识库匹配到合适科室。"
                "建议前往医院导诊台咨询。\n"
                f"{DISCLAIMER}"
            ),
            "stage": "fallback",
        }
    top_score = float(candidates[0]["score"] or 0)
    if top_score < _MIN_RETRIEVAL_SCORE:
        return {
            "candidates": candidates,
            "route_after_retrieve": "fallback",
            "reply": (
                "根据现有描述，系统匹配结果置信度较低，暂不直接推荐科室。"
                "建议您到院内导诊台由工作人员协助。\n"
                f"{DISCLAIMER}"
            ),
            "stage": "fallback",
        }

    # 重大专科命中但缺年龄等 → 先追问，不强推肿瘤外科等
    summary = state.get("symptom_summary") or ""
    clarify_count = int(state.get("clarify_count") or 0)
    max_clarify = int(state.get("max_clarify") or 4)
    # 常规症状：去掉肿瘤等重大专科；女性小腹痛优先妇科
    candidates = _demote_high_stakes_if_routine(summary, candidates)
    candidates = reorder_candidates(summary, candidates, focus_dept=focus or None)
    followup = needs_clarify_for_candidates(summary, candidates)
    if followup and clarify_count < max_clarify:
        return {
            "candidates": candidates,
            "route_after_retrieve": "clarify",
            "pending_clarify_question": followup,
            "enough_info": False,
        }

    return {"candidates": candidates, "route_after_retrieve": "recommend"}


def _demote_high_stakes_if_routine(
    summary: str, candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """非常规重大病史时，去掉肿瘤/放疗等候选（有年龄也不强推肿瘤外科）。"""
    from backend.agent.sufficiency import looks_serious

    if not candidates:
        return candidates
    if looks_serious(summary):
        return candidates
    routine = [c for c in candidates if not is_high_stakes_dept(c.get("dept_name") or "")]
    return routine if routine else candidates


def node_recommend(state: TriageState) -> dict[str, Any]:
    """检索候选经规则层 + LLM 复核后，生成主推/备选。"""
    summary = state.get("symptom_summary") or ""
    focus = state.get("focus_dept")
    candidates = _demote_high_stakes_if_routine(summary, list(state.get("candidates") or []))
    candidates = reorder_candidates(summary, candidates, focus_dept=focus or None)
    if not candidates:
        reply = sanitize_reply(
            "暂时未能确认合适科室，建议前往医院导诊台咨询。\n" + DISCLAIMER
        )
        return {
            "reply": reply,
            "stage": "fallback",
            "recommendation": None,
            "messages": _append_assistant(state, reply),
        }

    pending = state.get("pending_clarify_question") or ""
    challenged = ""
    if pending.startswith("__challenge__:"):
        challenged = pending.split(":", 1)[1].strip()

    # 规则层：命中则确定性择科，LLM 仅处理未覆盖的模糊场景
    rule_sel = try_deterministic_selection(
        summary,
        candidates,
        focus_dept=focus,
        challenged_dept=challenged,
    )

    if rule_sel:
        review_primary = rule_sel.primary_idx
        review_alt = rule_sel.alt_idx
        review_reason = rule_sel.reason
    else:
        review = review_department_candidates(
            symptom_summary=summary,
            candidates=candidates,
        )
        if not review.accepted:
            clarify_count = int(state.get("clarify_count") or 0)
            max_clarify = int(state.get("max_clarify") or 4)
            followup = needs_clarify_for_candidates(summary, candidates)
            if followup and clarify_count < max_clarify:
                reply = sanitize_reply(followup)
                return {
                    "reply": reply,
                    "stage": "clarify",
                    "clarify_count": clarify_count + 1,
                    "recommendation": None,
                    "messages": _append_assistant(state, reply),
                    "enough_info": False,
                }
            if candidates and not is_high_stakes_dept(candidates[0].get("dept_name") or ""):
                review_primary = 0
                review_alt = 1 if len(candidates) > 1 else None
                review_reason = "按症状与科室匹配推荐"
            else:
                reply = sanitize_reply(
                    "经复核，现有匹配尚不足以稳妥推荐具体科室"
                    + (f"（{review.reject_reason}）" if review.reject_reason else "")
                    + "。建议您到院内导诊台由工作人员协助分诊。\n"
                    + DISCLAIMER
                )
                return {
                    "reply": reply,
                    "stage": "fallback",
                    "recommendation": None,
                    "messages": _append_assistant(state, reply),
                }
        else:
            review_primary = review.primary_idx
            review_alt = review.alt_idx
            review_reason = review.reason

    primary = candidates[review_primary]
    alt = candidates[review_alt] if review_alt is not None else None

    schedule_lines = _schedule_summary(primary.get("dept_name") or "", primary.get("dept_id"))
    reason = review_reason or _short(
        primary.get("evidence") or "根据您的症状与科室擅长方向匹配", 80
    )
    primary_info = {
        "deptName": primary["dept_name"],
        "system": primary.get("category_label") or "临床科室",
        "reason": _short(reason, 80),
        "citation": _short(primary.get("evidence") or "", 120),
        "visit": schedule_lines or "请以医院当日号源与导诊安排为准。",
        "sourceUrl": "https://www.zy91.com/department",
    }
    alt_info = None
    if alt:
        alt_info = {
            "deptName": alt["dept_name"],
            "system": alt.get("category_label") or "临床科室",
            "reason": _short(alt.get("evidence") or "备选参考", 80),
            "citation": _short(alt.get("evidence") or "", 120),
            "visit": "请以医院当日号源为准。",
            "sourceUrl": "https://www.zy91.com/department",
        }

    recommendation = {"primary": primary_info, "alternative": alt_info}
    preface = challenge_reply_preface(summary, challenged, primary_info["deptName"])
    reply = sanitize_reply(
        preface + _format_recommend_reply(primary_info, alt_info, schedule_lines)
    )
    focus_out = resolve_focus_dept(primary_info["deptName"], None) or primary_info["deptName"]
    return {
        "recommendation": recommendation,
        "schedule_hints": [],
        "reply": reply,
        "messages": _append_assistant(state, reply),
        "stage": "recommend",
        "focus_dept": focus_out,
        "last_intent": "triage",
        "pending_clarify_question": "",
    }


def _append_assistant(state: TriageState, reply: str) -> list[dict[str, str]]:
    messages = list(state.get("messages") or [])
    messages.append({"role": "assistant", "content": reply})
    return messages


def node_schedule(state: TriageState) -> dict[str, Any]:
    """排班意图：优先展示目标日（今天/明天/指定星期），再附其他时段。"""
    from datetime import date

    dept_name, dept_keyword, dept_id = _resolve_schedule_dept(state)
    user_text = state.get("user_text") or ""
    today = date.today()
    target = resolve_schedule_target(user_text, today=today)
    if not target:
        target = ScheduleTarget(weekday_cn(today), "今天", False)

    if not dept_name and not dept_keyword:
        reply = sanitize_reply(
            "想查询出诊时间的话，请先告诉我目标科室，或先描述症状让我推荐科室。"
            "例如「疼痛科明天有哪些医生出诊」。\n"
            f"{DISCLAIMER}"
        )
        return {"reply": reply, "stage": "schedule", "messages": _append_assistant(state, reply)}

    label = dept_name or dept_keyword or "相关科室"
    rows = _fetch_schedule_rows(
        dept_name or "",
        dept_id,
        dept_keyword=dept_keyword if not dept_name else None,
    )
    if not rows and dept_name:
        rows = _fetch_schedule_rows("", None, dept_keyword=dept_name)

    if not rows:
        reply = (
            f"已定位到【{label}】，但本地排班库暂未查到具体出诊时段。"
            "请以医院公众号/窗口当日号源为准。\n"
            f"{DISCLAIMER}"
        )
    else:
        primary_rows, other_rows = partition_schedule_rows(rows, target)
        primary_lines = _format_schedule_rows(primary_rows, limit=8)
        other_lines = _format_schedule_rows(other_rows, limit=8)

        if primary_lines:
            head = (
                f"【{label}】{target.label}（{target.weekday}）可挂号参考：\n"
                f"{primary_lines}"
            )
        else:
            head = (
                f"【{label}】{target.label}（{target.weekday}）暂未查到出诊记录。"
            )

        if other_lines:
            reply = f"{head}\n\n其他时段出诊参考：\n{other_lines}\n{DISCLAIMER}"
        else:
            reply = f"{head}\n{DISCLAIMER}"

    rec = state.get("recommendation") or {}
    alt = (rec.get("alternative") or {}).get("deptName")
    if alt and alt != label:
        reply = reply.replace(
            DISCLAIMER,
            f"备选【{alt}】也可再问我「{alt}{target.label}有谁出诊」。\n{DISCLAIMER}",
        )

    reply = sanitize_reply(reply)
    focus = state.get("focus_dept") or resolve_focus_dept(label, None) or label
    return {
        "reply": reply,
        "messages": _append_assistant(state, reply),
        "stage": "schedule",
        "focus_dept": focus,
    }


def _resolve_schedule_dept(state: TriageState) -> tuple[str, str | None, str | None]:
    """返回 (精确科室名, 模糊关键词, dept_id)。"""
    rec = state.get("recommendation")
    if rec and rec.get("primary"):
        name = rec["primary"].get("deptName") or ""
        if name:
            return name, resolve_focus_dept(name, None) or name, None

    focus = state.get("focus_dept")
    if focus:
        return "", focus, None

    query = state.get("user_text") or state.get("symptom_summary") or ""
    hint = resolve_focus_dept(query, None)
    if hint:
        return "", hint, None

    # 最后才无上下文检索，避免乱跳到无关大科室
    return "", None, None


def node_expert(state: TriageState) -> dict[str, Any]:
    """专家意图：按焦点科室过滤医生检索，并可附带相关科室排班。"""
    focus = state.get("focus_dept")
    user_text = state.get("user_text") or ""
    # 检索 query：优先本轮话术 + 焦点科室，避免错误摘要污染
    query_parts = [p for p in (focus, user_text) if p]
    query = " ".join(query_parts) if query_parts else (state.get("symptom_summary") or "")
    doctors = search_doctors(query, top_k=3, dept_hint=focus)
    if not doctors:
        label = focus or "该方向"
        reply = (
            f"暂时没有匹配到【{label}】相关专家信息。"
            "您可以换个科室名称再试，或先描述症状由我推荐科室。\n"
            f"{DISCLAIMER}"
        )
        reply = sanitize_reply(reply)
        return {
            "reply": reply,
            "stage": "schedule",
            "messages": _append_assistant(state, reply),
            "focus_dept": focus,
        }

    lines = []
    for d in doctors:
        lines.append(
            f"- {d['name']}（{d.get('title') or '医师'}）· {d.get('dept_name')}\n"
            f"  {_short(d.get('text') or '', 70)}"
        )
    # 焦点科室以检索结果为准回写
    result_dept = doctors[0].get("dept_name") or focus
    schedule = _schedule_summary(result_dept or "", doctors[0].get("dept_id"))
    head = f"【{result_dept}】可供参考的医生：" if result_dept else "可供参考的医生："
    reply = head + "\n" + "\n".join(lines)
    if schedule:
        reply += f"\n\n相关科室出诊摘要：\n{schedule}"
    reply += f"\n{DISCLAIMER}"
    reply = sanitize_reply(reply)
    return {
        "reply": reply,
        "messages": _append_assistant(state, reply),
        "stage": "schedule",
        "focus_dept": focus or resolve_focus_dept(result_dept or ""),
    }


def node_fallback(state: TriageState) -> dict[str, Any]:
    """兜底：信息不稳或检索失败时引导导诊台/人工，不强推科室。"""
    reply = sanitize_reply(
        state.get("reply")
        or (
            "信息仍不足以完成可靠导诊，建议前往医院导诊台或咨询人工服务。\n"
            f"{DISCLAIMER}"
        )
    )
    messages = list(state.get("messages") or [])
    if not messages or messages[-1].get("content") != reply:
        messages.append({"role": "assistant", "content": reply})
    return {"reply": reply, "messages": messages, "stage": "fallback", "recommendation": None}


def node_emergency_exit(state: TriageState) -> dict[str, Any]:
    """急诊出口：输出 120/急诊强提示，标记 high_risk，阻断常规推荐。"""
    reply = sanitize_reply(state.get("emergency_message") or state.get("reply") or "")
    messages = list(state.get("messages") or [])
    messages.append({"role": "assistant", "content": reply})
    return {
        "reply": reply,
        "messages": messages,
        "stage": "emergency",
        "recommendation": None,
        "high_risk": True,
    }


def _fetch_schedule_rows(
    dept_name: str,
    dept_id: str | None = None,
    *,
    dept_keyword: str | None = None,
) -> list[dict[str, Any]]:
    if not dept_name and not dept_id and not dept_keyword:
        return []
    try:
        factory = get_session_factory()
        with factory() as session:
            rows = list_schedule_by_dept(
                session,
                dept_id=str(dept_id) if dept_id else None,
                department_name=dept_name or None,
                dept_keyword=dept_keyword,
            )
        if not rows and dept_name and not dept_keyword:
            with factory() as session:
                rows = list_schedule_by_dept(session, dept_keyword=dept_name)
        return rows
    except Exception:
        return []


def _format_schedule_rows(rows: list[dict[str, Any]], *, limit: int = 8) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for r in rows:
        if not r.get("doctor_name"):
            continue
        key = (
            f"{r.get('weekday')}-{r.get('period')}-{r.get('doctor_name')}-{r.get('campus')}"
        )
        if key in seen:
            continue
        seen.add(key)
        parts.append(
            f"· {r.get('campus') or ''} {r.get('weekday') or ''}{r.get('period') or ''} "
            f"{r.get('doctor_name')}（{r.get('clinic_type') or ''}）"
        )
        if len(parts) >= limit:
            break
    return "\n".join(parts)


def _schedule_summary(
    dept_name: str,
    dept_id: str | None = None,
    *,
    dept_keyword: str | None = None,
    weekday: str | None = None,
) -> str:
    """推荐卡片附带的出诊摘要：优先目标日，最多 8 条。"""
    rows = _fetch_schedule_rows(dept_name, dept_id, dept_keyword=dept_keyword)
    if not rows:
        return ""
    if weekday:
        target = ScheduleTarget(weekday, weekday, True)
        primary, _ = partition_schedule_rows(rows, target)
        return _format_schedule_rows(primary or rows, limit=8)
    from datetime import date

    target = ScheduleTarget(weekday_cn(date.today()), "今天", False)
    primary, others = partition_schedule_rows(rows, target)
    combined = primary + others
    return _format_schedule_rows(combined, limit=8)


def _short(text: str, n: int) -> str:
    t = " ".join(text.split())
    return t if len(t) <= n else t[: n - 1] + "…"


def _format_recommend_reply(
    primary: dict[str, Any],
    alt: dict[str, Any] | None,
    schedule_lines: str,
) -> str:
    lines = [
        f"根据您的描述，建议优先挂【{primary['deptName']}】。",
        f"推荐理由：{primary['reason']}",
    ]
    if primary.get("citation"):
        lines.append(f"依据：{primary['citation']}")
    if schedule_lines:
        lines.append("出诊参考：\n" + schedule_lines)
    else:
        lines.append(f"就医提示：{primary.get('visit')}")
    if alt:
        lines.append(f"备选可考虑【{alt['deptName']}】：{alt['reason']}")
    lines.append(DISCLAIMER)
    return "\n".join(lines)
