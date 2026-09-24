import { A2UIServerError } from "../a2ui-server/parse";
import { dashscopeImageModel } from "../env";
import { assertAgentImages, type AgentImage } from "./images";

export interface GenerateImageInput {
  prompt: string;
  images?: AgentImage[];
  size?: string;
}

export interface GeneratedImage {
  url: string;
  model: string;
}

export function sizeForUsageHint(usageHint?: string): string {
  switch (usageHint) {
    case "header":
    case "largeFeature":
      return "1280x720";
    case "icon":
    case "avatar":
    case "smallFeature":
      return "512x512";
    default:
      return "1024x1024";
  }
}

/** qwen-image-plus 原生接口用 width*height。 */
export function nativeImageSize(size?: string): string {
  if (size && /^\d+\*\d+$/.test(size)) {
    return size;
  }
  switch (size) {
    case "1280x720":
      return "1664*928";
    case "512x512":
      return "1328*1328";
    default:
      return "1328*1328";
  }
}

/** compatible-mode 根路径 → 原生 API 的 origin。 */
export function dashscopeNativeOrigin(baseURL?: string): string {
  const base = (baseURL ?? process.env.DASHSCOPE_API_BASE ?? "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(
    /\/$/,
    "",
  );
  return base.replace(/\/compatible-mode\/v1$/i, "") || "https://dashscope.aliyuncs.com";
}

/** 仅 qwen-image-3.x 走 OpenAI 兼容 /images/generations。 */
export function usesCompatibleImageApi(model: string): boolean {
  return /qwen-image-3/i.test(model);
}

export function readGeneratePrompt(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^generate:/i.test(trimmed)) {
    return trimmed.slice("generate:".length).trim();
  }
  return trimmed;
}

export function parseImageGenerationResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", "image API returned an empty body");
  }
  const record = payload as {
    error?: { message?: unknown };
    data?: Array<{ url?: unknown; b64_json?: unknown }>;
  };
  if (record.error?.message) {
    throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", String(record.error.message));
  }
  const item = Array.isArray(record.data) ? record.data[0] : undefined;
  if (typeof item?.url === "string" && item.url.trim()) {
    return item.url.trim();
  }
  if (typeof item?.b64_json === "string" && item.b64_json.trim()) {
    return `data:image/png;base64,${item.b64_json.trim()}`;
  }
  throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", "image API did not return a url");
}

export function parseNativeTaskSubmit(payload: unknown): string {
  const record = payload as { output?: { task_id?: unknown }; message?: unknown; code?: unknown };
  if (typeof record?.output?.task_id === "string" && record.output.task_id.trim()) {
    return record.output.task_id.trim();
  }
  throw new A2UIServerError(
    502,
    "IMAGE_UNAVAILABLE",
    String(record?.message ?? record?.code ?? "image task did not return task_id"),
  );
}

export function parseNativeTaskResult(payload: unknown): string | "pending" {
  const record = payload as {
    output?: { task_status?: unknown; results?: Array<{ url?: unknown }>; message?: unknown };
    message?: unknown;
  };
  const status = String(record.output?.task_status ?? "");
  if (status === "SUCCEEDED") {
    const url = record.output?.results?.[0]?.url;
    if (typeof url === "string" && url.trim()) {
      return url.trim();
    }
    throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", "image task succeeded without a url");
  }
  if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
    throw new A2UIServerError(
      502,
      "IMAGE_UNAVAILABLE",
      String(record.message ?? record.output?.message ?? `image task ${status}`),
    );
  }
  return "pending";
}

function readJsonResponse(text: string, status: number, model: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    throw new A2UIServerError(
      502,
      "IMAGE_UNAVAILABLE",
      `image API HTTP ${status} (${model}): ${text.slice(0, 200) || "empty body"}`,
    );
  }
}

export async function generateDashscopeImage(input: GenerateImageInput): Promise<GeneratedImage> {
  const prompt = readGeneratePrompt(input.prompt);
  if (!prompt) {
    throw new A2UIServerError(400, "PROMPT_REQUIRED", "prompt is required");
  }
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new A2UIServerError(503, "IMAGE_UNAVAILABLE", "DASHSCOPE_API_KEY is not set");
  }
  const model = dashscopeImageModel();
  const images = assertAgentImages(input.images ?? []);
  try {
    const url = usesCompatibleImageApi(model)
      ? await generateCompatibleImage(apiKey, model, prompt, images, input.size)
      : await generateNativeImage(apiKey, model, prompt, images, input.size);
    return { url, model };
  } catch (error) {
    if (error instanceof A2UIServerError) {
      throw error;
    }
    throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", error instanceof Error ? error.message : "image request failed");
  }
}

async function generateCompatibleImage(
  apiKey: string,
  model: string,
  prompt: string,
  images: AgentImage[],
  size?: string,
): Promise<string> {
  const baseURL = (process.env.DASHSCOPE_API_BASE?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(
    /\/$/,
    "",
  );
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    size: size?.trim() || "1024x1024",
  };
  if (images.length === 1) {
    body.image = images[0]?.url;
  } else if (images.length > 1) {
    body.image = images.map((item) => item.url);
  }
  const response = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = readJsonResponse(await response.text(), response.status, model);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: unknown } }).error?.message ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
    throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", `${message} (${model})`);
  }
  return parseImageGenerationResponse(payload);
}

async function generateNativeImage(
  apiKey: string,
  model: string,
  prompt: string,
  images: AgentImage[],
  size?: string,
): Promise<string> {
  const origin = dashscopeNativeOrigin();
  const input: Record<string, unknown> = { prompt };
  if (images.length === 1) {
    input.images = [images[0]?.url];
  } else if (images.length > 1) {
    input.images = images.map((item) => item.url);
  }
  const response = await fetch(`${origin}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input,
      parameters: {
        size: nativeImageSize(size),
        n: 1,
        prompt_extend: true,
        watermark: false,
      },
    }),
  });
  const payload = readJsonResponse(await response.text(), response.status, model);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? String((payload as { message?: unknown }).message ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
    throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", `${message} (${model})`);
  }
  const taskId = parseNativeTaskSubmit(payload);
  return pollNativeTask(origin, apiKey, taskId, model);
}

async function pollNativeTask(origin: string, apiKey: string, taskId: string, model: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`${origin}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const payload = readJsonResponse(await response.text(), response.status, model);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object"
          ? String((payload as { message?: unknown }).message ?? `HTTP ${response.status}`)
          : `HTTP ${response.status}`;
      throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", `${message} (${model})`);
    }
    const result = parseNativeTaskResult(payload);
    if (result !== "pending") {
      return result;
    }
  }
  throw new A2UIServerError(502, "IMAGE_UNAVAILABLE", `image task timed out (${model})`);
}
