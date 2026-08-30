import { NextResponse } from "next/server";
import { getAdminVerificationStatus } from "@/lib/server/admin-auth";

const maxImageSize = 10 * 1024 * 1024;
const suffixByMimeType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

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

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const width = Number(formData?.get("width"));
  const height = Number(formData?.get("height"));
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "请选择需要上传的图片" }, { status: 400 });
  }
  const suffix = suffixByMimeType[file.type];
  if (!suffix) {
    return NextResponse.json({ message: "不支持的图片格式" }, { status: 400 });
  }
  if (file.size > maxImageSize) {
    return NextResponse.json({ message: "图片不能超过 10MB" }, { status: 400 });
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return NextResponse.json({ message: "图片尺寸无效" }, { status: 400 });
  }

  const apiHost = process.env.CDN_API_HOST ?? "https://api.heribase.com";
  const apiPath = process.env.CDN_API_PATH ?? "/app/v1";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (process.env.CDN_UPLOAD_UT) headers.set("ut", process.env.CDN_UPLOAD_UT);
  if (process.env.CDN_UPLOAD_UUID) headers.set("uuid", process.env.CDN_UPLOAD_UUID);

  const presignResponse = await fetch(
    `${apiHost.replace(/\/$/, "")}${apiPath}/file-pre-signed-req`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: 1,
        suffix,
        biz: String(formData?.get("biz") ?? "appraiser"),
        scene: String(formData?.get("scene") ?? "coin"),
        width,
        height,
      }),
      cache: "no-store",
    },
  ).catch(() => null);
  if (!presignResponse) {
    return NextResponse.json({ message: "无法连接 CDN 服务" }, { status: 502 });
  }

  const payload = (await presignResponse.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: { preUrl?: string; visitUrl?: string };
  } | null;
  const preUrl = payload?.data?.preUrl;
  const visitUrl = payload?.data?.visitUrl;
  if (!presignResponse.ok || payload?.code !== 0 || !preUrl || !visitUrl) {
    return NextResponse.json(
      { message: payload?.msg ?? "获取上传地址失败" },
      { status: 502 },
    );
  }

  const fileBytes = await file.arrayBuffer();
  const uploadResponse = await fetch(preUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: fileBytes,
  }).catch(() => null);
  if (!uploadResponse?.ok) {
    const detail = await uploadResponse?.text().catch(() => "");
    console.error("CDN upload failed", uploadResponse?.status, detail);
    return NextResponse.json({ message: "图片上传到 CDN 失败" }, { status: 502 });
  }

  return NextResponse.json({ url: visitUrl, width, height });
}
