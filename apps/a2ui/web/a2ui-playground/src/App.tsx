/**
 * A2UI Playground：左侧 Agent 对话，右侧预览。
 *
 * 选择测试 Demo 会用评测集里的 userPrompt 请求 /v1/generate SSE；底部发送同样走真实 agent。
 */
import { isValidElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Empty, Modal, Space, Tabs, Tag } from "antd";
import {
  buildTree,
  messagesToJsonl,
  parse,
  resetA2UIStore,
  type A2UIStore,
  type HydrateNode,
  type UserActionPayload,
} from "a2ui-core";
import { renderMap } from "a2ui-react";
import {
  consumeSse,
  apiUrl,
  generateRequestBody,
  generateUrl,
  payloadErrorMessage,
  readA2uiMessages,
  readFinishedProtocol,
  readIncomplete,
  readModelOutput,
  takeSnapshotDelta,
} from "./ag-ui";
import { missingComponentIds, readSurfaceId } from "./component-graph";
import { concatProtocol, sanitizeRefinePatch, snapshotRenderedProtocol } from "./protocol-session";
import { ChatPane, type ChatMessage } from "./features/chat";
import { desktopFormHint, fileToComposerImage, type ComposerImage } from "./image";
import { Preview } from "./features/preview";
import { EVAL_SCENARIOS } from "./eval-scenarios";
import "./App.css";

type GeneratePhase = "idle" | "waiting" | "returned" | "rendering" | "incomplete" | "done" | "error";

interface GenerateSession {
  threadId: string;
  surfaceId: string;
  history: string[];
  currentMessages: unknown[];
}

function newGenerateSession(): GenerateSession {
  return {
    threadId: `thread-${Date.now()}`,
    surfaceId: "",
    history: [],
    currentMessages: [],
  };
}

function yieldFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 即使 SSE 同一读里来了多条，也按条上屏，避免预览一次性铺开。 */
const STREAM_APPLY_GAP_MS = 80;
const DRAFT_FLUSH_MS = 50;

function yieldPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, STREAM_APPLY_GAP_MS);
    });
  });
}

function generatePhaseTag(phase: GeneratePhase): { text: string; color?: string } {
  switch (phase) {
    case "waiting":
      return { text: "生成中", color: "processing" };
    case "returned":
      return { text: "协议渲染中", color: "processing" };
    case "rendering":
      return { text: "协议渲染中", color: "processing" };
    case "incomplete":
      return { text: "协议不完整", color: "warning" };
    case "done":
      return { text: "完成", color: "success" };
    case "error":
      return { text: "失败", color: "error" };
    default:
      return { text: "Idle" };
  }
}

function summarizeVNode(value: unknown): unknown {
  if (isValidElement(value)) {
    const typeName =
      typeof value.type === "function"
        ? value.type.name || "Component"
        : typeof value.type === "string"
          ? value.type
          : "Element";
    return { $$react: typeName, props: value.props };
  }
  return value;
}

function summarizeNode(node: HydrateNode) {
  return { ...node, v_node: summarizeVNode(node.v_node) };
}

function getStoreView(state: A2UIStore) {
  return {
    renderMap: Object.fromEntries(
      Object.entries(state.renderMap).map(([type, render]) => [
        type,
        typeof render === "function" ? `[Function ${render.name || type}]` : render,
      ]),
    ),
    renderTree:
      typeof state.renderTree === "function"
        ? `[Function ${state.renderTree.name || "renderTree"}]`
        : state.renderTree,
    onUserAction:
      typeof state.onUserAction === "function"
        ? `[Function ${state.onUserAction.name || "onUserAction"}]`
        : state.onUserAction,
    surfaceMap: Object.fromEntries(
      Object.entries(state.surfaceMap).map(([id, surface]) => [
        id,
        {
          ...surface,
          rootNode: surface.rootNode ? summarizeNode(surface.rootNode) : surface.rootNode,
        },
      ]),
    ),
    hydrateNodeMap: Object.fromEntries(
      Object.entries(state.hydrateNodeMap).map(([id, node]) => [id, summarizeNode(node)]),
    ),
    errorMap: state.errorMap,
  };
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function nextChatId() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isInFlightAgent(item: ChatMessage) {
  return (
    item.role === "agent" &&
    (item.status === "thinking" ||
      item.status === "streaming" ||
      item.status === "model-returned" ||
      item.status === "rendering")
  );
}

export function App() {
  const renderTreeRef = useRef<(tree: unknown) => void>(() => undefined);
  const [activeDemoId, setActiveDemoId] = useState<string>("");
  const [lastUserAction, setLastUserAction] = useState<UserActionPayload | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [protocolJson, setProtocolJson] = useState("[]");
  const [modelOutputJson, setModelOutputJson] = useState("");
  const [store, setStore] = useState(() =>
    resetA2UIStore({
      renderMap,
      renderTree: (tree) => renderTreeRef.current(tree),
      onUserAction: (payload) => setLastUserAction(payload),
    }),
  );

  function sdkRenderTree(tree: unknown) {
    renderTreeRef.current(tree);
  }

  function handleHostReady(render: (tree: unknown) => void) {
    renderTreeRef.current = render;
    store.getState().setRenderTree(sdkRenderTree);
    render(buildTree());
  }

  const insertComponentId = useCallback((id: string) => {
    const token = `\`${id}\``;
    setPrompt((current) => {
      const trimmed = current.trim();
      if (!trimmed) {
        return token;
      }
      if (trimmed.includes(token) || trimmed.split(/\s+/).includes(id)) {
        return current;
      }
      return `${trimmed} ${token}`;
    });
    setComposerFocusNonce((nonce) => nonce + 1);
  }, []);

  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getState(), [store]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const storeView = getStoreView(state);
  const componentCount = Object.keys(state.hydrateNodeMap).length;
  const errors = Object.values(state.errorMap);
  const [storeOpen, setStoreOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [requestingJson, setRequestingJson] = useState(false);
  const [requestingSse, setRequestingSse] = useState(false);
  const [requestingChat, setRequestingChat] = useState(false);
  const [chatOnly, setChatOnly] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<GeneratePhase>("idle");
  const [prompt, setPrompt] = useState("");
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const [composerImages, setComposerImages] = useState<ComposerImage[]>([]);
  const requestAbortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<GenerateSession>(newGenerateSession());
  const serverBusy = requestingJson || requestingSse || requestingChat;
  const phaseTag = generatePhaseTag(generatePhase);

  function appendChat(message: Omit<ChatMessage, "id">) {
    const id = nextChatId();
    setChat((current) => [...current, { ...message, id }]);
    return id;
  }

  function patchChat(id: string, patch: Partial<ChatMessage> | ((item: ChatMessage) => ChatMessage)) {
    setChat((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item;
        }
        return typeof patch === "function" ? patch(item) : { ...item, ...patch };
      }),
    );
  }

  function dropInFlightAgent(exceptId?: string) {
    setChat((current) => current.filter((item) => !isInFlightAgent(item) || item.id === exceptId));
  }

  function dropIfInFlight(id: string) {
    setChat((current) => current.filter((item) => item.id !== id || !isInFlightAgent(item)));
  }

  function stopStream() {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    dropInFlightAgent();
  }

  function resetPreview() {
    const next = resetA2UIStore({
      renderMap,
      renderTree: sdkRenderTree,
      onUserAction: (payload) => setLastUserAction(payload),
    });
    setStore(next);
    setLastUserAction(null);
    renderTreeRef.current(null);
    return next;
  }

  function beginServerRequest(
    message: string,
    images: ComposerImage[] = [],
    options?: { replaceSurface?: boolean },
  ) {
    const text = [desktopFormHint(images), message.trim()].filter(Boolean).join("\n");
    if (!text && images.length === 0) {
      return null;
    }
    stopStream();
    const abort = new AbortController();
    requestAbortRef.current = abort;
    const replaceSurface = options?.replaceSurface ?? sessionRef.current.currentMessages.length === 0;
    if (replaceSurface) {
      resetPreview();
      setProtocolJson("[]");
      setModelOutputJson("");
    }
    return { message: text, images, abort };
  }

  function sessionRequestOptions(images: ComposerImage[] = [], original: unknown[] = []) {
    const session = sessionRef.current;
    return {
      threadId: session.threadId,
      surfaceId: readSurfaceId(original) || session.surfaceId || undefined,
      history: session.history,
      currentMessages: original,
      images,
    };
  }

  function rememberSession(userText: string, messages: unknown[]) {
    const surfaceId = readSurfaceId(messages) || sessionRef.current.surfaceId;
    sessionRef.current = {
      threadId: sessionRef.current.threadId,
      surfaceId,
      history: userText.trim() ? [...sessionRef.current.history, userText.trim()] : sessionRef.current.history,
      currentMessages: messages,
    };
  }

  function finishGenerate(
    replyId: string,
    messages: unknown[],
    reported?: { missingIds: string[] },
    userText?: string,
  ) {
    const missing =
      reported?.missingIds?.length && reported.missingIds.length > 0
        ? reported.missingIds
        : missingComponentIds(messages);
    if (messages.length > 0) {
      setProtocolJson(prettyJson(messages));
      if (userText !== undefined) {
        rememberSession(userText, messages);
      }
    }
    if (missing.length > 0) {
      patchChat(replyId, {
        body: `协议不完整：缺少 ${missing.join("、")}`,
        status: "incomplete",
      });
      setGeneratePhase("incomplete");
      return;
    }
    patchChat(replyId, { body: "渲染完成", status: "done" });
    setGeneratePhase("done");
  }

  async function requestServerJson(message: string, mock?: string, images: ComposerImage[] = []) {
    // JSON 模式用于生成一张全新的界面，不应把右侧上一张卡片当成微调上下文。
    const original: unknown[] = [];
    const started = beginServerRequest(message, mock ? [] : images, { replaceSurface: true });
    if (!started) {
      return;
    }
    const { abort } = started;
    const replyId = appendChat({ role: "agent", body: "", status: "thinking" });
    setGeneratePhase("waiting");
    setRequestingJson(true);

    try {
      const response = await fetch(generateUrl(false, mock), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        signal: abort.signal,
        body: JSON.stringify(
          generateRequestBody(started.message, { mock, ...sessionRequestOptions(started.images, original) }),
        ),
      });
      const payload: unknown = await response.json();
      if (abort.signal.aborted) {
        dropIfInFlight(replyId);
        return;
      }
      const errorMessage = payloadErrorMessage(payload, "请求失败");
      if (!response.ok || errorMessage) {
        throw new Error(errorMessage ?? `HTTP ${response.status}`);
      }
      const incremental = readModelOutput(payload)?.messages ?? readA2uiMessages(payload);
      if (incremental.length === 0) {
        throw new Error("响应里没有 a2ui_messages");
      }
      const combined = original.length > 0 ? concatProtocol(original, incremental) : incremental;
      setModelOutputJson(prettyJson({ messages: incremental }));
      setProtocolJson(prettyJson(combined));
      patchChat(replyId, { body: "协议渲染中", status: "rendering" });
      setGeneratePhase("rendering");
      await yieldFrame();
      parse(messagesToJsonl(combined));
      finishGenerate(replyId, combined, readIncomplete(payload), started.message);
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        dropIfInFlight(replyId);
        return;
      }
      setGeneratePhase("error");
      patchChat(replyId, {
        role: "agent",
        body: error instanceof Error ? error.message : "请求失败",
        status: "error",
      });
    } finally {
      if (requestAbortRef.current === abort) {
        requestAbortRef.current = null;
        setRequestingJson(false);
      }
    }
  }

  async function requestServerSse(
    message: string,
    mock?: string,
    images: ComposerImage[] = [],
    options?: { replaceSurface?: boolean },
  ) {
    const replaceSurface = options?.replaceSurface ?? false;
    const original = replaceSurface
      ? []
      : snapshotRenderedProtocol(store.getState(), sessionRef.current.currentMessages);
    const started = beginServerRequest(message, mock ? [] : images, {
      replaceSurface: replaceSurface || original.length === 0,
    });
    if (!started) {
      return;
    }
    const { abort } = started;
    const replyId = appendChat({ role: "agent", body: "", status: "thinking" });
    setGeneratePhase("waiting");
    setRequestingSse(true);
    let draft = "";
    let draftTimer = 0;

    try {
      const response = await fetch(generateUrl(true, mock), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        signal: abort.signal,
        body: JSON.stringify(
          generateRequestBody(started.message, { mock, ...sessionRequestOptions(started.images, original) }),
        ),
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          detail = payloadErrorMessage(await response.json(), detail) ?? detail;
        } catch {
          // 非 JSON 错误体
        }
        throw new Error(detail);
      }
      if (!response.body) {
        throw new Error("浏览器没有返回可读流");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let leftover = "";
      let applied: unknown[] = [];
      let phase: "waiting" | "returned" | "rendering" = "waiting";
      let incomplete: { missingIds: string[] } | undefined;
      let converted: unknown[] | undefined;
      const queue: unknown[] = [];

      const flushDraft = () => {
        draftTimer = 0;
        const body = draft;
        patchChat(replyId, (item) => ({ ...item, body, status: item.status === "rendering" ? "rendering" : "thinking" }));
      };

      const onEvent = (event: Record<string, unknown>) => {
        if (event.type === "MODEL_DELTA" && typeof event.delta === "string" && event.delta) {
          draft += event.delta;
          if (!draftTimer) {
            draftTimer = window.setTimeout(flushDraft, DRAFT_FLUSH_MS);
          }
          return;
        }
        if (event.type === "RUN_ERROR") {
          throw new Error(String(event.message ?? event.code ?? "RUN_ERROR"));
        }
        const finished = readFinishedProtocol(event);
        if (finished.modelOutput) {
          setModelOutputJson(prettyJson(finished.modelOutput));
        }
        if (finished.converted && finished.converted.length > 0) {
          converted = finished.converted;
          if (original.length === 0) {
            setProtocolJson(prettyJson(finished.converted));
          }
        }
        if (finished.incomplete) {
          incomplete = finished.incomplete;
        }
        const { incoming } = takeSnapshotDelta(event, [...applied, ...queue]);
        if (incoming.length === 0) {
          return;
        }
        queue.push(...incoming);
      };

      async function flushQueue() {
        if (queue.length === 0 || abort.signal.aborted) {
          return;
        }
        const next = queue.shift();
        if (next === undefined) {
          return;
        }
        if (phase !== "rendering") {
          patchChat(replyId, (item) => ({ ...item, status: "rendering" }));
          setGeneratePhase("rendering");
          phase = "rendering";
        }
        const previousCombined = original.length > 0 ? concatProtocol(original, applied) : [];
        applied = [...applied, next];
        const combined = original.length > 0 ? concatProtocol(original, applied) : applied;
        const toParse =
          original.length > 0
            ? sanitizeRefinePatch(previousCombined.length > 0 ? previousCombined : original, [next], {
                keepOrphans: true,
              })
            : [next];
        if (toParse.length > 0) {
          parse(messagesToJsonl(toParse));
        }
        setProtocolJson(prettyJson(combined));
        await yieldPaint();
      }

      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        leftover += decoder.decode(value ?? new Uint8Array(), { stream: true });
        leftover = consumeSse(leftover, onEvent);
        while (queue.length > 0 && !abort.signal.aborted) {
          await flushQueue();
        }
        if (done) {
          leftover += decoder.decode();
          leftover = consumeSse(`${leftover}\n\n`, onEvent);
          while (queue.length > 0 && !abort.signal.aborted) {
            await flushQueue();
          }
          break;
        }
      }

      if (draftTimer) {
        window.clearTimeout(draftTimer);
        flushDraft();
      }
      if (abort.signal.aborted) {
        dropIfInFlight(replyId);
        return;
      }
      if (applied.length === 0) {
        throw new Error("SSE 里没有 a2ui_messages");
      }
      const combined =
        original.length > 0
          ? concatProtocol(original, applied)
          : converted && converted.length > 0
            ? converted
            : applied;
      if (original.length > 0) {
        const patched = sanitizeRefinePatch(original, applied);
        if (patched.length > 0) {
          parse(messagesToJsonl(patched));
        }
      }
      finishGenerate(replyId, combined, incomplete, started.message);
    } catch (error) {
      if (draftTimer) {
        window.clearTimeout(draftTimer);
      }
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        dropIfInFlight(replyId);
        return;
      }
      setGeneratePhase("error");
      patchChat(replyId, {
        role: "agent",
        body: error instanceof Error ? error.message : "请求失败",
        status: "error",
      });
    } finally {
      if (requestAbortRef.current === abort) {
        requestAbortRef.current = null;
        setRequestingSse(false);
      }
    }
  }

  async function requestChat(message: string) {
    const history = [
      ...chat
        .filter((item) => {
          if (!item.body.trim() || item.status === "error" || item.status === "thinking") {
            return false;
          }
          if (item.status === "model-returned" || item.status === "rendering") {
            return false;
          }
          if (item.body === "渲染完成" || item.body === "模型已返回协议" || item.body === "协议渲染中") {
            return false;
          }
          return true;
        })
        .map((item) => ({
          role: item.role === "user" ? "user" : "assistant",
          content: item.body,
        })),
      { role: "user", content: message },
    ];
    stopStream();
    const abort = new AbortController();
    requestAbortRef.current = abort;
    const replyId = appendChat({ role: "agent", body: "", status: "thinking" });
    setRequestingChat(true);
    try {
      const response = await fetch(apiUrl("/v1/chat?sse=1"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        signal: abort.signal,
        body: JSON.stringify({ messages: history }),
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          detail = payloadErrorMessage(await response.json(), detail) ?? detail;
        } catch {
          // 非 JSON 错误体
        }
        throw new Error(detail);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const payload: unknown = await response.json();
        const errorMessage = payloadErrorMessage(payload, "请求失败");
        if (errorMessage) {
          throw new Error(errorMessage);
        }
        const reply = String((payload as { reply?: unknown }).reply ?? "").trim();
        patchChat(replyId, { role: "agent", body: reply || "(空回复)", status: "done" });
        return;
      }
      if (!response.body) {
        throw new Error("浏览器没有返回可读流");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let leftover = "";
      let assembled = "";
      let finished = false;

      const onEvent = (event: Record<string, unknown>) => {
        if (event.type === "CHAT_ERROR") {
          throw new Error(String(event.message ?? event.code ?? "CHAT_ERROR"));
        }
        if (event.type === "CHAT_DELTA") {
          const delta = String(event.delta ?? "");
          if (!delta) {
            return;
          }
          assembled += delta;
          patchChat(replyId, { role: "agent", body: assembled, status: "streaming" });
          return;
        }
        if (event.type === "CHAT_FINISHED") {
          assembled = String(event.reply ?? assembled).trim();
          finished = true;
          patchChat(replyId, { role: "agent", body: assembled || "(空回复)", status: "done" });
        }
      };

      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        leftover += decoder.decode(value ?? new Uint8Array(), { stream: true });
        leftover = consumeSse(leftover, onEvent);
        if (done) {
          leftover += decoder.decode();
          leftover = consumeSse(`${leftover}\n\n`, onEvent);
          break;
        }
      }

      if (abort.signal.aborted) {
        dropIfInFlight(replyId);
        return;
      }
      if (!finished) {
        patchChat(replyId, { role: "agent", body: assembled || "(空回复)", status: "done" });
      }
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        dropIfInFlight(replyId);
        return;
      }
      patchChat(replyId, {
        role: "agent",
        body: error instanceof Error ? error.message : "请求失败",
        status: "error",
      });
    } finally {
      if (requestAbortRef.current === abort) {
        requestAbortRef.current = null;
        setRequestingChat(false);
      }
    }
  }

  async function addComposerFiles(files: File[]) {
    const remaining = 4 - composerImages.length;
    if (remaining <= 0) {
      appendChat({ role: "agent", body: "一次最多附 4 张图", status: "error" });
      return;
    }
    try {
      const next = await Promise.all(files.slice(0, remaining).map((file) => fileToComposerImage(file)));
      setComposerImages((current) => [...current, ...next].slice(0, 4));
    } catch (error) {
      appendChat({
        role: "agent",
        body: error instanceof Error ? error.message : "图片读取失败",
        status: "error",
      });
    }
  }

  function send(mode: "sse" | "json") {
    const text = prompt.trim();
    const images = composerImages;
    if (serverBusy) {
      return;
    }
    if (chatOnly) {
      if (!text) {
        return;
      }
      setPrompt("");
      appendChat({ role: "user", body: text });
      void requestChat(text);
      return;
    }
    if (!text && images.length === 0) {
      return;
    }
    setPrompt("");
    setComposerImages([]);
    appendChat({
      role: "user",
      body: text || "根据图片生成界面",
      images,
    });
    if (mode === "json") {
      void requestServerJson(text, undefined, images);
      return;
    }
    void requestServerSse(text, undefined, images);
  }

  function toggleChatOnly(next: boolean) {
    stopStream();
    setChatOnly(next);
    sessionRef.current = newGenerateSession();
    if (next) {
      resetPreview();
      setGeneratePhase("idle");
    }
  }

  function playEvalDemo(id: string) {
    const demo = EVAL_SCENARIOS.find((item) => item.id === id);
    if (!demo) {
      return;
    }
    const text = demo.userPrompt.trim();
    if (!text) {
      return;
    }
    sessionRef.current = newGenerateSession();
    setActiveDemoId(id);
    appendChat({ role: "user", body: text });
    // 不同 Demo 是彼此独立的生成任务，不能继承上一张预览的 root、组件或对话历史。
    void requestServerSse(text, undefined, [], { replaceSurface: true });
  }

  useEffect(() => {
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="playground">
      <ChatPane
        scenes={EVAL_SCENARIOS.map((item) => ({
          id: item.id,
          label: `${item.id} · ${item.name}`,
          userPrompt: item.userPrompt,
        }))}
        activeSceneId={activeDemoId}
        onSelectScene={playEvalDemo}
        messages={chat}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSend={() => send("sse")}
        onSendJson={() => send("json")}
        pendingImages={composerImages}
        onAddFiles={(files) => void addComposerFiles(files)}
        onRemovePendingImage={(index) =>
          setComposerImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
        }
        busy={serverBusy}
        chatOnly={chatOnly}
        onChatOnlyChange={toggleChatOnly}
        composerFocusNonce={composerFocusNonce}
      />
      <section className="stage-pane">
        <header className="stage-header">
          <h1>A2UI Playground</h1>
          <Space wrap>
            <Button onClick={() => setStoreOpen(true)}>View Store</Button>
            <Button danger={errors.length > 0} onClick={() => setErrorOpen(true)}>
              View Errors{errors.length > 0 ? ` (${errors.length})` : ""}
            </Button>
            <Button onClick={() => setJsonOpen(true)}>View A2UI JSON</Button>
            {chatOnly ? <Tag color="blue">Chat only</Tag> : <Tag color={phaseTag.color}>{phaseTag.text}</Tag>}
          </Space>
        </header>
        <div className="preview-board">
          <div className="preview-label">
            {chatOnly
              ? "预览区（模型对话测试中，不渲染 A2UI）"
              : generatePhase === "idle"
                ? "预览区 · 点击组件可将 ID 填入左侧输入框"
                : `预览区 · ${phaseTag.text} · 点击组件填入 ID`}
          </div>
          {chatOnly ? <div className="chat-only-hint">已开启「仅测试模型对话」，右侧不走 generate / mock。</div> : <Preview onHostReady={handleHostReady} onPickComponentId={insertComponentId} />}
        </div>
      </section>
      <Modal
        title="Store"
        open={storeOpen}
        onCancel={() => setStoreOpen(false)}
        footer={null}
        width={800}
        destroyOnHidden
      >
        <div className="store-summary">当前渲染组件总数：{componentCount}</div>
        {lastUserAction ? (
          <>
            <div className="store-summary">最近一次 userAction</div>
            <pre className="store-panel">{JSON.stringify(lastUserAction, null, 2)}</pre>
          </>
        ) : null}
        <pre className="store-panel">{JSON.stringify(storeView, null, 2)}</pre>
      </Modal>
      <Modal
        title="Errors"
        open={errorOpen}
        onCancel={() => setErrorOpen(false)}
        footer={null}
        width={800}
        destroyOnHidden
      >
        {errors.length === 0 ? (
          <Empty description="暂无错误" />
        ) : (
          <pre className="store-panel">{JSON.stringify(errors, null, 2)}</pre>
        )}
      </Modal>
      <Modal
        title="A2UI JSON"
        open={jsonOpen}
        onCancel={() => setJsonOpen(false)}
        footer={null}
        width={920}
        destroyOnHidden
      >
        <Tabs
          className="json-modal-tabs"
          items={[
            {
              key: "model",
              label: "模型返回",
              children: modelOutputJson ? (
                <>
                  <p className="json-modal-hint">解析后、尚未按 component 拆条的写作形态，对应 {`{ messages }`}</p>
                  <pre className="store-panel">{modelOutputJson}</pre>
                </>
              ) : (
                <Empty description="还没有模型返回。流结束后会出现。" />
              ),
            },
            {
              key: "converted",
              label: "转换后",
              children: (
                <>
                  <p className="json-modal-hint">服务端拆条并补全 surfaceId 后的 JSONL 数组，预览区实际 parse 的是这份</p>
                  <pre className="store-panel">{protocolJson}</pre>
                </>
              ),
            },
          ]}
        />
      </Modal>
    </main>
  );
}
