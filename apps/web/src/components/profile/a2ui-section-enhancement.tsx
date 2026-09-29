"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

type SectionKind = "strengths" | "experiences" | "agents";

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
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [height, setHeight] = useState(kind === "experiences" ? 720 : 480);

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
    const timeout = window.setTimeout(() => setStatus("error"), 35_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const sendSection = () => iframeRef.current?.contentWindow?.postMessage(
      { type: "a2ui:section-input", payload: { kind, title, items } },
      window.location.origin,
    );
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "a2ui:section-listening") sendSection();
      if (event.data?.type === "a2ui:section-ready") {
        if (typeof event.data.detail === "number") setHeight(Math.max(320, Math.min(1800, event.data.detail)));
        setStatus("ready");
      }
      if (event.data?.type === "a2ui:section-error") setStatus("error");
      if (event.data?.type === "a2ui:section-navigate") {
        const url = typeof event.data.url === "string" ? event.data.url : "";
        if (url.startsWith("/") && !url.startsWith("//")) window.location.assign(url);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [items, kind, title]);

  return (
    <div ref={containerRef} className={kind === "strengths" ? "relative mx-auto max-w-7xl px-6 py-16 lg:px-10" : "relative"}>
      <span className={`print-hidden absolute right-0 top-0 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
        status === "error" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-lime-300 bg-lime-100 text-lime-800"
      }`}>
        <Sparkles className="size-3.5" />
        {status === "idle" ? "A2UI 等待生成" : status === "loading" ? "A2UI 生成中" : status === "ready" ? "A2UI 动态生成" : "已切换原始内容"}
      </span>
      <div className={status === "ready" ? "hidden print:block" : "block"}>{children}</div>
      {active ? <iframe
        ref={iframeRef}
        src="/a2ui-profile/index.html?embed=section"
        title={`${title} A2UI 动态区块`}
        onLoad={() => setStatus("loading")}
        onError={() => setStatus("error")}
        style={{ height }}
        className={`print-hidden w-full border-0 bg-transparent ${status === "ready" ? "block" : "pointer-events-none absolute inset-0 invisible"}`}
      /> : null}
    </div>
  );
}
