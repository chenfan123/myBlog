import { useEffect, useState, type CSSProperties } from "react";
import type { HostProps } from "../host.js";
import { useHost } from "../host.js";
import { iconGlyph } from "./icons.js";

const imageSize: Record<string, CSSProperties> = {
  icon: { width: 24, height: 24 },
  avatar: { width: 40, height: 40, borderRadius: "50%", objectFit: "cover" },
  smallFeature: { width: 68, height: 68 },
  mediumFeature: { width: 160, height: 160 },
  largeFeature: { width: 240, height: 180 },
  header: { width: "100%", height: 210, objectFit: "cover" },
};

const generatedCache = new Map<string, string>();

function isDisplayableUrl(url: string): boolean {
  return /^(https?:|data:image\/)/i.test(url.trim());
}

function generatePromptOf(url: string, prompt?: string): string {
  const explicit = prompt?.trim() ?? "";
  if (explicit) {
    return explicit.replace(/^generate:/i, "").trim();
  }
  const trimmed = url.trim();
  if (/^generate:/i.test(trimmed)) {
    return trimmed.slice("generate:".length).trim();
  }
  return "";
}

export function Image({
  url = "",
  prompt,
  fit = "cover",
  usageHint = "mediumFeature",
  componentId,
  hasMounted,
}: HostProps & { url?: string; prompt?: string; fit?: string; usageHint?: string }) {
  const host = useHost("Image", componentId, hasMounted);
  const generatePrompt = generatePromptOf(url, prompt);
  const readyUrl = isDisplayableUrl(url) ? url.trim() : "";
  const [src, setSrc] = useState(readyUrl);
  const [pending, setPending] = useState(Boolean(!readyUrl && generatePrompt));

  useEffect(() => {
    if (readyUrl) {
      setSrc(readyUrl);
      setPending(false);
      return;
    }
    if (!generatePrompt) {
      setSrc("");
      setPending(false);
      return;
    }
    const cacheKey = `${usageHint}:${generatePrompt}`;
    const cached = generatedCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setPending(false);
      return;
    }
    const abort = new AbortController();
    setPending(true);
    setSrc("");
    void fetch("/v1/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({ prompt: generatePrompt, usageHint }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { url?: string; error?: { message?: string } };
        if (!response.ok || !payload.url) {
          throw new Error(payload.error?.message || `HTTP ${response.status}`);
        }
        generatedCache.set(cacheKey, payload.url);
        if (!abort.signal.aborted) {
          setSrc(payload.url);
        }
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) {
          return;
        }
        setSrc("");
        console.warn("Image generate failed", error);
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setPending(false);
        }
      });
    return () => abort.abort();
  }, [generatePrompt, readyUrl, usageHint]);

  const box = {
    display: "block",
    objectFit: fit as CSSProperties["objectFit"],
    ...(imageSize[usageHint] ?? imageSize.mediumFeature),
  };

  if (!src) {
    return (
      <div
        {...host.attrs}
        data-fit={fit}
        data-usage-hint={usageHint}
        data-generating={pending ? "true" : undefined}
        className={host.className}
        onAnimationEnd={host.onAnimationEnd}
        style={{
          ...box,
          background: "#f5f5f7",
          borderRadius: usageHint === "avatar" ? "50%" : 12,
        }}
      />
    );
  }

  return (
    <img
      {...host.attrs}
      data-fit={fit}
      data-usage-hint={usageHint}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      src={src}
      alt={generatePrompt || ""}
      style={box}
    />
  );
}

export function Icon({
  name = "",
  componentId,
  hasMounted,
}: HostProps & { name?: string }) {
  const host = useHost("Icon", componentId, hasMounted);
  return (
    <span
      {...host.attrs}
      data-icon={name}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      aria-label={name}
      style={{ display: "inline-flex", fontSize: 20, lineHeight: 1 }}
    >
      {iconGlyph(name)}
    </span>
  );
}

export function Video({
  url = "",
  componentId,
  hasMounted,
}: HostProps & { url?: string }) {
  const host = useHost("Video", componentId, hasMounted);
  return (
    <video
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      src={url || undefined}
      controls
      style={{
        display: "block",
        width: "100%",
        maxWidth: 360,
        height: 160,
        borderRadius: 8,
        background: "#0f172a",
      }}
    />
  );
}

export function AudioPlayer({
  url = "",
  description,
  componentId,
  hasMounted,
}: HostProps & { url?: string; description?: string }) {
  const host = useHost("AudioPlayer", componentId, hasMounted);
  return (
    <div
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", maxWidth: 360 }}
    >
      {description ? <span style={{ fontSize: 13, color: "#475569" }}>{description}</span> : null}
      <audio src={url || undefined} controls style={{ width: "100%" }} />
    </div>
  );
}
