"""用大模型把自然语言病情拆成主诉、背景病史与检索语义。"""

from __future__ import annotations

import json
import re
from typing import Any

from backend.llm import build_chat_model


def parse_clinical_context(
    *,
    user_text: str,
    symptom_summary: str,
) -> dict[str, Any] | None:
    """解析本轮就诊重点；失败时返回 None，交由既有规则链兜底。"""
    text = (user_text or "").strip()
    summary = (symptom_summary or text).strip()
    if not summary:
        return None

    prompt = (
        "你是医院导诊场景的临床语义解析器，不做诊断、不推荐科室。"
        "请区分本次就诊主诉与既往/慢性背景，不要因为背景疾病名称更明确就压过当前新发症状。\n"
        "判断原则：\n"
        "1. 今天、刚刚、突然、最近、新出现、加重等修饰的症状，通常是本次主诉；\n"
        "2. ‘我有/一直有/以前有/病史’描述的慢病通常属于 medical_history；\n"
        "3. ‘想复查/控制/看某疾病’表示该疾病是本次主诉；\n"
        "4. 必须识别‘没有/否认/不’修饰的阴性症状；\n"
        "5. 只要主诉已经能用于科室级导诊，needs_clarification=false；"
        "只有部位或表达过于含糊、会明显改变科室时才为 true；\n"
        "6. 只输出 JSON，不要 Markdown。\n\n"
        f"本轮用户原话：{text}\n"
        f"会话累计描述：{summary}\n\n"
        "输出格式："
        '{"chief_complaints":[{"name":"头疼","onset":"今天","priority":1}],'
        '"medical_history":[{"name":"高血糖"}],'
        '"negated_symptoms":[],"user_goal":"本次症状导诊",'
        '"needs_clarification":false,"clarification_reason":"",'
        '"confidence":0.92}'
    )
    try:
        msg = build_chat_model(temperature=0, timeout=15, max_retries=0).invoke(prompt)
        raw = getattr(msg, "content", str(msg)).strip()
        data = _parse_json(raw)
        return _normalize_context(data) if data else None
    except Exception:
        return None


def build_retrieval_query(context: dict[str, Any], fallback: str) -> str:
    """主诉优先构造检索文本，背景病史只作为辅助条件出现一次。"""
    complaints = _names(context.get("chief_complaints"))
    history = _names(context.get("medical_history"))
    negated = [x for x in _names(context.get("negated_symptoms")) if x not in complaints]
    if not complaints:
        return fallback

    primary = "、".join(complaints)
    parts = [f"本次主要就诊原因：{primary}", f"请重点根据{primary}匹配挂号科室"]
    if history:
        parts.append(f"合并背景病史：{'、'.join(history)}（仅作为辅助背景）")
    if negated:
        parts.append(f"已否认：{'、'.join(negated)}")
    return "。".join(parts)


def _names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        name = item.get("name") if isinstance(item, dict) else item
        name = str(name or "").strip()
        if name and name not in result:
            result.append(name)
    return result


def _normalize_context(data: dict[str, Any]) -> dict[str, Any]:
    complaints = data.get("chief_complaints")
    history = data.get("medical_history")
    negated = data.get("negated_symptoms")
    return {
        "chief_complaints": complaints if isinstance(complaints, list) else [],
        "medical_history": history if isinstance(history, list) else [],
        "negated_symptoms": negated if isinstance(negated, list) else [],
        "user_goal": str(data.get("user_goal") or "").strip(),
        "needs_clarification": bool(data.get("needs_clarification", False)),
        "clarification_reason": str(data.get("clarification_reason") or "").strip(),
        "confidence": _confidence(data.get("confidence")),
    }


def _confidence(value: Any) -> float:
    try:
        return max(0.0, min(float(value), 1.0))
    except (TypeError, ValueError):
        return 0.0


def _parse_json(text: str) -> dict[str, Any] | None:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return None
        try:
            value = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None
