import { isValidElement, useEffect, useRef, useState } from "react";
import { messagesToJsonl, parse, resetA2UIStore } from "a2ui-core";
import { A2uiSurface, renderMap } from "a2ui-react";
import { apiUrl, consumeSse, payloadErrorMessage } from "./ag-ui";
import "./ProfileEmbed.css";

type ProfilePayload = {
  name: string;
  role: string;
  introduction: string;
  phone: string;
  email: string;
  availability: string;
  skillGroups: Array<{ title: string; skills: string[] }>;
};

type HostMessage = { type: "a2ui:profile-input"; payload: ProfilePayload };
const MAX_BACKGROUND_POLLS = 20;
const BACKGROUND_POLL_MS = 15_000;

function notifyHost(type: "a2ui:profile-ready" | "a2ui:profile-fallback" | "a2ui:profile-error", detail?: string) {
  window.parent.postMessage({ type, detail }, window.location.origin);
}

async function streamProfile(
  payload: ProfilePayload,
  signal: AbortSignal,
  onMessage: (message: unknown) => void,
): Promise<void> {
  const response = await fetch(apiUrl("/v1/profile?sse=1"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = payloadErrorMessage(await response.json(), detail) ?? detail;
    } catch {}
    throw new Error(detail);
  }
  if (!response.body) throw new Error("A2UI profile stream is unavailable");

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
  if (!finished && !signal.aborted) throw new Error("A2UI profile stream ended unexpectedly");
}

export function ProfileEmbed() {
  const [tree, setTree] = useState<unknown>(null);
  const requestRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const storeRef = useRef(
    resetA2UIStore({
      renderMap,
      renderTree: (nextTree) => setTree(nextTree),
      onUserAction: () => undefined,
    }),
  );

  useEffect(() => {
    const run = (payload: ProfilePayload) => {
      requestRef.current?.abort();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      const controller = new AbortController();
      requestRef.current = controller;
      // 服务端允许慢模型最多运行 240 秒；浏览器稍晚中止，避免先于服务端断开。
      const timeout = window.setTimeout(() => controller.abort(), 280_000);
      setTree(null);
      storeRef.current = resetA2UIStore({
        renderMap,
        renderTree: (nextTree) => setTree(nextTree),
        onUserAction: () => undefined,
      });

      let latestTree: unknown = null;
      let streamingVisible = false;
      void streamProfile(payload, controller.signal, (message) => {
          latestTree = parse(messagesToJsonl([message]));
          if (latestTree && !streamingVisible) {
            streamingVisible = true;
            window.requestAnimationFrame(() => notifyHost("a2ui:profile-ready"));
          }
        })
        .then(() => {
          const errors = Object.values(storeRef.current.getState().errorMap);
          if (!latestTree || errors.length > 0) throw new Error("A2UI profile render failed");
          setTree(latestTree);
          window.requestAnimationFrame(() => notifyHost("a2ui:profile-ready"));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            if (requestRef.current === controller) notifyHost("a2ui:profile-error", "timeout");
            return;
          }
          if (retryCountRef.current < MAX_BACKGROUND_POLLS) {
            retryCountRef.current += 1;
            notifyHost("a2ui:profile-fallback");
            retryTimerRef.current = window.setTimeout(() => run(payload), BACKGROUND_POLL_MS);
            return;
          }
          notifyHost("a2ui:profile-error", error instanceof Error ? error.message : "request failed");
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (requestRef.current === controller) requestRef.current = null;
        });
    };

    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type !== "a2ui:profile-input") return;

      retryCountRef.current = 0;
      run(event.data.payload);
    };

    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "a2ui:profile-listening" }, window.location.origin);
    return () => {
      window.removeEventListener("message", receive);
      requestRef.current?.abort();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  return (
    <main className="profile-embed">
      {isValidElement(tree) ? <A2uiSurface>{tree}</A2uiSurface> : null}
    </main>
  );
}
