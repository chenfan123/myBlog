import { isValidElement, useEffect, useRef, useState } from "react";
import { messagesToJsonl, parse, resetA2UIStore } from "a2ui-core";
import { A2uiSurface, renderMap } from "a2ui-react";
import { apiUrl, payloadErrorMessage, readA2uiMessages } from "./ag-ui";
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

function notifyHost(type: "a2ui:profile-ready" | "a2ui:profile-error", detail?: string) {
  window.parent.postMessage({ type, detail }, window.location.origin);
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestProfile(payload: ProfilePayload, signal: AbortSignal): Promise<unknown> {
  while (!signal.aborted) {
    const response = await fetch(apiUrl("/v1/profile"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const result: unknown = await response.json();
    if (response.status === 202) {
      const retryAfterMs = Number((result as { retryAfterMs?: unknown })?.retryAfterMs);
      await wait(Number.isFinite(retryAfterMs) ? Math.max(500, retryAfterMs) : 1_500, signal);
      continue;
    }
    const error = payloadErrorMessage(result, `HTTP ${response.status}`);
    if (!response.ok || error) throw new Error(error ?? `HTTP ${response.status}`);
    return result;
  }
  throw new DOMException("Aborted", "AbortError");
}

export function ProfileEmbed() {
  const [tree, setTree] = useState<unknown>(null);
  const requestRef = useRef<AbortController | null>(null);
  const storeRef = useRef(
    resetA2UIStore({
      renderMap,
      renderTree: (nextTree) => setTree(nextTree),
      onUserAction: () => undefined,
    }),
  );

  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type !== "a2ui:profile-input") return;

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      setTree(null);
      storeRef.current = resetA2UIStore({
        renderMap,
        renderTree: (nextTree) => setTree(nextTree),
        onUserAction: () => undefined,
      });

      void requestProfile(event.data.payload, controller.signal)
        .then((payload) => {
          const messages = readA2uiMessages(payload);
          if (messages.length === 0) throw new Error("A2UI profile protocol is empty");
          const nextTree = parse(messagesToJsonl(messages));
          const errors = Object.values(storeRef.current.getState().errorMap);
          if (!nextTree || errors.length > 0) throw new Error("A2UI profile render failed");
          setTree(nextTree);
          window.requestAnimationFrame(() => notifyHost("a2ui:profile-ready"));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            // 新一轮资料请求会主动取消旧请求；旧请求不应把当前 UI 短暂标记成失败。
            if (requestRef.current === controller) notifyHost("a2ui:profile-error", "timeout");
            return;
          }
          notifyHost("a2ui:profile-error", error instanceof Error ? error.message : "request failed");
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (requestRef.current === controller) requestRef.current = null;
        });
    };

    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "a2ui:profile-listening" }, window.location.origin);
    return () => {
      window.removeEventListener("message", receive);
      requestRef.current?.abort();
    };
  }, []);

  return (
    <main className="profile-embed">
      {isValidElement(tree) ? <A2uiSurface>{tree}</A2uiSurface> : null}
    </main>
  );
}
