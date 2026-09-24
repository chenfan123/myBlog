import {
  DEFAULT_CATALOG_ID,
  SERVER_TO_CLIENT_ACTIONS,
  type A2UIMessage,
  type ServerToClientAction,
} from "./protocol";

export class A2UIServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "A2UIServerError";
  }
}

export function toJsonl(messages: readonly A2UIMessage[]): string {
  return messages.map((message) => JSON.stringify(message)).join("\n");
}

/** 从模型输出里抽出 A2UI 消息数组：支持 {messages}、JSON 数组、JSONL、markdown 代码块。 */
export function parseAgentOutput(raw: string): A2UIMessage[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new A2UIServerError(502, "AGENT_INVALID_OUTPUT", "Agent returned empty output");
  }

  const candidates = [trimmed, stripFence(trimmed)];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed) {
      return asMessageArray(parsed);
    }
    const jsonl = tryParseJsonl(candidate);
    if (jsonl) {
      return jsonl;
    }
  }

  throw new A2UIServerError(502, "AGENT_INVALID_OUTPUT", "Agent output is not valid A2UI JSON/JSONL");
}

export function normalizeMessages(
  messages: A2UIMessage[],
  surfaceId: string,
  catalogId: string = DEFAULT_CATALOG_ID,
): A2UIMessage[] {
  if (messages.length === 0) {
    throw new A2UIServerError(502, "AGENT_INVALID_OUTPUT", "Agent returned no A2UI messages");
  }

  const normalized = messages.map((message) => applySurfaceId(message, surfaceId));
  const firstAction = getAction(normalized[0]);
  if (firstAction !== "beginRendering") {
    throw new A2UIServerError(
      502,
      "AGENT_INVALID_OUTPUT",
      "First A2UI message must be beginRendering",
    );
  }

  const begin = normalized[0].beginRendering as Record<string, unknown>;
  if (typeof begin.root !== "string" || !begin.root) {
    throw new A2UIServerError(502, "AGENT_INVALID_OUTPUT", "beginRendering.root is required");
  }
  if (!begin.catalogId) {
    begin.catalogId = catalogId;
  }

  for (const message of normalized) {
    if (!getAction(message)) {
      throw new A2UIServerError(
        502,
        "AGENT_INVALID_OUTPUT",
        "Each A2UI message must contain exactly one of beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface",
      );
    }
  }

  return normalized;
}

/** surfaceUpdate 按 component 拆成独立 JSONL，方便 SSE 逐条推、客户端渐进渲染。 */
export function flattenMessages(messages: A2UIMessage[]): A2UIMessage[] {
  const flattened: A2UIMessage[] = [];
  for (const message of messages) {
    if (getAction(message) !== "surfaceUpdate") {
      flattened.push(message);
      continue;
    }
    const update = message.surfaceUpdate as { surfaceId?: string; components?: unknown[] };
    const components = Array.isArray(update.components) ? update.components : [];
    if (components.length <= 1) {
      flattened.push(message);
      continue;
    }
    for (const component of components) {
      flattened.push({
        surfaceUpdate: {
          surfaceId: update.surfaceId,
          components: [component],
        },
      });
    }
  }
  return flattened;
}

function applySurfaceId(message: A2UIMessage, surfaceId: string): A2UIMessage {
  const action = getAction(message);
  if (!action) {
    return { ...message };
  }
  const body = { ...(message[action] as Record<string, unknown>), surfaceId };
  return { [action]: body };
}

export function getAction(message: unknown): ServerToClientAction | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const present = SERVER_TO_CLIENT_ACTIONS.filter((action) => action in message);
  return present.length === 1 ? present[0] : undefined;
}

function asMessageArray(value: unknown): A2UIMessage[] {
  if (Array.isArray(value)) {
    return value.filter(isObject) as A2UIMessage[];
  }
  if (isObject(value) && Array.isArray(value.messages)) {
    return value.messages.filter(isObject) as A2UIMessage[];
  }
  if (isObject(value) && getAction(value)) {
    return [value as A2UIMessage];
  }
  throw new A2UIServerError(502, "AGENT_INVALID_OUTPUT", "Agent JSON must be a message array or { messages }");
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function tryParseJsonl(text: string): A2UIMessage[] | undefined {
  const messages: A2UIMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!isObject(parsed) || !getAction(parsed)) {
        return undefined;
      }
      messages.push(parsed as A2UIMessage);
    } catch {
      return undefined;
    }
  }
  return messages.length > 0 ? messages : undefined;
}

function stripFence(text: string): string {
  const match = text.match(/```(?:json|jsonl)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STREAM_NOISE = new Set([" ", "\n", "\r", "\t", ",", "[", "]"]);

/** 补 surfaceId / catalogId，不拆条。这是模型写作形态。 */
export function stampModelMessage(
  message: A2UIMessage,
  surfaceId: string,
  catalogId: string = DEFAULT_CATALOG_ID,
): A2UIMessage {
  const next = applySurfaceId(message, surfaceId);
  if (getAction(next) === "beginRendering") {
    const begin = next.beginRendering as Record<string, unknown>;
    if (!begin.catalogId) {
      begin.catalogId = catalogId;
    }
  }
  return next;
}

/** 把一条流式抽出的消息补上 surfaceId / catalogId，再按 component 拆开。 */
export function prepareStreamMessages(
  messages: A2UIMessage[],
  surfaceId: string,
  catalogId: string = DEFAULT_CATALOG_ID,
): A2UIMessage[] {
  return flattenMessages(messages.map((message) => stampModelMessage(message, surfaceId, catalogId)));
}

/**
 * 从模型 token 流里增量抽出 A2UI 消息。
 * 支持 JSONL、数组、`{ messages: [] }`，以及尚未闭合的外层包装。
 */
export function createAgentStreamParser() {
  let pending = "";

  return {
    push(chunk: string): A2UIMessage[] {
      if (!chunk) {
        return [];
      }
      pending += chunk;
      const extracted = extractAvailableMessages(pending);
      pending = extracted.rest;
      return extracted.messages;
    },
    finish(): A2UIMessage[] {
      const extracted = extractAvailableMessages(pending);
      pending = extracted.rest;
      if (extracted.messages.length > 0) {
        return extracted.messages;
      }
      const leftover = pending.trim();
      if (!leftover || /^[\s\]\}`]+$/.test(leftover)) {
        pending = "";
        return [];
      }
      try {
        const messages = parseAgentOutput(pending);
        pending = "";
        return messages;
      } catch {
        return [];
      }
    },
  };
}

function extractAvailableMessages(source: string): { messages: A2UIMessage[]; rest: string } {
  const opened = openMessageStream(source);
  if (!opened) {
    return { messages: [], rest: source };
  }

  let body = opened.body;
  const messages: A2UIMessage[] = [];
  while (true) {
    const next = extractNextObject(body);
    if (!next) {
      break;
    }
    body = next.rest;
    if (next.invalid || !isObject(next.value)) {
      continue;
    }
    if (getAction(next.value)) {
      messages.push(next.value as A2UIMessage);
      continue;
    }
    if (Array.isArray(next.value.messages)) {
      messages.push(...asMessageArray(next.value));
    }
  }

  return { messages, rest: opened.prefix + body };
}

function openMessageStream(source: string): { prefix: string; body: string } | null {
  let index = 0;
  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }
  if (source.startsWith("```", index)) {
    const newline = source.indexOf("\n", index);
    if (newline === -1) {
      return null;
    }
    index = newline + 1;
    while (index < source.length && /\s/.test(source[index] ?? "")) {
      index += 1;
    }
  }

  const start = source.slice(index).search(/[\[{]/);
  if (start === -1) {
    return { prefix: source, body: "" };
  }
  index += start;
  const slice = source.slice(index);

  if (slice.startsWith("[")) {
    return { prefix: source.slice(0, index + 1), body: source.slice(index + 1) };
  }

  const wrapped = slice.match(/^\{[\s\r\n]*"messages"[\s\r\n]*:[\s\r\n]*\[/);
  if (wrapped) {
    return { prefix: source.slice(0, index + wrapped[0].length), body: source.slice(index + wrapped[0].length) };
  }

  const key = slice.match(/^\{[\s\r\n]*"(\w*)/);
  if (!key) {
    return /\{[\s\r\n]*$/.test(slice) || /^\{[\s\r\n]*"$/.test(slice) ? null : { prefix: source.slice(0, index), body: slice };
  }
  if (key[1] !== "messages" && "messages".startsWith(key[1] ?? "")) {
    return null;
  }
  if (key[1] === "messages" && !slice.includes("[")) {
    return null;
  }
  return { prefix: source.slice(0, index), body: slice };
}

function extractNextObject(source: string): { value: unknown; rest: string; invalid: boolean } | null {
  const start = skipStreamNoise(source, 0);
  if (start >= source.length || source[start] !== "{") {
    return null;
  }
  const end = findJsonObjectEnd(source, start);
  if (end === null) {
    return null;
  }
  const raw = source.slice(start, end + 1);
  try {
    return { value: JSON.parse(raw), rest: source.slice(end + 1), invalid: false };
  } catch {
    return { value: undefined, rest: source.slice(end + 1), invalid: true };
  }
}

function skipStreamNoise(source: string, from: number): number {
  let index = from;
  while (index < source.length && STREAM_NOISE.has(source[index] ?? "")) {
    index += 1;
  }
  return index;
}

function findJsonObjectEnd(source: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}
