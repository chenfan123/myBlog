export function a2uiMessagesFromSnapshot(event: unknown): unknown[] {
  if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "ACTIVITY_SNAPSHOT") {
    return [];
  }
  const messages = (event as { content?: { a2ui_messages?: unknown } }).content?.a2ui_messages;
  return Array.isArray(messages) ? messages : [];
}

/** replace:true 为整份列表；false 为本帧增量。返回需要 parse 的新消息，以及累积后的完整列表。 */
export function takeSnapshotDelta(event: unknown, applied: unknown[]): { incoming: unknown[]; next: unknown[] } {
  const messages = a2uiMessagesFromSnapshot(event);
  if (messages.length === 0) {
    return { incoming: [], next: applied };
  }
  const replace = (event as { replace?: unknown }).replace !== false;
  if (!replace) {
    return { incoming: messages, next: [...applied, ...messages] };
  }
  if (messages.length <= applied.length) {
    return { incoming: [], next: applied };
  }
  return { incoming: messages.slice(applied.length), next: messages };
}

export function readA2uiMessages(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const converted = (payload as { converted?: unknown }).converted;
  if (Array.isArray(converted) && converted.length > 0) {
    return converted;
  }
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return a2uiMessagesFromSnapshot(payload);
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const messages = a2uiMessagesFromSnapshot(events[index]);
    if (messages.length > 0) {
      return messages;
    }
  }
  return [];
}

/** 模型/mock 写作形态；没有则退回转换后的列表包一层 `{ messages }`。 */
export function readModelOutput(payload: unknown): { messages: unknown[] } | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const direct = (payload as { modelOutput?: { messages?: unknown } }).modelOutput;
  if (direct && Array.isArray(direct.messages)) {
    return { messages: direct.messages };
  }
  const events = (payload as { events?: unknown }).events;
  if (Array.isArray(events)) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event || typeof event !== "object") {
        continue;
      }
      const output = (event as { modelOutput?: { messages?: unknown } }).modelOutput;
      if (output && Array.isArray(output.messages)) {
        return { messages: output.messages };
      }
    }
  }
  return undefined;
}

export function readFinishedProtocol(
  event: unknown,
): {
  modelOutput?: { messages: unknown[] };
  converted?: unknown[];
  incomplete?: { missingIds: string[] };
} {
  if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "RUN_FINISHED") {
    return {};
  }
  const record = event as {
    modelOutput?: { messages?: unknown };
    converted?: unknown;
    incomplete?: { missingIds?: unknown };
  };
  return {
    modelOutput: Array.isArray(record.modelOutput?.messages)
      ? { messages: record.modelOutput.messages }
      : undefined,
    converted: Array.isArray(record.converted) ? record.converted : undefined,
    incomplete: readIncomplete(record),
  };
}

export function readIncomplete(payload: unknown): { missingIds: string[] } | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const direct = (payload as { incomplete?: { missingIds?: unknown } }).incomplete;
  if (Array.isArray(direct?.missingIds) && direct.missingIds.every((item) => typeof item === "string")) {
    return { missingIds: direct.missingIds };
  }
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return undefined;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const found = readIncomplete(events[index]);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function generateRequestBody(
  message: string,
  options?: {
    mock?: string;
    images?: Array<{ url: string }>;
    threadId?: string;
    surfaceId?: string;
    history?: string[];
    currentMessages?: unknown[];
  },
) {
  const images = options?.images?.filter((item) => item.url) ?? [];
  const history = options?.history?.map((item) => item.trim()).filter(Boolean) ?? [];
  const currentMessages = options?.currentMessages ?? [];
  const content =
    images.length === 0
      ? message
      : [
          ...(message.trim() ? [{ type: "text", text: message }] : []),
          ...images.map((image) => ({ type: "image_url", image_url: { url: image.url } })),
        ];
  const messages = [
    ...history.map((text, index) => ({ id: `hist-${index + 1}`, role: "user" as const, content: text })),
    { id: "msg_current", role: "user" as const, content },
  ];
  return {
    threadId: options?.threadId || `thread-${Date.now()}`,
    runId: `run-${Date.now()}`,
    surfaceId: options?.surfaceId,
    messages,
    history,
    currentMessages,
    tools: [],
    context: [],
    forwardedProps: {
      ...(options?.mock ? { mock: options.mock } : {}),
      ...(options?.surfaceId ? { surfaceId: options.surfaceId } : {}),
      ...(currentMessages.length > 0 ? { currentMessages } : {}),
    },
    mock: options?.mock,
    images,
  };
}

export function generateUrl(sse: boolean, mock?: string) {
  const params = new URLSearchParams();
  params.set("sse", sse ? "1" : "0");
  if (mock) {
    params.set("mock", mock);
  }
  return apiUrl(`/v1/generate?${params.toString()}`);
}

/** A2UI 独立接口前缀，避免与主站 /api/v1 和其他服务冲突。 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/a2ui-api${normalized}`;
}

export function consumeSse(buffer: string, onEvent: (event: Record<string, unknown>) => void): string {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      // 半截 JSON 会留在 rest 里；已经按 \n\n 切开但仍无法 parse 的块丢掉
      continue;
    }
    onEvent(event);
  }
  return rest;
}

export function payloadErrorMessage(payload: unknown, fallback: string): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }
  return String((payload as { error?: { message?: unknown } }).error?.message ?? fallback);
}
