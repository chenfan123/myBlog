import { NextResponse } from "next/server";
import { getAdminVerificationStatus } from "@/lib/server/admin-auth";

const allowedSuffixes = new Set(["png", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);

export async function POST(request: Request) {
  const verificationStatus = await getAdminVerificationStatus(
    request.headers.get("cookie"),
  );
  if (verificationStatus !== 204) {
    return NextResponse.json(
      { message: verificationStatus === 403 ? "没有管理员权限" : "请先登录管理员账户" },
      { status: verificationStatus === 403 ? 403 : 401 },
    );
  }

  const body = (await request.json()) as {
    suffix?: string;
    width?: number;
    height?: number;
    biz?: string;
    scene?: string;
  };
  const suffix = body.suffix?.toLowerCase();
  if (!suffix || !allowedSuffixes.has(suffix)) {
    return NextResponse.json({ message: "不支持的图片格式" }, { status: 400 });
  }
  if (!Number.isInteger(body.width) || !Number.isInteger(body.height) || body.width! <= 0 || body.height! <= 0) {
    return NextResponse.json({ message: "图片尺寸无效" }, { status: 400 });
  }

  const apiHost = process.env.CDN_API_HOST ?? "https://api.heribase.com";
  const apiPath = process.env.CDN_API_PATH ?? "/app/v1";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (process.env.CDN_UPLOAD_UT) headers.set("ut", process.env.CDN_UPLOAD_UT);
  if (process.env.CDN_UPLOAD_UUID) headers.set("uuid", process.env.CDN_UPLOAD_UUID);

  const response = await fetch(`${apiHost.replace(/\/$/, "")}${apiPath}/file-pre-signed-req`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: 1,
      suffix,
      biz: body.biz ?? "appraiser",
      scene: body.scene ?? "coin",
      width: body.width,
      height: body.height,
    }),
    cache: "no-store",
  }).catch(() => null);

  if (!response) {
    return NextResponse.json({ message: "无法连接 CDN 服务" }, { status: 502 });
  }
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: { preUrl?: string; visitUrl?: string };
  } | null;
  if (!response.ok || payload?.code !== 0 || !payload.data?.preUrl || !payload.data.visitUrl) {
    return NextResponse.json({ message: payload?.msg ?? "获取上传地址失败" }, { status: 502 });
  }

  return NextResponse.json(payload.data);
}
