import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const agentUrl = process.env.TRIAGE_AGENT_URL ?? "http://localhost:8002";
  const body = await request.text();

  try {
    const response = await fetch(`${agentUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body,
      cache: "no-store",
    });
    if (!response.ok || !response.body) {
      return NextResponse.json({ detail: "智能导诊服务暂时不可用" }, { status: 502 });
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ detail: "无法连接智能导诊服务，请先启动 Agent 服务" }, { status: 502 });
  }
}
