"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import type { Profile, SkillGroup } from "@/lib/resume";

type A2UIProfileEnhancementProps = {
  profile: Profile;
  skillGroups: SkillGroup[];
  children: ReactNode;
};

export function A2UIProfileEnhancement({
  profile,
  skillGroups,
  children,
}: A2UIProfileEnhancementProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const sendProfile = () => {
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
        window.location.origin,
      );
    };

    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "a2ui:profile-listening") sendProfile();
      if (event.data?.type === "a2ui:profile-ready") setStatus("ready");
      if (event.data?.type === "a2ui:profile-error") setStatus("error");
    };

    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [profile, skillGroups]);

  return (
    <div className="relative min-h-[620px] lg:min-h-0">
      <span
        className={`print-hidden absolute right-6 top-6 z-20 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-[0_10px_28px_rgba(95,148,0,0.2)] ${
          status === "error"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-lime-300 bg-primary text-primary-foreground"
        }`}
      >
          <Sparkles className="size-4" />
          {status === "loading" ? "A2UI 生成中" : status === "ready" ? "A2UI 动态生成" : "A2UI 生成失败"}
      </span>
      <div className="hidden print:block">
        {children}
      </div>
      <iframe
        ref={iframeRef}
        src="/a2ui-profile/index.html?embed=profile"
        title="A2UI 个人介绍"
        onLoad={() => {
          setStatus("loading");
        }}
        className="print-hidden absolute inset-0 size-full border-0 bg-white"
      />
    </div>
  );
}
