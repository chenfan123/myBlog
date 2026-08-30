"""千问 DashScope Rerank 客户端（qwen3-vl-rerank）。

本模块是混合检索 pipeline 的「精排」步骤，位于 retriever 三路召回与融合去重之后。
召回阶段追求「宽进」（高召回率），Rerank 阶段追求「准出」（高准确率）。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、为什么需要 Rerank
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三路召回的融合分是启发式加权（关键词 1.0 / 映射向量 0.9 / child 0.8），
无法真正理解「用户问题 vs 候选科室」的语义匹配程度。实测问题：

    query: 「甲状腺结节挂什么科」
    映射向量 Top1 → 核医学科（语义相近但非首选挂号科室）
    关键词 Top1  → 甲状腺外科（精确命中）

Rerank 模型对 query 与每条候选文档做 cross-encoder 式相关性打分，
可将「甲状腺外科」排到首位。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、模型与 API 格式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前默认模型: qwen3-vl-rerank（支持文本/图片/视频，本场景仅用文本）

注意：DashScope 有两种 Rerank API 格式，不可混用：

    qwen3-vl-rerank / gte-rerank-v2  → nested 格式（本模块使用）
        POST .../api/v1/services/rerank/text-rerank/text-rerank
        body: { model, input: { query, documents }, parameters: { top_n, ... } }

    qwen3-rerank                     → flat Cohere 兼容格式（本模块不用）
        POST .../compatible-api/v1/reranks
        body: { model, query, documents, top_n, ... }

响应结构（qwen3-vl-rerank）:
    {
      "output": {
        "results": [
          { "index": 0, "relevance_score": 0.93 },  // index 对应输入 documents 下标
          ...
        ]
      },
      "request_id": "...",
      "usage": { "total_tokens": 79 }
    }

失败时 HTTP 可能仍为 200，但 body 含 code/message 字段。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、配置（.env）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    RERANK_ENABLED=true          retriever 是否调用本模块
    RERANK_API_KEY=              留空则复用 DASHSCOPE_API_KEY
    RERANK_API_URL=              text-rerank 端点（见上）
    RERANK_MODEL=qwen3-vl-rerank
    RERANK_TOP_N=5               默认返回条数
    RERANK_TIMEOUT=30            HTTP 超时秒数
    RERANK_INSTRUCT=...          排序任务指令（英文，影响排序策略）

RERANK_INSTRUCT 示例:
    问答检索（默认）: "Given a web search query, retrieve relevant passages that answer the query."
    语义相似:       "Retrieve semantically similar text."

API 文档: https://help.aliyun.com/zh/model-studio/text-rerank-api
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from backend.config import RerankSettings, get_rerank_settings


@dataclass(frozen=True)
class RerankHit:
    """单条 Rerank 结果。

    Attributes:
        index: 对应调用方传入 documents 列表的下标（0-based）。
               retriever 用此下标找回原始 DeptHit 对象。
        relevance_score: 相关性分数，范围约 0~1，越高表示与 query 越相关。
                         注意：该分数仅在单次 API 请求内可用于排序，
                         不可跨请求比较绝对值。
    """

    index: int
    relevance_score: float


def rerank_documents(
    query: str,
    documents: list[str],
    *,
    settings: RerankSettings | None = None,
    top_n: int | None = None,
) -> list[RerankHit]:
    """对候选文档按与 query 的相关性重排序。

    典型调用方: backend.retriever._apply_rerank()
    典型输入:   query = 用户导诊问题
                documents = 各候选科室的 rerank_text（科室名 + 关键词 + 依据）

    Args:
        query: 用户原始问题，如「甲状腺结节挂什么科」。
               最大约 4000 tokens（模型限制）。
        documents: 待排序的候选文档列表。
                   顺序必须与 retriever 候选池一致，因返回的 index 依赖此顺序。
                   qwen3-vl-rerank 文本模式最多 100 条/次。
        settings: Rerank 配置；None 时从 .env 读取。
        top_n: 返回前 N 条；None 时用 settings.top_n；不超过 len(documents)。

    Returns:
        按 relevance_score 降序排列的结果列表。
        每条含原始 index 和 score，调用方据此重排 DeptHit。

    Raises:
        RuntimeError: API 业务错误（body 含 code 字段）。
        httpx.HTTPError: 网络超时、4xx/5xx 等 HTTP 层错误。
                         retriever 会捕获并回退到融合分排序。
    """
    # ── 边界：空列表无需调 API ──
    if not documents:
        return []

    settings = settings or get_rerank_settings()
    limit = top_n if top_n is not None else settings.top_n
    limit = min(limit, len(documents))

    # ── 构造请求体（qwen3-vl-rerank 必须使用 nested 结构）──
    # query 和 documents 均需 {"text": "..."} 包装（纯字符串也可，但 dict 更规范）
    payload = {
        "model": settings.model,
        "input": {
            "query": {"text": query},
            "documents": [{"text": doc} for doc in documents],
        },
        "parameters": {
            # 不返回文档原文，只要 index + score，减少响应体积
            "return_documents": False,
            "top_n": limit,
            # instruct 指导模型采用何种排序策略（问答 vs 语义相似）
            "instruct": settings.instruct,
        },
    }

    headers = {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
    }

    # ── 发起 HTTP 请求 ──
    with httpx.Client(timeout=settings.timeout) as client:
        response = client.post(settings.api_url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    # ── 解析响应 ──
    # DashScope 失败时可能 HTTP 200 但 body 含 code/message（如无权限、模型不存在）
    if data.get("code"):
        raise RuntimeError(
            f"Rerank API 失败: {data.get('code')} — {data.get('message', data)}"
        )

    # 成功时结果在 output.results 中（与 qwen3-rerank flat 格式的顶层 results 不同）
    raw_results = (data.get("output") or {}).get("results") or []
    hits = [
        RerankHit(
            index=int(item["index"]),
            relevance_score=float(item["relevance_score"]),
        )
        for item in raw_results
    ]
    # API 返回顺序不保证，本地再按 score 降序排一次
    hits.sort(key=lambda h: h.relevance_score, reverse=True)
    return hits
