import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "登录｜CHEN.DEV",
  description: "登录 CHEN.DEV 个人网站。",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const requestedPath = (await searchParams).next;
  const redirectTo =
    requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : "/";

  return (
    <AuthForm
      mode="login"
      redirectTo={redirectTo}
      captchaPrefix={process.env.ALIYUN_CAPTCHA_PREFIX ?? ""}
      captchaSceneId={process.env.ALIYUN_CAPTCHA_SCENE_ID ?? ""}
      captchaRegion={process.env.ALIYUN_CAPTCHA_REGION ?? "cn"}
    />
  );
}
