import type { ResolvedBound } from "../vnode/bound.js";
import { qualifyPath, resolvePath } from "./path.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BindingScope {
  /** 当前列表项（相对 path 从这里取）。 */
  scope?: unknown;
  /** 当前项的绝对前缀，例如 `/tracks/0`。 */
  pathPrefix?: string;
}

/** 有 path 时从 dataModel / 列表项取值；没有该键则回退 literal。 */
export function resolveBound<T>(
  bound: ResolvedBound<T>,
  dataModel: Record<string, unknown>,
  binding?: BindingScope,
): T | undefined {
  if (bound.path) {
    const resolved = resolvePath(bound.path, dataModel, binding?.scope);
    if (resolved !== undefined) {
      return resolved as T;
    }
  }
  return bound.value;
}

/**
 * 把 render props 里的 `fooPath` 解析成 `foo`。
 * 只处理纯 JSON 描述，不要传入 React children。
 * 在 template 实例里会把相对 path 改写成绝对 path，方便表单写回和 action.context。
 */
export function resolveRenderProps(
  props: Record<string, unknown>,
  dataModel: Record<string, unknown>,
  binding?: BindingScope,
): Record<string, unknown> {
  return resolveNode(props, dataModel, binding) as Record<string, unknown>;
}

function resolveNode(value: unknown, dataModel: Record<string, unknown>, binding?: BindingScope): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveNode(item, dataModel, binding));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    next[key] = resolveNode(nested, dataModel, binding);
  }

  for (const [key, nested] of Object.entries(next)) {
    if (!key.endsWith("Path") || typeof nested !== "string" || nested.length === 0) {
      continue;
    }
    const target = key.slice(0, -4);
    if (!target) {
      continue;
    }
    const resolved = resolvePath(nested, dataModel, binding?.scope);
    if (resolved !== undefined) {
      next[target] = resolved;
    }
    const absolute = qualifyPath(nested, binding?.pathPrefix);
    if (absolute) {
      next[key] = absolute;
    }
  }

  if (typeof next.path === "string" && next.path.length > 0) {
    const absolute = qualifyPath(next.path, binding?.pathPrefix);
    if (absolute) {
      next.path = absolute;
    }
  }

  return next;
}
