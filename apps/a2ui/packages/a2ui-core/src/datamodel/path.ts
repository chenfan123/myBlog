/** 把协议 path 拆成段：`/user/name` 与 `user/name` 等价。 */
export function splitPath(path: string | undefined): string[] {
  if (!path || path === "/") {
    return [];
  }
  return path.split("/").filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getValue(dataModel: Record<string, unknown>, path: string | undefined): unknown {
  const keys = splitPath(path);
  if (keys.length === 0) {
    return dataModel;
  }

  let cursor: unknown = dataModel;
  for (const key of keys) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** 沿 path 写入普通 JSON 值，中间缺失的对象会补上。不改入参。 */
export function setValue(
  dataModel: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = splitPath(path);
  if (keys.length === 0) {
    return isPlainObject(value) ? { ...value } : dataModel;
  }

  const next: Record<string, unknown> = { ...dataModel };
  let cursor: Record<string, unknown> = next;

  for (const key of keys.slice(0, -1)) {
    const nested = cursor[key];
    const nestedObject = isPlainObject(nested) ? { ...nested } : {};
    cursor[key] = nestedObject;
    cursor = nestedObject;
  }

  const lastKey = keys.at(-1);
  if (lastKey) {
    cursor[lastKey] = value;
  }
  return next;
}

export function hasValue(dataModel: Record<string, unknown>, path: string): boolean {
  return getValue(dataModel, path) !== undefined;
}

/** 把 path 段拼成协议 path，空段会丢掉。 */
export function joinPath(...parts: Array<string | number | undefined>): string {
  const keys = parts.flatMap((part) => splitPath(part === undefined ? undefined : String(part)));
  return keys.length === 0 ? "/" : `/${keys.join("/")}`;
}

/**
 * 列表项：JSON 数组直接用；对象则按数字 key 排序后当成数组（dataModelUpdate 的 valueMap 列表）。
 */
export function readListItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isPlainObject(value)) {
    return [];
  }

  const keys = Object.keys(value);
  const numeric = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
  if (numeric) {
    return keys
      .map((key) => Number(key))
      .sort((left, right) => left - right)
      .map((key) => value[String(key)]);
  }
  return Object.values(value);
}

/**
 * 解析绑定 path。
 * 以 `/` 开头相对整棵 dataModel；`.` 为当前 scope；其它相对当前列表项。
 */
export function resolvePath(
  path: string | undefined,
  dataModel: Record<string, unknown>,
  scope?: unknown,
): unknown {
  if (path === "." || path === "") {
    return scope !== undefined ? scope : dataModel;
  }
  if (!path) {
    return getValue(dataModel, path);
  }
  if (path.startsWith("/")) {
    return getValue(dataModel, path);
  }
  if (scope !== undefined) {
    if (isPlainObject(scope) || Array.isArray(scope)) {
      return getValue(scope as Record<string, unknown>, path);
    }
    return undefined;
  }
  return getValue(dataModel, path);
}

/** 把相对 path 写成绝对 path，给表单 updateModel 用。 */
export function qualifyPath(path: string | undefined, pathPrefix?: string): string | undefined {
  if (!path) {
    return path;
  }
  if (path.startsWith("/")) {
    return path;
  }
  if (!pathPrefix) {
    return path;
  }
  if (path === ".") {
    return pathPrefix;
  }
  return joinPath(pathPrefix, path);
}
