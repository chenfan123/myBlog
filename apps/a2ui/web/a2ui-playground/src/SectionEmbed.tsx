import { isValidElement, useEffect, useRef, useState } from "react";
import { messagesToJsonl, parse, resetA2UIStore, type OnUserActionFn } from "a2ui-core";
import { A2uiSurface, renderMap } from "a2ui-react";
import { apiUrl, payloadErrorMessage, readA2uiMessages } from "./ag-ui";
import "./SectionEmbed.css";

type SectionPayload = { kind: "strengths" | "experiences" | "agents"; title: string; items: unknown[] };
type HostMessage = { type: "a2ui:section-input"; payload: SectionPayload };

function notifyHost(type: "a2ui:section-ready" | "a2ui:section-fallback" | "a2ui:section-error", detail?: string | number) {
  window.parent.postMessage({ type, detail }, window.location.origin);
}

async function requestSection(payload: SectionPayload, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(apiUrl("/v1/portfolio-section"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  const result: unknown = await response.json();
  const error = payloadErrorMessage(result, `HTTP ${response.status}`);
  if (!response.ok || error) throw new Error(error ?? `HTTP ${response.status}`);
  return result;
}

export function SectionEmbed() {
  const [tree, setTree] = useState<unknown>(null);
  const [kind, setKind] = useState<SectionPayload["kind"]>("strengths");
  const requestRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const onUserAction: OnUserActionFn = (action) => {
    if (action.name !== "openAgent") return;
    const url = typeof action.context.url === "string" ? action.context.url : "";
    if (url.startsWith("/") && !url.startsWith("//")) {
      window.parent.postMessage({ type: "a2ui:section-navigate", url }, window.location.origin);
    }
  };
  const storeRef = useRef(resetA2UIStore({ renderMap, renderTree: setTree, onUserAction }));

  useEffect(() => {
    const run = (payload: SectionPayload) => {
      requestRef.current?.abort();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      const controller = new AbortController();
      requestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 180_000);
      setTree(null);
      storeRef.current = resetA2UIStore({ renderMap, renderTree: setTree, onUserAction });

      void requestSection(payload, controller.signal)
        .then((result) => {
          if (result && typeof result === "object" && "fallback" in result && result.fallback === true) {
            notifyHost("a2ui:section-fallback");
            if (retryCountRef.current < 2) {
              retryCountRef.current += 1;
              retryTimerRef.current = window.setTimeout(() => run(payload), 16_000);
            }
            return;
          }
          const messages = readA2uiMessages(result);
          if (messages.length === 0) throw new Error("A2UI section protocol is empty");
          const nextTree = parse(messagesToJsonl(messages));
          const errors = Object.values(storeRef.current.getState().errorMap);
          if (!nextTree || errors.length > 0) throw new Error("A2UI section render failed");
          setTree(nextTree);
          window.requestAnimationFrame(() => {
            const height = Math.ceil(document.documentElement.scrollHeight);
            notifyHost("a2ui:section-ready", height);
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            if (requestRef.current === controller) notifyHost("a2ui:section-error", "timeout");
            return;
          }
          if (retryCountRef.current < 2) {
            retryCountRef.current += 1;
            notifyHost("a2ui:section-fallback");
            retryTimerRef.current = window.setTimeout(() => run(payload), 5_000 * retryCountRef.current);
            return;
          }
          notifyHost("a2ui:section-error", error instanceof Error ? error.message : "request failed");
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (requestRef.current === controller) requestRef.current = null;
        });
    };

    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type !== "a2ui:section-input") return;
      setKind(event.data.payload.kind);
      retryCountRef.current = 0;
      run(event.data.payload);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "a2ui:section-listening" }, window.location.origin);
    return () => {
      window.removeEventListener("message", receive);
      requestRef.current?.abort();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isValidElement(tree)) return;
    let frame = 0;
    const reportHeight = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const height = Math.ceil(document.querySelector<HTMLElement>(".section-embed")?.scrollHeight ?? document.documentElement.scrollHeight);
        notifyHost("a2ui:section-ready", height);
      });
    };
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.documentElement);
    const main = document.querySelector<HTMLElement>(".section-embed");
    if (main) observer.observe(main);
    reportHeight();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [tree]);

  return <main className={`section-embed section-embed--${kind}`}>{isValidElement(tree) ? <A2uiSurface>{tree}</A2uiSurface> : null}</main>;
}
