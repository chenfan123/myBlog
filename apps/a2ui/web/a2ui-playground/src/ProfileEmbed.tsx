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

function notifyHost(type: "a2ui:profile-ready" | "a2ui:profile-fallback" | "a2ui:profile-error", detail?: string) {
  window.parent.postMessage({ type, detail }, window.location.origin);
}

async function requestProfile(payload: ProfilePayload, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(apiUrl("/v1/profile"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal,
    cache: "no-store",
  });
  const result: unknown = await response.json();
  const error = payloadErrorMessage(result, `HTTP ${response.status}`);
  if (!response.ok || error) throw new Error(error ?? `HTTP ${response.status}`);
  return result;
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
      const timeout = window.setTimeout(() => controller.abort(), 180_000);
      setTree(null);
      storeRef.current = resetA2UIStore({
        renderMap,
        renderTree: (nextTree) => setTree(nextTree),
        onUserAction: () => undefined,
      });

      void requestProfile(payload, controller.signal)
        .then((result) => {
          if (result && typeof result === "object" && "fallback" in result && result.fallback === true) {
            notifyHost("a2ui:profile-fallback");
            if (retryCountRef.current < 2) {
              retryCountRef.current += 1;
              retryTimerRef.current = window.setTimeout(() => run(payload), 16_000);
            }
            return;
          }
          const messages = readA2uiMessages(result);
          if (messages.length === 0) throw new Error("A2UI profile protocol is empty");
          const nextTree = parse(messagesToJsonl(messages));
          const errors = Object.values(storeRef.current.getState().errorMap);
          if (!nextTree || errors.length > 0) throw new Error("A2UI profile render failed");
          setTree(nextTree);
          window.requestAnimationFrame(() => notifyHost("a2ui:profile-ready"));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
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
