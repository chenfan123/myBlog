import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiBaseUrl =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000";

/** 校验当前请求是否对应一个有效的登录用户。 */
export async function getUserVerificationStatus(cookieHeader: string | null) {
  if (!cookieHeader) return 401;

  const response = await fetch(`${apiBaseUrl}/api/v1/auth/me`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store",
  }).catch(() => null);

  return response?.status ?? 503;
}

/** 服务端页面鉴权，并保留登录后应返回的准确地址。 */
export async function requireAuthenticatedPage(nextPath: string): Promise<void> {
  const cookieStore = await cookies();
  const authStatus = await getUserVerificationStatus(cookieStore.toString());

  if (authStatus === 401) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (authStatus !== 200) {
    redirect("/");
  }
}
