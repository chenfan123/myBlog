import { isValidElement, useEffect, useRef, useState } from "react";
import { messagesToJsonl, parse, resetA2UIStore, type OnUserActionFn } from "a2ui-core";
import { A2uiSurface, renderMap } from "a2ui-react";
import { apiUrl, consumeSse, payloadErrorMessage } from "./ag-ui";
import "./SectionEmbed.css";

type SectionPayload = { kind: "strengths" | "experiences" | "agents"; title: string; items: unknown[] };
type HostMessage = { type: "a2ui:section-input"; payload: SectionPayload };
const MAX_BACKGROUND_POLLS = 20;
const BACKGROUND_POLL_MS = 15_000;

function notifyHost(type: "a2ui:section-ready" | "a2ui:section-fallback" | "a2ui:section-error", detail?: string | number) {
  window.parent.postMessage({ type, detail }, "*");
}

async function streamSection(
  payload: SectionPayload,
  signal: AbortSignal,
  onMessage: (message: unknown) => void,
): Promise<void> {
  const response = await fetch(apiUrl("/v1/portfolio-section?sse=1"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = payloadErrorMessage(await response.json(), detail) ?? detail;
    } catch {}
    throw new Error(detail);
  }
  if (!response.body) throw new Error("A2UI section stream is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";
  let finished = false;
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    leftover += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    leftover = consumeSse(leftover, (event) => {
      if (event.type === "A2UI_MESSAGE") onMessage(event.message);
      if (event.type === "A2UI_DONE") finished = true;
      if (event.type === "A2UI_ERROR") throw new Error(String(event.message ?? event.code ?? "A2UI stream failed"));
    });
    if (done) break;
  }
  if (!finished && !signal.aborted) throw new Error("A2UI section stream ended unexpectedly");
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
      window.parent.postMessage({ type: "a2ui:section-navigate", url }, "*");
    }
  };
  const storeRef = useRef<ReturnType<typeof resetA2UIStore> | null>(null);

  useEffect(() => {
    let receivedInput = false;
    const run = (payload: SectionPayload) => {
      requestRef.current?.abort();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      const controller = new AbortController();
      requestRef.current = controller;
      // 工作经历等长协议生成较慢，给服务端完整的 240 秒处理窗口。
      const timeout = window.setTimeout(() => controller.abort(), 280_000);
      setTree(null);
      storeRef.current = resetA2UIStore({ renderMap, renderTree: setTree, onUserAction });

      let latestTree: unknown = null;
      let streamingVisible = false;
      void streamSection(payload, controller.signal, (message) => {
          const nextTree = parse(messagesToJsonl([message]));
          if (nextTree) latestTree = nextTree;
          if (latestTree && !streamingVisible) {
            streamingVisible = true;
            window.requestAnimationFrame(() => {
              const nextHeight = Math.ceil(document.querySelector<HTMLElement>(".section-embed")?.scrollHeight ?? 320);
              notifyHost("a2ui:section-ready", nextHeight);
            });
          }
        })
        .then(() => {
          if (!latestTree) throw new Error("A2UI section render failed");
          setTree(latestTree);
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
          if (retryCountRef.current < MAX_BACKGROUND_POLLS) {
            retryCountRef.current += 1;
            notifyHost("a2ui:section-fallback");
            retryTimerRef.current = window.setTimeout(() => run(payload), BACKGROUND_POLL_MS);
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
      if (event.data?.type !== "a2ui:section-input") return;
      receivedInput = true;
      setKind(event.data.payload.kind);
      retryCountRef.current = 0;
      run(event.data.payload);
    };
    window.addEventListener("message", receive);
    const announceReady = () => {
      if (!receivedInput) window.parent.postMessage({ type: "a2ui:section-listening" }, "*");
    };
    announceReady();
    const handshakeTimer = window.setInterval(announceReady, 500);
    return () => {
      window.clearInterval(handshakeTimer);
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
