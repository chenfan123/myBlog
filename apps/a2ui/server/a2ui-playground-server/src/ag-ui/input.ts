import { randomUUID } from "node:crypto";
import type { AgentImage } from "../agent/images";
import { assertAgentImages, imagesFromContent, parseAgentImages } from "../agent/images";
import type { A2UIMessage } from "../a2ui-server/protocol";
import type { RunAgentInput } from "./types";

export interface ParsedRunRequest {
  threadId: string;
  runId: string;
  message: string;
  surfaceId?: string;
  mockId?: string;
  images: AgentImage[];
  history: string[];
  currentMessages: A2UIMessage[];
}

export function parseRunRequest(
  body: RunAgentInput | undefined,
  query: Record<string, unknown>,
): ParsedRunRequest {
  const threadId = firstString(body?.threadId, query.threadId) || `thread-${randomUUID().slice(0, 8)}`;
  const runId = firstString(body?.runId, query.runId) || `run-${randomUUID().slice(0, 8)}`;
  const surfaceId =
    firstString(
      body?.surfaceId,
      typeof body?.forwardedProps?.surfaceId === "string" ? body.forwardedProps.surfaceId : undefined,
      query.surfaceId,
    ) || undefined;
  const mockId =
    firstString(
      query.mock,
      body?.mock,
      typeof body?.forwardedProps?.mock === "string" ? body.forwardedProps.mock : undefined,
    ) || undefined;
  const message =
    lastUserText(body?.messages) || firstString(body?.message, query.message) || mockId || "";
  const images = assertAgentImages([
    ...lastUserImages(body?.messages),
    ...parseAgentImages(body?.images),
    ...parseAgentImages(body?.forwardedProps?.images),
  ]);
  const history = readHistory(body, message);
  const currentMessages = readCurrentMessages(body);

  return { threadId, runId, message, surfaceId, mockId, images, history, currentMessages };
}

function readHistory(body: RunAgentInput | undefined, currentMessage: string): string[] {
  if (Array.isArray(body?.history)) {
    return body.history.map((item) => String(item).trim()).filter(Boolean);
  }
  const texts = userTexts(body?.messages);
  if (texts.length === 0) {
    return [];
  }
  const last = texts[texts.length - 1];
  return last === currentMessage ? texts.slice(0, -1) : texts;
}

function readCurrentMessages(body: RunAgentInput | undefined): A2UIMessage[] {
  const candidates = [body?.currentMessages, body?.forwardedProps?.currentMessages, body?.state];
  for (const candidate of candidates) {
    const messages = asMessageArray(candidate);
    if (messages.length > 0) {
      return messages;
    }
  }
  return [];
}

function userTexts(messages: RunAgentInput["messages"]): string[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .filter((item) => item?.role === "user")
    .map((item) => contentToText(item.content))
    .filter(Boolean);
}

function asMessageArray(value: unknown): A2UIMessage[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is A2UIMessage => typeof item === "object" && item !== null);
  }
  if (value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)) {
    return asMessageArray((value as { messages: unknown }).messages);
  }
  return [];
}

/** `?sse=0|false|no|off` 关闭 SSE，改一次性 JSON；缺省或 `1|true|yes|on` 走 SSE。 */
export function wantsSse(query: Record<string, unknown>): boolean {
  if (!("sse" in query)) {
    return true;
  }
  const raw = firstString(query.sse).toLowerCase();
  if (!raw) {
    return true;
  }
  return !/^(0|false|no|off)$/.test(raw);
}

function lastUserText(messages: RunAgentInput["messages"]): string {
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role !== "user") {
      continue;
    }
    const text = contentToText(item.content);
    if (text) {
      return text;
    }
  }
  return "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("")
    .trim();
}

function lastUserImages(messages: RunAgentInput["messages"]): AgentImage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role !== "user") {
      continue;
    }
    return imagesFromContent(item.content);
  }
  return [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
      return value[0].trim();
    }
  }
  return "";
}
