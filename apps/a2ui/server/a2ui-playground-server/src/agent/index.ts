import { dashscopeTextModel, dashscopeVisionModel } from "../env";
import { createMockAgent } from "./mock";
import { createOpenAIAgent } from "./openai";
import type { A2UIAgent } from "./types";

export type { A2UIAgent, GenerateA2UIInput, GenerateA2UIResult } from "./types";
export { createOpenAIAgent } from "./openai";
export { createMockAgent, createStubAgent } from "./mock";
export { buildAgentSystemPrompt } from "./prompt";

/** 有 DashScope / OpenAI key 就走兼容模式 LLM，否则 mock。 */
export function createAgentFromEnv(): A2UIAgent {
  const dashscopeKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (dashscopeKey) {
    return createOpenAIAgent({
      apiKey: dashscopeKey,
      baseURL: process.env.DASHSCOPE_API_BASE?.trim() || undefined,
      model: dashscopeTextModel(),
      visionModel: dashscopeVisionModel(),
      kind: "dashscope",
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return createOpenAIAgent({
      apiKey: openaiKey,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
      model: process.env.OPENAI_MODEL?.trim() || undefined,
      visionModel: process.env.OPENAI_VL_MODEL?.trim() || undefined,
      kind: "openai",
    });
  }

  return createMockAgent();
}
