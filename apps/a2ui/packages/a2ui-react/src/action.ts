import {
  dispatchUserAction,
  getA2UIStore,
  getValue,
  updateModel,
  type DispatchUserActionInput,
} from "a2ui-core";

const LOCAL_UPDATE_PATH = "__localUpdatePath";
const LOCAL_UPDATE_STRING = "__localUpdateString";
const LOCAL_UPDATE_NUMBER = "__localUpdateNumber";
const LOCAL_UPDATE_BOOLEAN = "__localUpdateBoolean";
const OPEN_LINK_URL = "__openLinkUrl";
const OPEN_LINK_TARGET = "__openLinkTarget";
const OPEN_LINK_NAMES = new Set(["openLink", "open_link"]);

/**
 * a2ui-react 的 action 入口。
 *
 * v0.8 没有客户端改模型 / 开外链的消息。本地行为在这里处理：
 * `__localUpdate*` → SDK `updateModel`；`openLink` / `__openLinkUrl` → `window.open`。
 * 然后再发出标准 userAction。
 */
export function triggerAction(input: DispatchUserActionInput): void {
  simulateLocalUpdateModel(input.surfaceId, input.context);
  openExternalLink(input.surfaceId, input.name, input.context);
  dispatchUserAction(input);
}

function simulateLocalUpdateModel(
  surfaceId: string,
  context: DispatchUserActionInput["context"],
): void {
  const { path, value } = readReservedUpdate(context);
  if (!path || value === undefined) {
    return;
  }
  updateModel(surfaceId, path, value);
}

function openExternalLink(
  surfaceId: string,
  name: string,
  context: DispatchUserActionInput["context"],
): void {
  const resolved = resolveContextMap(surfaceId, context);
  const url =
    asString(resolved[OPEN_LINK_URL]) ??
    (OPEN_LINK_NAMES.has(name) ? asString(resolved.url) ?? asString(resolved.href) : undefined);
  if (!url || !isSafeHttpUrl(url)) {
    return;
  }

  const target =
    asString(resolved[OPEN_LINK_TARGET]) ??
    (OPEN_LINK_NAMES.has(name) ? asString(resolved.target) : undefined) ??
    "_blank";
  const opener = (globalThis as { open?: (url: string, target?: string, features?: string) => unknown }).open;
  if (typeof opener !== "function") {
    return;
  }
  opener.call(globalThis, url, target, "noopener,noreferrer");
}

function resolveContextMap(
  surfaceId: string,
  context: DispatchUserActionInput["context"],
): Record<string, unknown> {
  const dataModel = getA2UIStore().getState().getSurface(surfaceId)?.dataModel ?? {};
  if (!context) {
    return {};
  }

  if (Array.isArray(context)) {
    const resolved: Record<string, unknown> = {};
    for (const entry of context) {
      if (!entry?.key) {
        continue;
      }
      const value = resolveEntryValue(entry.value, dataModel);
      if (value !== undefined) {
        resolved[entry.key] = value;
      }
    }
    return resolved;
  }

  if (typeof context === "object") {
    return { ...context };
  }

  return {};
}

function resolveEntryValue(value: unknown, dataModel: Record<string, unknown>): unknown {
  if (value == null || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string") {
    const fromModel = getValue(dataModel, record.path);
    if (fromModel !== undefined) {
      return fromModel;
    }
  }
  return readLiteral(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readReservedUpdate(
  context: DispatchUserActionInput["context"],
): { path?: string; value?: unknown } {
  if (!context) {
    return {};
  }

  if (Array.isArray(context)) {
    let path: string | undefined;
    let value: unknown;
    for (const entry of context) {
      if (!entry?.key) {
        continue;
      }
      const literal = readLiteral(entry.value);
      if (entry.key === LOCAL_UPDATE_PATH && typeof literal === "string") {
        path = literal;
      }
      if (entry.key === LOCAL_UPDATE_STRING && literal !== undefined) {
        value = literal;
      }
      if (entry.key === LOCAL_UPDATE_NUMBER && literal !== undefined) {
        value = literal;
      }
      if (entry.key === LOCAL_UPDATE_BOOLEAN && literal !== undefined) {
        value = literal;
      }
    }
    return { path, value };
  }

  if (typeof context !== "object") {
    return {};
  }

  const record = context as Record<string, unknown>;
  const path = typeof record[LOCAL_UPDATE_PATH] === "string" ? record[LOCAL_UPDATE_PATH] : undefined;
  const value =
    record[LOCAL_UPDATE_STRING] ?? record[LOCAL_UPDATE_NUMBER] ?? record[LOCAL_UPDATE_BOOLEAN];
  return { path, value };
}

function readLiteral(value: unknown): unknown {
  if (value == null || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.literalString === "string") {
    return record.literalString;
  }
  if (typeof record.literalNumber === "number") {
    return record.literalNumber;
  }
  if (typeof record.literalBoolean === "boolean") {
    return record.literalBoolean;
  }
  return undefined;
}
