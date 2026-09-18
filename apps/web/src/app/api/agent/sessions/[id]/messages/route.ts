import { NextResponse } from "next/server";

import { getUserVerificationStatus } from "@/lib/server/user-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authStatus = await getUserVerificationStatus(request.headers.get("cookie"));
  if (authStatus !== 200) {
    return NextResponse.json({ detail: "请先登录" }, { status: authStatus === 401 ? 401 : 503 });
  }
  const agent = (process.env.TRIAGE_AGENT_URL ?? "http://localhost:8002").replace(/\/$/, "");
  try { const r = await fetch(`${agent}/sessions/${encodeURIComponent((await params).id)}/messages`, { cache: "no-store" }); return NextResponse.json(await r.json(), { status: r.status }); }
  catch { return NextResponse.json({ detail: "无法连接智能导诊服务" }, { status: 502 }); }
}
