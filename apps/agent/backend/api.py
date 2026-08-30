"""FastAPI 对话接口（SSE 真流式），对齐 web/src/api.ts。

用法:
    uvicorn backend.api:app --reload --host 127.0.0.1 --port 8001
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from backend.agent.session import iter_turn_events

app = FastAPI(title="浙大一院智能导诊", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    session_id: str = Field(default="")
    message: str


def _sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """SSE：status（阶段进度）→ token（逐字）→ done。"""

    async def event_stream():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        def worker() -> None:
            try:
                for ev in iter_turn_events(req.session_id or None, req.message):
                    loop.call_soon_threadsafe(queue.put_nowait, ev)
            except Exception as exc:  # noqa: BLE001 — 记录后走友好兜底
                import logging

                logging.getLogger(__name__).exception("chat worker failed: %s", exc)
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "error"},
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        threading.Thread(target=worker, daemon=True).start()

        result: dict[str, Any] | None = None
        while True:
            item = await queue.get()
            if item is None:
                break
            if item.get("type") == "status":
                yield _sse({"type": "status", "text": item.get("text") or "处理中…"})
                await asyncio.sleep(0)  # 立刻刷出，避免缓冲
            elif item.get("type") == "result":
                result = item.get("data") or {}
            elif item.get("type") == "error":
                yield _sse(
                    {
                        "type": "done",
                        "stage": "fallback",
                        "session_id": req.session_id or "",
                        "recommendation": None,
                        "high_risk": False,
                    }
                )
                return

        if not result:
            yield _sse({"type": "token", "text": "未能生成回复，请稍后再试。"})
            yield _sse(
                {
                    "type": "done",
                    "stage": "fallback",
                    "session_id": req.session_id or "",
                    "recommendation": None,
                    "high_risk": False,
                }
            )
            return

        reply = result.get("reply") or ""
        # 逐字（2 字一块）输出，带轻微间隔，保证浏览器可见流式效果
        step = 2
        for i in range(0, len(reply), step):
            yield _sse({"type": "token", "text": reply[i : i + step]})
            await asyncio.sleep(0.02)

        yield _sse(
            {
                "type": "done",
                "stage": result.get("stage") or "end",
                "session_id": result.get("session_id"),
                "recommendation": result.get("recommendation"),
                "high_risk": bool(result.get("high_risk")),
            }
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
