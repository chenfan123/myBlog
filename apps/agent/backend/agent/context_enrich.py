"""用户短回复的上下文补全：结合上一轮追问，再交意图判断。"""

from __future__ import annotations

import re
from typing import Any

from backend.llm import build_chat_model


def needs_context_enrich(text: str, *, last_stage: str | None, last_assistant: str) -> bool:
    """短答、纯数字时间、或正处澄清轮时需要补全。"""
    t = (text or "").strip()
    if not t:
        return False
    if last_stage == "clarify":
        return True
    if len(t) <= 12 and re.fullmatch(
        r"[\d一二三四五六七八九十半多左右约\.岁个天日周月年]+", t
    ):
        return True
    if last_assistant and len(t) <= 8:
        return True
    return False


def enrich_user_utterance(
    text: str,
    *,
    symptom_summary: str = "",
    last_assistant: str = "",
    last_stage: str | None = None,
) -> str:
    """把「2个月」补成「宝宝年龄约2个月」这类可判断语句。

    失败时回退规则补全；仍失败则返回原文。
    """
    t = (text or "").strip()
    if not t:
        return t
    if not needs_context_enrich(t, last_stage=last_stage, last_assistant=last_assistant):
        return t

    rule = _rule_enrich(t, last_assistant=last_assistant, symptom_summary=symptom_summary)
    try:
        llm = build_chat_model(temperature=0)
        prompt = (
            "你是医院导诊对话理解模块。用户上一轮可能在回答助手的澄清问题。"
            "请把用户本轮短回复改写成一句完整、可独立理解的中文陈述，保留原意，不要新增未提及事实，"
            "不要诊断、不要推荐科室。只输出改写后的那一句话。\n"
            f"已有症状摘要：{symptom_summary or '（无）'}\n"
            f"助手上一问：{last_assistant or '（无）'}\n"
            f"用户本轮原文：{t}\n"
            "改写："
        )
        msg = llm.invoke(prompt)
        out = getattr(msg, "content", str(msg)).strip()
        # 去掉可能的引号
        out = out.strip("「」\"'“”")
        if out and len(out) >= len(t):
            return out
    except Exception:
        pass
    return rule or t


def last_assistant_text(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if m.get("role") == "assistant" and m.get("content"):
            return str(m["content"]).strip()
    return ""


def _rule_enrich(text: str, *, last_assistant: str, symptom_summary: str) -> str | None:
    t = text.strip()
    q = last_assistant or ""
    # 问年龄
    if re.search(r"(多大|几岁|年龄|月龄)", q):
        if re.search(r"\d+\s*(岁|个月|周|天)", t) or t.endswith("岁"):
            who = "宝宝" if ("宝宝" in q or "宝宝" in symptom_summary) else "患者"
            return f"{who}年龄约{t}"
        if re.fullmatch(r"\d+", t):
            who = "宝宝" if ("宝宝" in q or "宝宝" in symptom_summary) else "患者"
            unit = "个月" if ("月" in q or "宝宝" in symptom_summary) else "岁"
            return f"{who}年龄约{t}{unit}"
    # 问性别
    if re.search(r"(男|女|性别)", q) and t in ("男", "女", "男性", "女性", "男孩", "女孩"):
        return f"患者性别为{t}"
    # 问时长且用户只回时间
    if re.search(r"(多久|多长时间|几天|持续|发现|几年|几个月)", q) and re.search(
        r"\d+\s*(分钟|小时|天|日|周|月|年)|[一两三四五六七八九十]+年", t
    ):
        base = symptom_summary.strip("；") if symptom_summary else "相关情况"
        if "结节" in base or "甲状腺" in base:
            dur = re.sub(r"^发现", "", t).strip("有")
            return f"{base}，发现已有{dur}"
        return f"病程约{t}"
    # 纯「2个月」且摘要含宝宝
    if re.fullmatch(r"\d+\s*个月", t) and ("宝宝" in symptom_summary or "婴儿" in symptom_summary):
        return f"宝宝月龄约{t}"
    return None
