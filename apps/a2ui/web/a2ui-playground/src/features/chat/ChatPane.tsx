import { Button, Input, Select, Switch, type InputRef } from "antd";
import { useEffect, useLayoutEffect, useRef } from "react";

function filesFromClipboard(clipboard: DataTransfer | null): File[] {
  if (!clipboard) {
    return [];
  }
  return [...clipboard.files].filter((file) => file.type.startsWith("image/"));
}

function agentStatusLabel(status: ChatStatus | undefined, chatOnly: boolean) {
  if (status === "thinking") {
    return chatOnly ? " · 思考中" : " · 生成中";
  }
  if (status === "streaming") {
    return " · 回复中";
  }
  if (status === "model-returned") {
    return " · 协议渲染中";
  }
  if (status === "rendering") {
    return " · 协议渲染中";
  }
  if (status === "incomplete") {
    return " · 协议不完整";
  }
  if (status === "done") {
    return " · 完成";
  }
  if (status === "error") {
    return " · 失败";
  }
  return "";
}

export type ChatStatus =
  | "thinking"
  | "streaming"
  | "model-returned"
  | "rendering"
  | "incomplete"
  | "done"
  | "error";

export interface ChatImage {
  url: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  body: string;
  status?: ChatStatus;
  images?: ChatImage[];
}

export interface ChatSceneOption {
  id: string;
  label: string;
  userPrompt: string;
}

export function ChatPane({
  scenes,
  activeSceneId,
  onSelectScene,
  messages,
  prompt,
  onPromptChange,
  onSend,
  onSendJson,
  pendingImages,
  onAddFiles,
  onRemovePendingImage,
  busy,
  chatOnly,
  onChatOnlyChange,
  composerFocusNonce,
}: {
  scenes: readonly ChatSceneOption[];
  activeSceneId: string;
  onSelectScene: (id: string) => void;
  messages: ChatMessage[];
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onSendJson: () => void;
  pendingImages: ChatImage[];
  onAddFiles: (files: File[]) => void;
  onRemovePendingImage: (index: number) => void;
  busy: boolean;
  chatOnly: boolean;
  onChatOnlyChange: (value: boolean) => void;
  composerFocusNonce?: number;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollFrameRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<InputRef>(null);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || !stickToBottomRef.current) {
      return;
    }
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
    return () => window.cancelAnimationFrame(scrollFrameRef.current);
  }, [messages]);

  useEffect(() => {
    if (!composerFocusNonce) {
      return;
    }
    const box = composerRef.current;
    if (!box) {
      return;
    }
    box.focus({ cursor: "end" });
  }, [composerFocusNonce]);

  return (
    <aside className="chat-pane">
      <header className="chat-header">
        <h2>Agent 对话</h2>
        <p>
          {chatOnly
            ? "当前只测模型对话：发送走 POST /v1/chat SSE，气泡会先显示思考中，再按 token 流式出现。"
            : "右侧为 A2UI 预览。再次发送时会带上当前协议，模型只回增量，客户端拼回原协议后再渲染。"}
        </p>
      </header>

      <section className="chat-scene">
        <div className="chat-scene-switch">
          <span>仅测试模型对话</span>
          <Switch checked={chatOnly} onChange={onChatOnlyChange} disabled={busy} />
        </div>
        {chatOnly ? (
          <p>不会请求 mock / generate，只验证 OpenAI 兼容接口能否正常回复。</p>
        ) : (
          <>
            <div className="chat-scene-title">测试 Demo</div>
            <p>选择评测场景后，会把该条的 userPrompt 当作用户输入，请求真实 agent 生成界面。</p>
            <Select
              className="chat-scene-select"
              showSearch
              optionLabelProp="prompt"
              placeholder="选择测试 Demo"
              value={activeSceneId || undefined}
              options={scenes.map((scene) => ({
                value: scene.id,
                label: scene.label,
                prompt: scene.userPrompt,
                search: `${scene.label} ${scene.userPrompt}`,
              }))}
              filterOption={(input, option) =>
                String(option?.search ?? option?.label ?? "")
                  .toLowerCase()
                  .includes(input.trim().toLowerCase())
              }
              onSelect={(id) => {
                if (id) {
                  onSelectScene(id);
                }
              }}
              disabled={busy}
            />
          </>
        )}
      </section>

      <div
        className="chat-log"
        ref={logRef}
        onScroll={(event) => {
          const log = event.currentTarget;
          stickToBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= 32;
        }}
      >
        {messages.map((item) => (
          <article
            key={item.id}
            className={`chat-bubble chat-bubble-${item.role}${item.status ? ` chat-bubble-${item.status}` : ""}`}
          >
            <div className="chat-bubble-label">
              {item.role === "user" ? "我" : `${chatOnly ? "模型" : "Agent"}${agentStatusLabel(item.status, chatOnly)}`}
            </div>
            <div className="chat-bubble-main">
              {item.images && item.images.length > 0 ? (
                <div className="chat-bubble-images">
                  {item.images.map((image, index) => (
                    <img key={`${item.id}-img-${index}`} src={image.url} alt={image.name || "附图"} />
                  ))}
                </div>
              ) : null}
              {item.status === "thinking" && !item.body ? (
                <span className="chat-typing" aria-label="思考中">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <>
                  {item.body}
                  {item.status === "streaming" ||
                  item.status === "rendering" ||
                  (item.status === "thinking" && item.body) ? (
                    <span className="chat-cursor" />
                  ) : null}
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      <footer className="chat-composer">
        {chatOnly || pendingImages.length === 0 ? null : (
          <div className="chat-compose-previews">
            {pendingImages.map((image, index) => (
              <button
                key={`${image.name}-${index}`}
                type="button"
                className="chat-compose-thumb"
                disabled={busy}
                onClick={() => onRemovePendingImage(index)}
                title="移除图片"
              >
                <img src={image.url} alt={image.name || "待发送图片"} />
              </button>
            ))}
          </div>
        )}
        <Input.TextArea
          ref={composerRef}
          value={prompt}
          disabled={busy}
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder={
            chatOnly
              ? "输入消息... (Enter 发送，Shift+Enter 换行)"
              : "描述界面，或点击右侧组件填入 ID... (Enter 发送，Shift+Enter 换行)"
          }
          onChange={(event) => onPromptChange(event.target.value)}
          onPaste={(event) => {
            if (chatOnly) {
              return;
            }
            const files = filesFromClipboard(event.clipboardData);
            if (files.length === 0) {
              return;
            }
            event.preventDefault();
            onAddFiles(files);
          }}
          onPressEnter={(event) => {
            if (event.shiftKey) {
              return;
            }
            event.preventDefault();
            onSend();
          }}
        />
        <div className="chat-composer-actions">
          {chatOnly ? null : (
            <>
              <input
                ref={fileInputRef}
                className="chat-file-input"
                type="file"
                accept="image/*"
                multiple
                disabled={busy}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = "";
                  if (files.length === 0) {
                    return;
                  }
                  onAddFiles(files);
                }}
              />
              <Button disabled={busy} onClick={() => fileInputRef.current?.click()}>
                图片
              </Button>
              <Button disabled={busy} onClick={onSendJson}>
                JSON
              </Button>
            </>
          )}
          <Button type="primary" loading={busy} onClick={onSend}>
            发送
          </Button>
        </div>
      </footer>
    </aside>
  );
}
