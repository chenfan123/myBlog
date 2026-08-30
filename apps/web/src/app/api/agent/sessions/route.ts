import { NextResponse } from "next/server";

const agent = () => (process.env.TRIAGE_AGENT_URL ?? "http://localhost:8002").replace(/\/$/, "");

export async function GET() {
  try { const r = await fetch(`${agent()}/sessions`, { cache: "no-store" }); return NextResponse.json(await r.json(), { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}

export async function POST() {
  try { const r = await fetch(`${agent()}/sessions`, { method: "POST" }); return NextResponse.json(await r.json(), { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ detail: "缺少会话 ID" }, { status: 400 });
  try { const r = await fetch(`${agent()}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); return new Response(null, { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}
