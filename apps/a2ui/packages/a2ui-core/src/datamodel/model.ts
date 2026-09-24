import { getA2UIStore } from "../store/index.js";
import { commitTree } from "../treebuilder/index.js";
import type { ActionContextValue } from "../vnode/types.js";
import { getValue, setValue } from "./path.js";
import type { UserActionPayload } from "./types.js";

export type { UserActionPayload } from "./types.js";

const LOCAL_UPDATE_PATH = "__localUpdatePath";
const LOCAL_UPDATE_STRING = "__localUpdateString";
const LOCAL_UPDATE_NUMBER = "__localUpdateNumber";
const LOCAL_UPDATE_BOOLEAN = "__localUpdateBoolean";
const OPEN_LINK_URL = "__openLinkUrl";
const OPEN_LINK_TARGET = "__openLinkTarget";
const LOCAL_UPDATE_KEYS = new Set([
  LOCAL_UPDATE_PATH,
  LOCAL_UPDATE_STRING,
  LOCAL_UPDATE_NUMBER,
  LOCAL_UPDATE_BOOLEAN,
  OPEN_LINK_URL,
  OPEN_LINK_TARGET,
]);

export const USER_ACTION_EVENT = "a2ui-user-action";
/** 兼容旧宿主监听名；新代码应使用 USER_ACTION_EVENT。 */
export const LEGACY_ACTION_EVENT = "a2ui-action";

export interface DispatchUserActionInput {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context?: Array<{ key: string; value?: ActionContextValue }> | Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContextEntryArray(value: unknown): value is Array<{ key: string; value?: ActionContextValue }> {
  return Array.isArray(value);
}

/** 把普通 JSON 写到 surface.dataModel 的 path，再 commitTree。这是 SDK API，不是 JSONL 消息。 */
export function updateModel(surfaceId: string, path: string, value: unknown): void {
  const store = getA2UIStore().getState();
  const surface = store.getSurface(surfaceId);
  if (!surface) {
    return;
  }

  store.updateSurface(surfaceId, {
    dataModel: setValue(surface.dataModel, path, value),
  });
  commitTree();
}

/**
 * 解析 Button 等组件的 action.context，处理 __localUpdate* 后回调 onUserAction。
 * 没有回调时再派 CustomEvent（浏览器环境）。
 */
export function dispatchUserAction(input: DispatchUserActionInput): void {
  if (!input.name || !input.surfaceId) {
    return;
  }

  applyLocalModelUpdate(input.surfaceId, input.context);

  const dataModel = getA2UIStore().getState().getSurface(input.surfaceId)?.dataModel ?? {};
  const context = stripLocalUpdateKeys(resolveActionContext(input.context, dataModel));
  const payload: UserActionPayload = {
    name: input.name,
    surfaceId: input.surfaceId,
    sourceComponentId: input.sourceComponentId,
    timestamp: new Date().toISOString(),
    context,
  };

  const onUserAction = getA2UIStore().getState().onUserAction;
  if (onUserAction) {
    onUserAction(payload);
    return;
  }

  dispatchBrowserEvent(payload);
}

function applyLocalModelUpdate(
  surfaceId: string,
  context: DispatchUserActionInput["context"],
): void {
  const dataModel = getA2UIStore().getState().getSurface(surfaceId)?.dataModel ?? {};
  const resolved = resolveActionContext(context, dataModel);
  const path = resolved[LOCAL_UPDATE_PATH];
  if (typeof path !== "string" || path.length === 0) {
    return;
  }

  const nextValue =
    resolved[LOCAL_UPDATE_STRING] ?? resolved[LOCAL_UPDATE_NUMBER] ?? resolved[LOCAL_UPDATE_BOOLEAN];
  if (nextValue === undefined) {
    return;
  }

  updateModel(surfaceId, path, nextValue);
}

function resolveActionContext(
  context: DispatchUserActionInput["context"],
  dataModel: Record<string, unknown>,
): Record<string, unknown> {
  if (!context) {
    return {};
  }

  if (isContextEntryArray(context)) {
    const resolved: Record<string, unknown> = {};
    for (const entry of context) {
      if (!entry?.key) {
        continue;
      }
      const value = resolveContextValue(entry.value, dataModel);
      if (value !== undefined) {
        resolved[entry.key] = value;
      }
    }
    return resolved;
  }

  if (!isPlainObject(context)) {
    return {};
  }

  const resolved: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(context)) {
    if (isPlainObject(nested) && isBoundValue(nested)) {
      const value = resolveContextValue(nested as ActionContextValue, dataModel);
      if (value !== undefined) {
        resolved[key] = value;
      }
      continue;
    }
    resolved[key] = nested;
  }
  return resolved;
}

function isBoundValue(value: Record<string, unknown>): boolean {
  return (
    "path" in value ||
    "literalString" in value ||
    "literalNumber" in value ||
    "literalBoolean" in value
  );
}

function resolveContextValue(value: ActionContextValue | undefined, dataModel: Record<string, unknown>): unknown {
  if (!value) {
    return undefined;
  }
  if (value.path) {
    const resolved = getValue(dataModel, value.path);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  if (value.literalString !== undefined) {
    return value.literalString;
  }
  if (value.literalNumber !== undefined) {
    return value.literalNumber;
  }
  if (value.literalBoolean !== undefined) {
    return value.literalBoolean;
  }
  return undefined;
}

function stripLocalUpdateKeys(context: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (LOCAL_UPDATE_KEYS.has(key)) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function dispatchBrowserEvent(payload: UserActionPayload): void {
  const globalObject = globalThis as {
    CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown;
    window?: { dispatchEvent: (event: unknown) => boolean };
  };
  if (!globalObject.window?.dispatchEvent || !globalObject.CustomEvent) {
    return;
  }

  globalObject.window.dispatchEvent(new globalObject.CustomEvent(USER_ACTION_EVENT, { detail: payload }));
  globalObject.window.dispatchEvent(new globalObject.CustomEvent(LEGACY_ACTION_EVENT, { detail: payload }));
}
