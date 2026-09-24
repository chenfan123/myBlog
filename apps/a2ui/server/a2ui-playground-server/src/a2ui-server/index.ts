import { randomUUID } from "node:crypto";
import type { A2UIAgent } from "../agent/types";
import type { AgentImage } from "../agent/images";
import { loadLocalMock } from "../agent/local-mocks";
import { inspectComponentGraph } from "./completeness";
import { mergeProtocol, surfaceIdFromMessages } from "./merge";
import {
  A2UIServerError,
  flattenMessages,
  normalizeMessages,
  parseAgentOutput,
  stampModelMessage,
  toJsonl,
} from "./parse";
import { DEFAULT_CATALOG_ID, type A2UIMessage } from "./protocol";

export interface GenerateInput {
  message: string;
  surfaceId?: string;
  mockId?: string;
  images?: AgentImage[];
  history?: string[];
  currentMessages?: A2UIMessage[];
}

export interface GeneratedSurface {
  surfaceId: string;
  catalogId: string;
  prompt: string;
  /** 模型/mock 写作形态：解析并补全 surfaceId 后、尚未按 component 拆条。 */
  modelMessages: A2UIMessage[];
  /** 转换后：一条 surfaceUpdate 一个 component，供 SSE / parse。 */
  messages: A2UIMessage[];
  jsonl: string;
  updatedAt: string;
  incomplete?: { missingIds: string[] };
}

export type StreamEvent =
  | { event: "a2ui"; data: A2UIMessage }
  | { event: "delta"; data: { text: string } }
  | {
      event: "done";
      data: {
        surfaceId: string;
        catalogId: string;
        modelMessages: A2UIMessage[];
        messages: A2UIMessage[];
        incomplete?: { missingIds: string[] };
      };
    };

export interface A2UIServer {
  generate(input: GenerateInput): Promise<GeneratedSurface>;
  stream(input: GenerateInput): AsyncGenerator<StreamEvent>;
  getSurface(surfaceId: string): GeneratedSurface | undefined;
}

export function createA2UIServer(options: { agent: A2UIAgent; catalogId?: string }): A2UIServer {
  const cache = new Map<string, GeneratedSurface>();
  const catalogId = options.catalogId ?? DEFAULT_CATALOG_ID;

  async function generate(input: GenerateInput): Promise<GeneratedSurface> {
    const mockId = input.mockId?.trim();
    const images = input.images ?? [];
    const prompt = input.message?.trim() || mockId || "";
    if (!prompt && images.length === 0) {
      throw new A2UIServerError(400, "MESSAGE_REQUIRED", "message is required");
    }

    const currentMessages = input.currentMessages ?? [];
    const history = input.history ?? [];
    const surfaceId =
      input.surfaceId?.trim() ||
      surfaceIdFromMessages(currentMessages) ||
      `surface-${randomUUID().slice(0, 8)}`;
    let patches: A2UIMessage[] = [];
    let merged: A2UIMessage[];

    if (mockId) {
      const loaded = loadLocalMock(mockId);
      if (!loaded) {
        throw new A2UIServerError(404, "MOCK_NOT_FOUND", `unknown mock: ${mockId}`);
      }
      merged = normalizeMessages(loaded, surfaceId, catalogId);
      patches = merged;
    } else {
      const result = await options.agent.generate({
        message: prompt,
        surfaceId,
        catalogId,
        images,
        history,
        currentMessages,
      });
      const parsed = Array.isArray(result.messages)
        ? result.messages
        : parseAgentOutput(result.raw ?? "");
      patches = parsed.map((message) => stampModelMessage(message, surfaceId, catalogId));
      merged =
        currentMessages.length > 0
          ? mergeProtocol(currentMessages, parsed, surfaceId, catalogId)
          : normalizeMessages(parsed, surfaceId, catalogId);
      merged = await continueIfIncomplete(merged, {
        message: prompt,
        surfaceId,
        catalogId,
        images,
        history,
        currentMessages: merged,
      });
    }

    const messages = flattenMessages(merged);
    const generated = toGeneratedSurface({
      surfaceId,
      catalogId,
      prompt,
      modelMessages: currentMessages.length > 0 ? patches : merged,
      messages,
    });
    cache.set(surfaceId, generated);
    return generated;
  }

  async function continueIfIncomplete(
    modelMessages: A2UIMessage[],
    input: {
      message: string;
      surfaceId: string;
      catalogId: string;
      images: AgentImage[];
      history?: string[];
      currentMessages?: A2UIMessage[];
    },
  ): Promise<A2UIMessage[]> {
    const missingIds = inspectComponentGraph(modelMessages).missingIds;
    if (missingIds.length === 0) {
      return modelMessages;
    }
    try {
      const result = await options.agent.generate({
        ...input,
        continuation: {
          alreadyEmitted: toJsonl(modelMessages),
          missingIds,
        },
      });
      const parsed = Array.isArray(result.messages)
        ? result.messages
        : parseAgentOutput(result.raw ?? "");
      return mergeProtocol(modelMessages, parsed, input.surfaceId, input.catalogId);
    } catch {
      return modelMessages;
    }
  }

  return {
    generate,
    async *stream(input) {
      const mockId = input.mockId?.trim();
      if (mockId || !options.agent.stream) {
        const generated = await generate(input);
        for (const message of generated.messages) {
          yield { event: "a2ui", data: message };
        }
        yield {
          event: "done",
          data: donePayload(generated),
        };
        return;
      }

      const prompt = input.message?.trim() || "";
      const images = input.images ?? [];
      const history = input.history ?? [];
      const currentMessages = input.currentMessages ?? [];
      if (!prompt && images.length === 0) {
        throw new A2UIServerError(400, "MESSAGE_REQUIRED", "message is required");
      }

      const surfaceId =
        input.surfaceId?.trim() ||
        surfaceIdFromMessages(currentMessages) ||
        `surface-${randomUUID().slice(0, 8)}`;
      const patches: A2UIMessage[] = [];

      const ingest = async function* (extra?: {
        alreadyEmitted: string;
        missingIds: string[];
      }) {
        for await (const chunk of options.agent.stream!({
          message: prompt,
          surfaceId,
          catalogId,
          images,
          history,
          currentMessages: extra ? flattenMerged(currentMessages, patches, surfaceId, catalogId) : currentMessages,
          continuation: extra,
        })) {
          if (isDeltaChunk(chunk)) {
            yield { event: "delta" as const, data: { text: chunk.text } };
            continue;
          }
          const stamped = stampModelMessage(chunk, surfaceId, catalogId);
          patches.push(stamped);
          for (const item of flattenMessages([stamped])) {
            yield { event: "a2ui" as const, data: item };
          }
        }
      };

      for await (const item of ingest()) {
        yield item;
      }

      if (patches.length === 0) {
        throw new A2UIServerError(502, "AGENT_INVALID_OUTPUT", "Agent returned no A2UI messages");
      }

      let merged = flattenMerged(currentMessages, patches, surfaceId, catalogId);
      const missingIds = inspectComponentGraph(merged).missingIds;
      if (missingIds.length > 0) {
        for await (const item of ingest({
          alreadyEmitted: toJsonl(merged),
          missingIds,
        })) {
          yield item;
        }
        merged = flattenMerged(currentMessages, patches, surfaceId, catalogId);
      }

      const generated = toGeneratedSurface({
        surfaceId,
        catalogId,
        prompt,
        modelMessages: patches,
        messages: merged,
      });
      cache.set(surfaceId, generated);
      yield {
        event: "done",
        data: donePayload(generated),
      };
    },
    getSurface(surfaceId) {
      return cache.get(surfaceId);
    },
  };
}

function flattenMerged(
  current: A2UIMessage[],
  patch: A2UIMessage[],
  surfaceId: string,
  catalogId: string,
): A2UIMessage[] {
  if (current.length === 0) {
    return flattenMessages(normalizeMessages(patch, surfaceId, catalogId));
  }
  return flattenMessages(mergeProtocol(current, patch, surfaceId, catalogId));
}

function toGeneratedSurface(input: {
  surfaceId: string;
  catalogId: string;
  prompt: string;
  modelMessages: A2UIMessage[];
  messages: A2UIMessage[];
}): GeneratedSurface {
  const missingIds = inspectComponentGraph(input.messages).missingIds;
  return {
    ...input,
    jsonl: toJsonl(input.messages),
    updatedAt: new Date().toISOString(),
    ...(missingIds.length > 0 ? { incomplete: { missingIds } } : {}),
  };
}

function donePayload(generated: GeneratedSurface) {
  return {
    surfaceId: generated.surfaceId,
    catalogId: generated.catalogId,
    modelMessages: generated.modelMessages,
    messages: generated.messages,
    ...(generated.incomplete ? { incomplete: generated.incomplete } : {}),
  };
}

function isDeltaChunk(value: unknown): value is { type: "delta"; text: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "delta" &&
      typeof (value as { text?: unknown }).text === "string",
  );
}

export { A2UIServerError, inspectComponentGraph, mergeProtocol };
