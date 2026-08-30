"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runAliyunCaptcha } from "@/lib/aliyun-captcha";
import { login, register, sendRegistrationEmailCode } from "@/lib/auth";

type AuthMode = "login" | "register";

export function AuthForm({
  mode,
  captchaPrefix = "",
  captchaSceneId = "",
  captchaRegion = "cn",
  redirectTo = "/",
}: {
  mode: AuthMode;
  captchaPrefix?: string;
  captchaSceneId?: string;
  captchaRegion?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const isRegister = mode === "register";
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => {
      setCountdown((seconds) => Math.max(seconds - 1, 0));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  async function handleSendCode() {
    setError("");
    setNotice("");
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("请先输入有效的邮箱地址");
      return;
    }

    setSendingCode(true);
    try {
      const captchaVerifyParam = await runAliyunCaptcha({
        prefix: captchaPrefix,
        sceneId: captchaSceneId,
        region: captchaRegion,
      });
      const result = await sendRegistrationEmailCode({
        email: normalizedEmail,
        captcha_verify_param: captchaVerifyParam,
      });
      setCountdown(Math.max(result.retry_after_seconds, 60));
      setNotice(result.message);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "验证码发送失败");
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      if (isRegister) {
        const confirmPassword = String(formData.get("confirmPassword") ?? "");
        if (password !== confirmPassword) {
          throw new Error("两次输入的密码不一致");
        }
        await register({
          display_name: String(formData.get("displayName") ?? "").trim(),
          email,
          password,
          email_code: String(formData.get("emailCode") ?? "").trim(),
        });
      } else {
        const captchaVerifyParam = await runAliyunCaptcha({
          prefix: captchaPrefix,
          sceneId: captchaSceneId,
          region: captchaRegion,
        });
        await login({
          email,
          password,
          captcha_verify_param: captchaVerifyParam,
        });
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "请求失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-8 sm:px-8 lg:grid lg:place-items-center lg:py-12">
      <div className="pointer-events-none absolute -left-28 top-24 size-80 rounded-full bg-lime-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 size-96 rounded-full bg-emerald-100/40 blur-3xl" />

      <section className="relative mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2rem] border bg-white/90 shadow-[0_32px_90px_-62px_oklch(0.3_0.04_145/0.45)] lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative overflow-hidden border-b bg-[#eef5d9] p-8 lg:border-b-0 lg:border-r lg:p-12">
          <div className="absolute -right-16 -top-16 size-52 rounded-full border-[38px] border-white/35" />
          <Link href="/" className="relative inline-flex items-center gap-2 font-mono text-sm font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">C</span>
            CHEN.DEV
          </Link>

          <div className="relative mt-20 lg:mt-32">
            <p className="text-sm text-primary">CHEN.DEV 账户</p>
            <h1 className="mt-5 max-w-sm text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {isRegister ? "注册" : "登录"}
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
              {isRegister
                ? "注册后可以使用网站后续开放的个人功能。"
                : "使用你的邮箱和密码登录。"}
            </p>
          </div>

          <p className="relative mt-12 border-t border-lime-950/10 pt-5 text-xs leading-6 text-muted-foreground">账户目前主要用于本站功能体验，简历和公开博客无需登录也能查看。</p>
        </aside>

        <div className="p-7 sm:p-12 lg:p-14">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" /> 返回个人主页
          </Link>

          <div className="mt-10">
            <p className="text-sm text-primary">{isRegister ? "新用户" : "已有账户"}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">{isRegister ? "注册账户" : "登录账户"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isRegister ? "已经有账户？" : "还没有账户？"}{" "}
              <Link className="font-medium text-primary hover:underline" href={isRegister ? "/login" : "/register"}>
                {isRegister ? "直接登录" : "立即注册"}
              </Link>
            </p>
          </div>

          <form className="mt-9 space-y-5" onSubmit={handleSubmit}>
            {isRegister ? (
              <Field icon={UserRound} label="姓名" name="displayName" placeholder="如何称呼你" autoComplete="name" minLength={2} />
            ) : null}
            <Field icon={Mail} label="邮箱" name="email" type="email" placeholder="name@example.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            {isRegister ? (
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="emailCode">邮箱验证码</label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <ShieldCheck className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="emailCode" name="emailCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="h-12 pl-10 font-mono tracking-[0.25em]" placeholder="6 位验证码" />
                  </div>
                  <Button type="button" variant="outline" disabled={sendingCode || countdown > 0} onClick={handleSendCode} className="h-12 min-w-28 rounded-xl">
                    {sendingCode ? "验证中…" : countdown > 0 ? `${countdown}s` : "获取验证码"}
                  </Button>
                </div>
              </div>
            ) : null}
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="password">密码</label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : 1} required className="h-12 pl-10 pr-11" placeholder={isRegister ? "至少 8 位，包含字母和数字" : "输入你的密码"} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {!isRegister ? <div className="-mt-2 text-right"><Link href="/forgot-password" className="text-sm text-primary hover:underline">忘记密码？</Link></div> : null}
            {isRegister ? <Field icon={LockKeyhole} label="确认密码" name="confirmPassword" type="password" placeholder="再次输入密码" autoComplete="new-password" minLength={8} /> : null}

            {error ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
            {notice ? <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</p> : null}

            <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-sm">
              {pending ? (isRegister ? "正在创建账户…" : "正在登录…") : isRegister ? "创建账户" : "登录"}
              {pending ? null : <ArrowRight />}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">遇到登录问题，可以通过首页邮箱联系我。</p>
        </div>
      </section>
    </main>
  );
}

function Field({ icon: Icon, label, name, ...props }: { icon: typeof Mail; label: string; name: string } & React.ComponentProps<typeof Input>) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium" htmlFor={name}>{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={name} name={name} required className="h-12 pl-10" {...props} />
      </div>
    </div>
  );
}
