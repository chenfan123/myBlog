import type { SurfaceStyles, SurfaceTheme } from "./types.js";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_MAX = 160;
const FONT_BLOCK = /url\s*\(|expression\s*\(|@import|<\/|javascript:/i;

export const STYLE_PRESETS: Record<SurfaceTheme, Required<Omit<SurfaceStyles, "theme" | "formFactor">>> = {
  apple: {
    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif',
    primaryColor: "#1d1d1f",
    background: "#f5f5f7",
    surfaceColor: "#ffffff",
    textColor: "#1d1d1f",
    mutedTextColor: "#86868b",
    radius: 18,
  },
  minimal: {
    font: "ui-sans-serif, system-ui, sans-serif",
    primaryColor: "#0f172a",
    background: "#f8fafc",
    surfaceColor: "#ffffff",
    textColor: "#0f172a",
    mutedTextColor: "#64748b",
    radius: 8,
  },
};

/** 从 beginRendering.styles 抽出合法 token；非法值丢弃，全部非法则 undefined。 */
export function parseSurfaceStyles(raw: unknown): SurfaceStyles | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const styles: SurfaceStyles = {};

  if (input.theme === "apple" || input.theme === "minimal") {
    styles.theme = input.theme;
  }
  const font = readFont(input.font);
  if (font) {
    styles.font = font;
  }
  const primaryColor = readHex(input.primaryColor);
  if (primaryColor) {
    styles.primaryColor = primaryColor;
  }
  const background = readHex(input.background);
  if (background) {
    styles.background = background;
  }
  const surfaceColor = readHex(input.surfaceColor);
  if (surfaceColor) {
    styles.surfaceColor = surfaceColor;
  }
  const textColor = readHex(input.textColor);
  if (textColor) {
    styles.textColor = textColor;
  }
  const mutedTextColor = readHex(input.mutedTextColor);
  if (mutedTextColor) {
    styles.mutedTextColor = mutedTextColor;
  }
  const radius = readRadius(input.radius);
  if (radius !== undefined) {
    styles.radius = radius;
  }
  if (input.formFactor === "mobile" || input.formFactor === "desktop") {
    styles.formFactor = input.formFactor;
  }

  return Object.keys(styles).length > 0 ? styles : undefined;
}

/**
 * 协议 token → CSS 自定义属性。只输出有值的变量，缺的由页面 theme.css 兜底。
 * theme 预设先展开，再被显式字段覆盖。
 */
export function stylesToCssVars(styles?: SurfaceStyles): Record<string, string> {
  if (!styles) {
    return {};
  }
  const preset = styles.theme ? STYLE_PRESETS[styles.theme] : undefined;
  const merged: SurfaceStyles = { ...preset, ...styles };
  const vars: Record<string, string> = {};

  if (merged.font) {
    vars["--a2ui-font"] = merged.font;
  }
  if (merged.primaryColor) {
    vars["--a2ui-primary"] = merged.primaryColor;
    vars["--a2ui-on-primary"] = onColor(merged.primaryColor);
  }
  if (merged.background) {
    vars["--a2ui-bg"] = merged.background;
    vars["--a2ui-fill"] = merged.background;
  }
  if (merged.surfaceColor) {
    vars["--a2ui-surface"] = merged.surfaceColor;
  }
  if (merged.textColor) {
    vars["--a2ui-text"] = merged.textColor;
  }
  if (merged.mutedTextColor) {
    vars["--a2ui-muted"] = merged.mutedTextColor;
  }
  if (typeof merged.radius === "number") {
    vars["--a2ui-radius"] = `${merged.radius}px`;
  }
  if (merged.formFactor === "mobile" || merged.formFactor === "desktop") {
    vars["--a2ui-form-factor"] = merged.formFactor;
  }

  return vars;
}

function readHex(value: unknown): string | undefined {
  if (typeof value !== "string" || !HEX.test(value)) {
    return undefined;
  }
  return value.length === 4 ? expandHex(value) : value;
}

function expandHex(value: string): string {
  const [, r, g, b] = value;
  return `#${r}${r}${g}${g}${b}${b}`;
}

function readFont(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const font = value.trim();
  if (!font || font.length > FONT_MAX || FONT_BLOCK.test(font)) {
    return undefined;
  }
  return font;
}

function readRadius(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const radius = Math.round(value);
  if (radius < 0 || radius > 32) {
    return undefined;
  }
  return radius;
}

function onColor(hex: string): string {
  const raw = hex.slice(1);
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 160 ? "#1d1d1f" : "#ffffff";
}
