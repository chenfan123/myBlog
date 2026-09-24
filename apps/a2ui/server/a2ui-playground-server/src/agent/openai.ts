import OpenAI from "openai";
import { createAgentStreamParser, parseAgentOutput, toJsonl } from "../a2ui-server/parse";
import { A2UIServerError } from "../a2ui-server/parse";
import { IMAGE_ONLY_PROMPT } from "./images";
import { buildAgentSystemPrompt, buildContinuationUserPrompt } from "./prompt";
import type { A2UIAgent, AgentImage, GenerateA2UIInput, GenerateA2UIResult } from "./types";

function maxOutputTokens() {
  const raw = Number(process.env.A2UI_MAX_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8192;
}

/** 百炼 Qwen3.8-Max / DeepSeek 默认会先长思考，A2UI 协议半天出不来。默认关掉。 */
function thinkingOff(kind: string): { extra_body?: { enable_thinking: boolean } } {
  if (kind !== "dashscope" || process.env.A2UI_ENABLE_THINKING === "1") {
    return {};
  }
  return { extra_body: { enable_thinking: false } };
}

function buildChatMessages(input: GenerateA2UIInput) {
  const images = input.images ?? [];
  const messages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: ReturnType<typeof buildUserContent> }
    | { role: "assistant"; content: string }
  > = [{ role: "system", content: buildAgentSystemPrompt(input) }];

  const prior = buildPriorAssistantContent(input);
  if (prior) {
    messages.push({ role: "assistant", content: prior });
  }
  messages.push({ role: "user", content: buildUserContent(input.message, images) });
  if (input.continuation) {
    messages.push({ role: "assistant", content: input.continuation.alreadyEmitted });
    messages.push({
      role: "user",
      content: buildContinuationUserPrompt(input.continuation.missingIds),
    });
  }
  return messages;
}

function buildPriorAssistantContent(input: GenerateA2UIInput): string {
  const parts: string[] = [];
  if (input.history && input.history.length > 0) {
    parts.push(`已理解此前需求：\n${input.history.map((item, index) => `${index + 1}. ${item}`).join("\n")}`);
  }
  if (input.currentMessages && input.currentMessages.length > 0) {
    parts.push(
      `当前界面协议（JSONL）。下一轮微调请沿用这些 id 与 surfaceId「${input.surfaceId}」：\n${toJsonl(input.currentMessages)}`,
    );
  }
  return parts.join("\n\n");
}

export interface OpenAIAgentOptions {
  apiKey?: string;
  model?: string;
  visionModel?: string;
  baseURL?: string;
  kind?: string;
}

export function createOpenAIAgent(options?: OpenAIAgentOptions): A2UIAgent {
  const apiKey =
    options?.apiKey ?? process.env.DASHSCOPE_API_KEY ?? process.env.OPENAI_API_KEY;
  const model =
    options?.model ??
    process.env.DASHSCOPE_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-4o-mini";
  const visionModel = options?.visionModel?.trim() || undefined;
  const baseURL =
    options?.baseURL ?? process.env.DASHSCOPE_API_BASE ?? process.env.OPENAI_BASE_URL;
  const kind =
    options?.kind ?? (process.env.DASHSCOPE_API_KEY ? "dashscope" : "openai");

  if (!apiKey) {
    throw new A2UIServerError(
      503,
      "AGENT_UNAVAILABLE",
      "DASHSCOPE_API_KEY or OPENAI_API_KEY is not set",
    );
  }

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return {
    kind,
    async generate(input: GenerateA2UIInput): Promise<GenerateA2UIResult> {
      const images = input.images ?? [];
      const selectedModel = images.length > 0 ? visionModel || model : model;
      let content: string;
      try {
        const completion = await client.chat.completions.create({
          model: selectedModel,
          temperature: 0.2,
          max_tokens: maxOutputTokens(),
          messages: buildChatMessages(input),
          ...thinkingOff(kind),
        });
        content = completion.choices[0]?.message?.content ?? "";
      } catch (error) {
        const detail = error instanceof Error ? error.message : "LLM request failed";
        throw new A2UIServerError(502, "AGENT_UNAVAILABLE", detail);
      }

      return {
        raw: content,
        messages: parseAgentOutput(content),
      };
    },
    async *stream(input: GenerateA2UIInput) {
      const images = input.images ?? [];
      const selectedModel = images.length > 0 ? visionModel || model : model;
      let completion;
      try {
        completion = await client.chat.completions.create({
          model: selectedModel,
          temperature: 0.2,
          max_tokens: maxOutputTokens(),
          stream: true,
          messages: buildChatMessages(input),
          ...thinkingOff(kind),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "LLM request failed";
        throw new A2UIServerError(502, "AGENT_UNAVAILABLE", detail);
      }

      const parser = createAgentStreamParser();
      try {
        for await (const chunk of completion) {
          const raw = chunk.choices[0]?.delta as
            | { content?: string | null; reasoning_content?: string | null }
            | undefined;
          const thinking = raw?.reasoning_content ?? "";
          const content = raw?.content ?? "";
          if (thinking) {
            yield { type: "delta", text: thinking };
          }
          if (content) {
            yield { type: "delta", text: content };
            for (const message of parser.push(content)) {
              yield message;
            }
          }
        }
        for (const message of parser.finish()) {
          yield message;
        }
      } catch (error) {
        if (error instanceof A2UIServerError) {
          throw error;
        }
        const detail = error instanceof Error ? error.message : "LLM stream failed";
        throw new A2UIServerError(502, "AGENT_UNAVAILABLE", detail);
      }
    },
  };
}

export function buildUserContent(
  message: string,
  images: AgentImage[],
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  if (images.length === 0) {
    return message;
  }
  return [
    { type: "text", text: message.trim() || IMAGE_ONLY_PROMPT },
    ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.url } })),
  ];
}
