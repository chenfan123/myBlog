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
