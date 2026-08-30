const apiBaseUrl =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000";

export async function getAdminVerificationStatus(cookieHeader: string | null) {
  if (!cookieHeader) return 401;

  const response = await fetch(`${apiBaseUrl}/api/v1/admin/verify`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store",
  }).catch(() => null);

  return response?.status ?? 503;
}
