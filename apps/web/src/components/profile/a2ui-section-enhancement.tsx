"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

type SectionKind = "strengths" | "experiences" | "agents";

const A2UI_SECTION_EMBED_URL =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:5173/a2ui/index.html?embed=section"
    : "/a2ui-profile/index.html?embed=section";

export function A2UISectionEnhancement({
  kind,
  title,
  items,
  children,
}: {
  kind: SectionKind;
  title: string;
  items: unknown[];
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "fallback" | "error">("idle");
  const [height, setHeight] = useState(kind === "experiences" ? 720 : 480);

  const sendSection = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "a2ui:section-input", payload: { kind, title, items } },
      "*",
    );
  }, [items, kind, title]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setActive(true);
        setStatus("loading");
        observer.disconnect();
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => setStatus("error"), 290_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!event.data?.type?.startsWith?.("a2ui:section-")) return;
      if (event.data?.type === "a2ui:section-listening") sendSection();
      if (event.data?.type === "a2ui:section-ready") {
        if (typeof event.data.detail === "number") setHeight(Math.max(320, Math.min(1800, event.data.detail)));
        setStatus("ready");
      }
      if (event.data?.type === "a2ui:section-fallback") setStatus("fallback");
      if (event.data?.type === "a2ui:section-error") setStatus("error");
      if (event.data?.type === "a2ui:section-navigate") {
        const url = typeof event.data.url === "string" ? event.data.url : "";
        if (url.startsWith("/") && !url.startsWith("//")) window.location.assign(url);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [sendSection]);

  return (
    <div ref={containerRef} className={kind === "strengths" ? "relative mx-auto max-w-7xl px-6 py-16 lg:px-10" : "relative"}>
      <span className={`print-hidden absolute right-0 top-0 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
        status === "error" || status === "fallback" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-lime-300 bg-lime-100 text-lime-800"
      }`}>
        <Sparkles className="size-3.5" />
        {status === "idle"
          ? "当前为兜底展示 · 等待 A2UI 生成"
          : status === "loading"
            ? "当前为兜底展示 · A2UI 动态生成中"
            : status === "ready"
              ? "A2UI 动态生成"
              : status === "fallback"
                ? "当前为兜底展示 · A2UI 后台生成中"
                : "A2UI 请求异常 · 当前为兜底展示"}
      </span>
      <div className={status === "ready" ? "hidden print:block" : "block"}>{children}</div>
      {active ? <iframe
        ref={iframeRef}
        src={A2UI_SECTION_EMBED_URL}
        title={`${title} A2UI 动态区块`}
        onLoad={() => {
          setStatus("loading");
          sendSection();
        }}
        onError={() => setStatus("error")}
        style={{ height }}
        className={`print-hidden w-full border-0 bg-transparent ${status === "ready" ? "block" : "pointer-events-none absolute inset-0 invisible"}`}
      /> : null}
    </div>
  );
}
