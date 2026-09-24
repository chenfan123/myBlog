import { A2UIServerError } from "../a2ui-server/parse";

export interface AgentImage {
  url: string;
}

export const MAX_AGENT_IMAGES = 4;
export const MAX_DATA_URL_CHARS = 6_000_000;
export const IMAGE_ONLY_PROMPT =
  "Generate A2UI v0.8 JSON for the attached screenshot(s). Follow the system rules.";

const DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/i;

export function parseAgentImages(value: unknown): AgentImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: AgentImage[] = [];
  for (const item of value) {
    const url = imageUrlFromUnknown(item);
    if (url) {
      images.push({ url });
    }
  }
  return images;
}

export function imagesFromContent(content: unknown): AgentImage[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return parseAgentImages(content);
}

export function assertAgentImages(images: AgentImage[]): AgentImage[] {
  if (images.length > MAX_AGENT_IMAGES) {
    throw new A2UIServerError(400, "INVALID_IMAGE", `at most ${MAX_AGENT_IMAGES} images`);
  }
  for (const image of images) {
    if (!isAllowedImageUrl(image.url)) {
      throw new A2UIServerError(400, "INVALID_IMAGE", "image must be http(s) or data:image/*;base64");
    }
    if (image.url.startsWith("data:") && image.url.length > MAX_DATA_URL_CHARS) {
      throw new A2UIServerError(400, "INVALID_IMAGE", "image data URL is too large");
    }
  }
  return dedupeImages(images);
}

export function isAllowedImageUrl(url: string): boolean {
  if (DATA_URL.test(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function imageUrlFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string" && record.url.trim()) {
    return record.url.trim();
  }
  const nested = record.image_url;
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }
  if (nested && typeof nested === "object" && typeof (nested as { url?: unknown }).url === "string") {
    const url = (nested as { url: string }).url.trim();
    if (url) {
      return url;
    }
  }
  return undefined;
}

function dedupeImages(images: AgentImage[]): AgentImage[] {
  const seen = new Set<string>();
  const next: AgentImage[] = [];
  for (const image of images) {
    if (seen.has(image.url)) {
      continue;
    }
    seen.add(image.url);
    next.push(image);
  }
  return next;
}
