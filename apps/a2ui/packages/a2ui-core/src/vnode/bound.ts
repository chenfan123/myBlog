/** 协议里的绑定：字面量或指向 dataModel 的 path。 */

export interface BoundString {
  literalString?: string;
  path?: string;
}

export interface BoundBoolean {
  literalBoolean?: boolean;
  path?: string;
}

export interface BoundNumber {
  literalNumber?: number;
  path?: string;
}

export interface BoundStringArray {
  literalArray?: string[];
  path?: string;
}

export interface ResolvedBound<T> {
  value?: T;
  path?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function readBoundString(value: unknown): ResolvedBound<string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    value: typeof record.literalString === "string" ? record.literalString : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
  };
}

export function readBoundBoolean(value: unknown): ResolvedBound<boolean> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    value: typeof record.literalBoolean === "boolean" ? record.literalBoolean : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
  };
}

export function readBoundNumber(value: unknown): ResolvedBound<number> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    value: typeof record.literalNumber === "number" ? record.literalNumber : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
  };
}

export function readBoundStringArray(value: unknown): ResolvedBound<string[]> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return {
    value: Array.isArray(record.literalArray)
      ? record.literalArray.filter((item): item is string => typeof item === "string")
      : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
  };
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}
