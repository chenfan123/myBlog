import { NextResponse } from "next/server";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = (process.env.TRIAGE_AGENT_URL ?? "http://localhost:8002").replace(/\/$/, "");
  try { const r = await fetch(`${agent}/sessions/${encodeURIComponent((await params).id)}/messages`, { cache: "no-store" }); return NextResponse.json(await r.json(), { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}
