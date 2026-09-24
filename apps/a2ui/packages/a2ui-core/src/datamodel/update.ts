import type { DataModelEntry, DataModelValueMapEntry } from "../parser/types.js";
import { splitPath } from "./path.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取协议里的 typed value：string / number / boolean / nested valueMap。 */
export function readDataModelValue(entry: DataModelEntry | DataModelValueMapEntry): unknown {
  if (entry.valueString !== undefined) {
    return entry.valueString;
  }
  if (entry.valueNumber !== undefined) {
    return entry.valueNumber;
  }
  if (entry.valueBoolean !== undefined) {
    return entry.valueBoolean;
  }
  if ("valueMap" in entry && entry.valueMap) {
    const nested: Record<string, unknown> = {};
    for (const mapEntry of entry.valueMap) {
      nested[mapEntry.key] = readDataModelValue(mapEntry);
    }
    return nested;
  }
  return undefined;
}

/** 将 adjacency list（key + 一个 value*）转成普通对象。 */
export function entriesToObject(entries: DataModelEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    result[entry.key] = readDataModelValue(entry);
  }
  return result;
}

/**
 * 把 contents 写进 dataModel。
 * path 省略或 "/" 时整棵替换；否则按 /a/b 路径挂到对应节点。
 */
export function applyDataModelUpdate(
  current: Record<string, unknown>,
  path: string | undefined,
  contents: DataModelEntry[],
): Record<string, unknown> {
  const patch = entriesToObject(contents);
  const keys = splitPath(path);
  if (keys.length === 0) {
    return patch;
  }

  const next: Record<string, unknown> = { ...current };
  let cursor: Record<string, unknown> = next;

  for (const key of keys.slice(0, -1)) {
    const nested = cursor[key];
    const nestedObject = isPlainObject(nested) ? { ...nested } : {};
    cursor[key] = nestedObject;
    cursor = nestedObject;
  }

  const lastKey = keys.at(-1);
  if (lastKey) {
    cursor[lastKey] = patch;
  }

  return next;
}
