"""LLM 客户端（OpenAI 兼容：千问 DashScope / 通用 LLM_*）。"""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from backend.config import get_llm_settings


def build_chat_model(*, temperature: float | None = None) -> ChatOpenAI:
    settings = get_llm_settings()
    return ChatOpenAI(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.api_base,
        temperature=settings.temperature if temperature is None else temperature,
        timeout=settings.timeout,
    )
