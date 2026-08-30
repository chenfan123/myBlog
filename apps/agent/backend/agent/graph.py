"""LangGraph 问诊状态图编译。

节点与边一览（单轮 invoke 从 START 走到 END）：

  START
    │
    ▼
  ingest ─────────── 写入本轮用户话、累积症状摘要
    │
    ▼
  intent ─────────── 识别意图：导诊 / 排班 / 专家 / 拒答 / 结束
    ├─ refuse ──► refuse ──► END（闲聊、超范围、提示词探测）
    ├─ end ─────► end ────► END（结束问诊，清空上下文）
    ├─ schedule ► schedule ──► END
    ├─ expert ──► expert ────► END
    └─ triage ──► emergency ── 急诊红旗（导诊主链必跑）
                    ├─ 命中 ──► emergency_exit ──► END
                    └─ 未命中 ► check_info
                                  ├─ 信息不足且未超澄清上限 ► clarify ──► END
                                  ├─ 信息足够 ► retrieve
                                  └─ 澄清已达上限 ► fallback ──► END
                                          │
                                          ▼
                                      retrieve ── 混合检索科室候选
                                        ├─ 置信够 ► recommend（含 LLM 复核）──► END
                                        └─ 无结果/低分 ► fallback ──► END
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from backend.agent import nodes
from backend.agent.state import TriageState


# ── 条件边路由函数：读节点写回的 route_* 字段，决定下一跳 ─────────────


def _after_intent(state: TriageState) -> str:
    """intent 之后：拒答 / 排班 / 专家 / 导诊主链。"""
    return state.get("route_after_intent") or "triage"


def _after_emergency(state: TriageState) -> str:
    """emergency 之后：红旗命中则急诊出口，否则继续信息充分性判断。"""
    return state.get("route_after_emergency") or "check_info"


def _after_sufficiency(state: TriageState) -> str:
    """check_info 之后：够则检索；不够则澄清；超限则兜底。"""
    return state.get("route_after_sufficiency") or "retrieve"


def _after_retrieve(state: TriageState) -> str:
    """retrieve 之后：有合格候选则推荐（内含 LLM 复核），否则兜底。"""
    return state.get("route_after_retrieve") or "recommend"


def build_triage_graph():
    """构建并编译问诊图。"""
    g = StateGraph(TriageState)

    # ── 节点注册 ──────────────────────────────────────────────────
    g.add_node("ingest", nodes.node_ingest)  # 接入本轮输入，累积 messages / symptom_summary
    g.add_node("intent", nodes.node_intent)  # 意图分流：triage | schedule | expert | refuse | end
    g.add_node("refuse", nodes.node_refuse)  # 安全拒答：闲聊 / 提示词探测 / 超范围
    g.add_node("end", nodes.node_end)  # 结束问诊：收尾并清空导诊上下文
    g.add_node("emergency", nodes.node_emergency)  # 急诊红旗检测（导诊主链必经）
    g.add_node("check_info", nodes.node_check_info)  # 判断症状信息是否够用分诊
    g.add_node("clarify", nodes.node_clarify)  # 生成澄清追问，本轮结束等用户补充
    g.add_node("retrieve", nodes.node_retrieve)  # 调混合检索拿科室候选
    g.add_node("recommend", nodes.node_recommend)  # LLM 复核候选后输出主推/备选
    g.add_node("schedule", nodes.node_schedule)  # 出诊/有号意图：查 PG 排班
    g.add_node("expert", nodes.node_expert)  # 专家/医生意图：查医生向量+排班
    g.add_node("fallback", nodes.node_fallback)  # 低置信/复核未过：引导人工/导诊台
    g.add_node("emergency_exit", nodes.node_emergency_exit)  # 急诊出口：强提示，阻断常规推荐

    # ── 固定边 ────────────────────────────────────────────────────
    g.add_edge(START, "ingest")
    g.add_edge("ingest", "intent")

    # ── 条件边：intent → 五条路径 ─────────────────────────────────
    g.add_conditional_edges(
        "intent",
        _after_intent,
        {
            "refuse": "refuse",  # 闲聊/探测：直接拒答
            "end": "end",  # 结束问诊
            "triage": "emergency",  # 症状导诊：进入急诊判断
            "schedule": "schedule",  # 问出诊/有号
            "expert": "expert",  # 问专家/医生
        },
    )

    g.add_conditional_edges(
        "emergency",
        _after_emergency,
        {
            "emergency_exit": "emergency_exit",
            "check_info": "check_info",
        },
    )

    g.add_conditional_edges(
        "check_info",
        _after_sufficiency,
        {
            "clarify": "clarify",
            "retrieve": "retrieve",
            "fallback": "fallback",
        },
    )

    g.add_conditional_edges(
        "retrieve",
        _after_retrieve,
        {
            "recommend": "recommend",  # 内含 LLM 复核；未通过则节点内改写为兜底话术
            "fallback": "fallback",
            "clarify": "clarify",  # 命中重大专科但缺年龄等 → 继续追问
        },
    )

    g.add_edge("refuse", END)
    g.add_edge("end", END)
    g.add_edge("clarify", END)
    g.add_edge("recommend", END)
    g.add_edge("schedule", END)
    g.add_edge("expert", END)
    g.add_edge("fallback", END)
    g.add_edge("emergency_exit", END)

    return g.compile()


_GRAPH = None


def get_graph():
    """懒加载编译后的图（进程内单例）。"""
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_triage_graph()
    return _GRAPH
