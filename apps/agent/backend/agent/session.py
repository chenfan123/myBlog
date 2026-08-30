"""会话状态存储与单轮推进（支持流式进度事件）。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

from backend.agent.graph import get_graph
from backend.agent.state import TriageState

_SESSIONS: dict[str, TriageState] = {}

_NODE_STATUS: dict[str, str] = {
    "ingest": "正在接收您的描述…",
    "intent": "正在识别意图…",
    "refuse": "正在整理回复…",
    "end": "正在结束问诊…",
    "emergency": "正在进行急诊筛查…",
    "check_info": "正在评估是否还需补充信息…",
    "clarify": "正在生成追问…",
    "retrieve": "正在检索科室知识库…",
    "recommend": "正在复核并生成推荐…",
    "schedule": "正在查询出诊安排…",
    "expert": "正在检索相关专家…",
    "fallback": "正在整理导诊建议…",
    "emergency_exit": "正在生成急诊提示…",
}


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]


def get_or_create_state(session_id: str | None) -> tuple[str, TriageState]:
    sid = session_id or new_session_id()
    if sid not in _SESSIONS:
        _SESSIONS[sid] = {
            "session_id": sid,
            "messages": [],
            "symptom_summary": "",
            "clarify_count": 0,
            "max_clarify": 4,
            "last_clarify_questions": [],
            "pending_clarify_questions": [],
            "enough_info": False,
            "emergency_triggered": False,
            "high_risk": False,
            "candidates": [],
            "recommendation": None,
            "schedule_hints": [],
            "reply": "",
            "stage": "collect",
            "intent": "triage",
            "focus_dept": None,
            "last_intent": "triage",
        }
    return sid, _SESSIONS[sid]


def _result_from_state(sid: str, out: TriageState) -> dict[str, Any]:
    return {
        "session_id": sid,
        "reply": out.get("reply") or "",
        "stage": out.get("stage") or "end",
        "recommendation": out.get("recommendation"),
        "high_risk": bool(out.get("high_risk")),
        "intent": out.get("intent"),
        "clarify_count": out.get("clarify_count", 0),
        "symptom_summary": out.get("symptom_summary") or "",
    }


def run_turn(session_id: str | None, user_text: str) -> dict[str, Any]:
    """推进一轮对话，返回对外字段。"""
    result: dict[str, Any] | None = None
    for ev in iter_turn_events(session_id, user_text):
        if ev.get("type") == "result":
            result = ev["data"]
    assert result is not None
    return result


def iter_turn_events(session_id: str | None, user_text: str) -> Iterator[dict[str, Any]]:
    """流式推进一轮：先产出 status，最后产出 result。

    事件:
      {"type": "status", "text": "...", "node": "..."}
      {"type": "result", "data": {session_id, reply, stage, ...}}
    """
    sid, state = get_or_create_state(session_id)
    state = {**state, "user_text": user_text}
    graph = get_graph()

    yield {"type": "status", "text": "正在分析您的问题…", "node": "start"}

    merged: dict[str, Any] = dict(state)
    for update in graph.stream(state, stream_mode="updates"):
        if not isinstance(update, dict):
            continue
        for node_name, delta in update.items():
            text = _NODE_STATUS.get(str(node_name), "正在处理…")
            yield {"type": "status", "text": text, "node": str(node_name)}
            if isinstance(delta, dict):
                merged.update(delta)

    out: TriageState = merged  # type: ignore[assignment]
    _SESSIONS[sid] = out
    yield {"type": "result", "data": _result_from_state(sid, out)}


def reset_session(session_id: str) -> None:
    _SESSIONS.pop(session_id, None)
