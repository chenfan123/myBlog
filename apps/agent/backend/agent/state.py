"""LangGraph 问诊状态定义。"""

from __future__ import annotations

from typing import Any, Literal, TypedDict


Intent = Literal["triage", "schedule", "expert", "other", "end"]
Stage = Literal[
    "collect",
    "clarify",
    "emergency",
    "recommend",
    "schedule",
    "fallback",
    "refuse",
    "end",
]


class TriageState(TypedDict, total=False):
    """单会话问诊状态（每轮 invoke 读写）。"""

    session_id: str
    user_text: str
    messages: list[dict[str, str]]  # {role, content}
    intent: Intent
    symptom_summary: str
    clarify_count: int
    max_clarify: int
    enough_info: bool
    pending_clarify_question: str
    last_clarify_questions: list[str]
    pending_clarify_questions: list[str]
    emergency_triggered: bool
    emergency_message: str
    high_risk: bool
    candidates: list[dict[str, Any]]
    recommendation: dict[str, Any] | None
    schedule_hints: list[dict[str, Any]]
    reply: str
    stage: Stage
    focus_dept: str | None
    last_intent: Intent
    # 内部控制
    route_after_intent: str
    route_after_emergency: str
    route_after_sufficiency: str
    route_after_retrieve: str
