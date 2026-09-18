import { NextResponse } from "next/server";

import { getUserVerificationStatus } from "@/lib/server/user-auth";

const agent = () => (process.env.TRIAGE_AGENT_URL ?? "http://localhost:8002").replace(/\/$/, "");

async function rejectUnauthenticated(request: Request) {
  const status = await getUserVerificationStatus(request.headers.get("cookie"));
  return status === 200
    ? null
    : NextResponse.json({ detail: "请先登录" }, { status: status === 401 ? 401 : 503 });
}

export async function GET(request: Request) {
  const unauthorized = await rejectUnauthenticated(request);
  if (unauthorized) return unauthorized;
  try { const r = await fetch(`${agent()}/sessions`, { cache: "no-store" }); return NextResponse.json(await r.json(), { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}

export async function POST(request: Request) {
  const unauthorized = await rejectUnauthenticated(request);
  if (unauthorized) return unauthorized;
  try { const r = await fetch(`${agent()}/sessions`, { method: "POST" }); return NextResponse.json(await r.json(), { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}

export async function DELETE(request: Request) {
  const unauthorized = await rejectUnauthenticated(request);
  if (unauthorized) return unauthorized;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ detail: "缺少会话 ID" }, { status: 400 });
  try { const r = await fetch(`${agent()}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); return new Response(null, { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}
