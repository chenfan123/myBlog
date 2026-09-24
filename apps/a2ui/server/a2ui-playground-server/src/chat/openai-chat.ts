import OpenAI from "openai";
import { A2UIServerError } from "../a2ui-server/parse";
import { dashscopeTextModel } from "../env";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatClient {
  provider: string;
  model: string;
  complete(messages: ChatTurn[]): Promise<string>;
  stream(messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string>;
}

export interface ChatClientOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  provider?: string;
}

const CHAT_SYSTEM =
  "You are a helpful assistant. Reply in the user's language. This endpoint only tests plain model chat, not A2UI.";

function thinkingOff(provider: string): { extra_body?: { enable_thinking: boolean } } {
  if (provider !== "dashscope" || process.env.A2UI_ENABLE_THINKING === "1") {
    return {};
  }
  return { extra_body: { enable_thinking: false } };
}

export function createOpenAIChat(options: ChatClientOptions): ChatClient {
  const model = options.model?.trim() || "gpt-4o-mini";
  const provider = options.provider ?? "openai";
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });

  function normalizeTurns(messages: ChatTurn[]) {
    const turns = messages
      .map((item) => ({
        role: item.role,
        content: item.content.trim(),
      }))
      .filter((item) => item.content.length > 0);
    if (turns.length === 0) {
      throw new A2UIServerError(400, "MESSAGE_REQUIRED", "messages is required");
    }
    return turns;
  }

  return {
    provider,
    model,
    async complete(messages: ChatTurn[]): Promise<string> {
      const turns = normalizeTurns(messages);
      try {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.4,
          messages: [{ role: "system", content: CHAT_SYSTEM }, ...turns],
          ...thinkingOff(provider),
        });
        return completion.choices[0]?.message?.content?.trim() || "";
      } catch (error) {
        const detail = error instanceof Error ? error.message : "LLM request failed";
        throw new A2UIServerError(502, "CHAT_UNAVAILABLE", detail);
      }
    },
    async *stream(messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string> {
      const turns = normalizeTurns(messages);
      try {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.4,
          stream: true,
          messages: [{ role: "system", content: CHAT_SYSTEM }, ...turns],
          ...thinkingOff(provider),
          ...(signal ? { signal } : {}),
        });
        for await (const chunk of completion) {
          if (signal?.aborted) {
            break;
          }
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        }
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const detail = error instanceof Error ? error.message : "LLM request failed";
        throw new A2UIServerError(502, "CHAT_UNAVAILABLE", detail);
      }
    },
  };
}

/** 优先 OPENAI_*，没有再回退 DASHSCOPE_*，都没有则不可用。 */
export function createChatFromEnv(): ChatClient | undefined {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return createOpenAIChat({
      apiKey: openaiKey,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      provider: "openai",
    });
  }

  const dashscopeKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (dashscopeKey) {
    return createOpenAIChat({
      apiKey: dashscopeKey,
      baseURL: process.env.DASHSCOPE_API_BASE?.trim() || undefined,
      model: dashscopeTextModel(),
      provider: "dashscope",
    });
  }

  return undefined;
}

export function parseChatTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const turns: ChatTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant" || role === "system") && typeof content === "string") {
      turns.push({ role, content });
    }
  }
  return turns;
}
