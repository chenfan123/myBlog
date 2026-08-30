"""项目配置：从 .env 加载 Embedding / Milvus 等参数。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# 本地开发使用 .env.local；服务器通过 Compose 注入环境变量，也兼容旧的 .env。
load_dotenv(PROJECT_ROOT / ".env", override=False)
load_dotenv(PROJECT_ROOT / ".env.local", override=True)


def _normalize_api_base(url: str | None) -> str | None:
    if not url:
        return None
    cleaned = url.rstrip("/")
    for suffix in ("/chat/completions", "/embeddings"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
    return cleaned


def _normalize_embedding_base(url: str | None) -> str | None:
    return _normalize_api_base(url)


@dataclass(frozen=True)
class Settings:
    embedding_api_key: str
    embedding_api_base: str
    embedding_model: str
    milvus_uri: str
    milvus_db: str
    milvus_collection: str
    milvus_doctor_collection: str
    milvus_dept_hier_collection: str
    milvus_mapping_collection: str
    embed_batch_size: int


@dataclass(frozen=True)
class LlmSettings:
    api_key: str
    api_base: str
    model: str
    temperature: float
    timeout: float


@dataclass(frozen=True)
class RerankSettings:
    enabled: bool
    api_key: str
    api_url: str
    model: str
    top_n: int
    timeout: float
    instruct: str


def _normalize_embedding_model(model: str) -> str:
    cleaned = model.strip()
    if not cleaned:
        return "openai:text-embedding-3-large"
    if ":" in cleaned:
        return cleaned
    return f"openai:{cleaned}"


def get_settings() -> Settings:
    api_key = os.getenv("EMBEDDING_API_KEY") or os.getenv("OPEN_302_API_KEY") or ""
    base = _normalize_embedding_base(
        os.getenv("EMBEDDING_API_BASE") or os.getenv("OPEN_302_API_BASE")
    )
    if not api_key or not base:
        raise RuntimeError(
            "请在 .env 中配置 EMBEDDING_API_KEY 与 EMBEDDING_API_BASE（或 OPEN_302_* 别名）"
        )
    model = (
        os.getenv("EMBEDDING_MODEL")
        or os.getenv("EMBEDDING_API_MODEL")
        or "text-embedding-3-large"
    )
    return Settings(
        embedding_api_key=api_key,
        embedding_api_base=base,
        embedding_model=_normalize_embedding_model(model),
        milvus_uri=os.getenv("MILVUS_URI", "http://localhost:19530"),
        milvus_db=os.getenv("MILVUS_DB", "zy91_triage"),
        milvus_collection=os.getenv("MILVUS_COLLECTION", "dept_chunks"),
        milvus_doctor_collection=os.getenv("MILVUS_DOCTOR_COLLECTION", "doctor_profiles"),
        milvus_dept_hier_collection=os.getenv(
            "MILVUS_DEPT_HIER_COLLECTION", "dept_chunks_hierarchical"
        ),
        milvus_mapping_collection=os.getenv(
            "MILVUS_MAPPING_COLLECTION", "dept_symptom_mappings"
        ),
        embed_batch_size=int(os.getenv("EMBED_BATCH_SIZE", "32")),
    )


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("请在 .env 中配置 DATABASE_URL（PostgreSQL 连接串）")
    return url


def get_llm_settings() -> LlmSettings:
    """LLM 配置：优先千问 DashScope（DASHSCOPE_*），其次 LLM_* 通用覆盖。"""
    api_key = (
        os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("LLM_API_KEY")
        or ""
    )
    api_base = _normalize_api_base(
        os.getenv("DASHSCOPE_API_BASE") or os.getenv("LLM_API_BASE")
    ) or ""
    if not api_key or not api_base:
        raise RuntimeError(
            "请在 .env 中配置 DASHSCOPE_API_KEY 与 DASHSCOPE_API_BASE（或 LLM_API_KEY/LLM_API_BASE）"
        )
    model = (
        os.getenv("DASHSCOPE_MODEL")
        or os.getenv("LLM_MODEL")
        or "qwen-plus"
    )
    return LlmSettings(
        api_key=api_key,
        api_base=api_base,
        model=model.strip(),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.1")),
        timeout=float(os.getenv("LLM_TIMEOUT", "120")),
    )


def get_rerank_settings() -> RerankSettings:
    """Rerank 配置：千问 qwen3-vl-rerank（DashScope text-rerank API）。"""
    api_key = (
        os.getenv("RERANK_API_KEY")
        or os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("LLM_API_KEY")
        or ""
    )
    api_url = (
        os.getenv("RERANK_API_URL")
        or "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
    ).strip()
    if not api_key:
        raise RuntimeError(
            "请在 .env 中配置 RERANK_API_KEY 或 DASHSCOPE_API_KEY（Rerank 复用千问密钥）"
        )
    enabled_raw = os.getenv("RERANK_ENABLED", "true").strip().lower()
    return RerankSettings(
        enabled=enabled_raw in ("1", "true", "yes", "on"),
        api_key=api_key,
        api_url=api_url,
        model=os.getenv("RERANK_MODEL", "qwen3-vl-rerank").strip(),
        top_n=int(os.getenv("RERANK_TOP_N", "5")),
        timeout=float(os.getenv("RERANK_TIMEOUT", "30")),
        instruct=os.getenv(
            "RERANK_INSTRUCT",
            "Given a web search query, retrieve relevant passages that answer the query.",
        ).strip(),
    )
