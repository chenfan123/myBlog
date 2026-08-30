import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "注册｜CHEN.DEV",
  description: "注册 CHEN.DEV 个人网站账户。",
};

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <AuthForm
      mode="register"
      captchaPrefix={process.env.ALIYUN_CAPTCHA_PREFIX ?? ""}
      captchaSceneId={process.env.ALIYUN_CAPTCHA_SCENE_ID ?? ""}
      captchaRegion={process.env.ALIYUN_CAPTCHA_REGION ?? "cn"}
    />
  );
}
