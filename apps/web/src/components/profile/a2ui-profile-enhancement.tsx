"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import type { Profile, SkillGroup } from "@/lib/resume";

type A2UIProfileEnhancementProps = {
  profile: Profile;
  skillGroups: SkillGroup[];
  children: ReactNode;
};

const A2UI_EMBED_URL =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:5173/a2ui/index.html?embed=profile"
    : "/a2ui-profile/index.html?embed=profile";

export function A2UIProfileEnhancement({
  profile,
  skillGroups,
  children,
}: A2UIProfileEnhancementProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback" | "error">("loading");

  const sendProfile = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "a2ui:profile-input",
        payload: {
          name: profile.name,
          role: profile.role,
          introduction: profile.introduction,
          phone: profile.phone,
          email: profile.email,
          availability: profile.availability || "开放机会",
          skillGroups,
        },
      },
      "*",
    );
  }, [profile, skillGroups]);

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => setStatus("error"), 290_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!event.data?.type?.startsWith?.("a2ui:profile-")) return;
      if (event.data?.type === "a2ui:profile-listening") sendProfile();
      if (event.data?.type === "a2ui:profile-ready") setStatus("ready");
      if (event.data?.type === "a2ui:profile-fallback") setStatus("fallback");
      if (event.data?.type === "a2ui:profile-error") setStatus("error");
    };

    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [sendProfile]);

  return (
    <div className="relative min-h-[620px] lg:min-h-0">
      <span
        className={`print-hidden absolute right-6 top-6 z-20 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-[0_10px_28px_rgba(95,148,0,0.2)] ${
          status === "error" || status === "fallback"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-lime-300 bg-primary text-primary-foreground"
        }`}
      >
          <Sparkles className="size-4" />
          {status === "loading"
            ? "当前为兜底展示 · A2UI 动态生成中"
            : status === "ready"
              ? "A2UI 动态生成"
              : status === "fallback"
                ? "当前为兜底展示 · A2UI 后台生成中"
                : "A2UI 请求异常 · 当前为兜底展示"}
      </span>
      <div className={status === "ready" ? "hidden print:block" : "block"}>
        {children}
      </div>
      <iframe
        ref={iframeRef}
        src={A2UI_EMBED_URL}
        title="A2UI 个人介绍"
        onLoad={() => {
          setStatus("loading");
          sendProfile();
        }}
        onError={() => setStatus("error")}
        className={`print-hidden absolute inset-0 size-full border-0 bg-white ${status === "ready" ? "visible" : "invisible pointer-events-none"}`}
      />
    </div>
  );
}
