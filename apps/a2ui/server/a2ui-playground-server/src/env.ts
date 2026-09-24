import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 读取 server 包内 `.env`，不覆盖已有 process.env。 */
export function loadDotEnv(file = resolve(__dirname, "../.env")): void {
  if (!existsSync(file)) {
    return;
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** 多语言出界面 / 对话：优先 DASHSCOPE_MODEL2。 */
export function dashscopeTextModel(): string {
  return process.env.DASHSCOPE_MODEL2?.trim() || process.env.DASHSCOPE_MODEL?.trim() || "qwen-plus";
}

/** 多模态看图：优先 VL，否则 DASHSCOPE_MODEL。 */
export function dashscopeVisionModel(): string {
  return process.env.DASHSCOPE_VL_MODEL?.trim() || process.env.DASHSCOPE_MODEL?.trim() || dashscopeTextModel();
}

/** DashScope 文生图模型（兼容 /images/generations），不是 Omni / 对话模型。 */
export function isImageGenerationModel(model: string): boolean {
  return /qwen-image|wanx-|wan2\.|flux-/i.test(model);
}

/**
 * 图片生成：优先 DASHSCOPE_IMAGE_MODEL；
 * 否则当 DASHSCOPE_MODEL 本身是出图模型时用它；
 * Omni / flash 等对话模型会落到 qwen-image-plus。
 */
export function dashscopeImageModel(): string {
  const explicit = process.env.DASHSCOPE_IMAGE_MODEL?.trim();
  if (explicit) {
    return explicit;
  }
  const requested = process.env.DASHSCOPE_MODEL?.trim();
  if (requested && isImageGenerationModel(requested)) {
    return requested;
  }
  return "qwen-image-plus";
}
