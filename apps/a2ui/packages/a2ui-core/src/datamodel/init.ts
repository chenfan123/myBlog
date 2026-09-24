import { getValue, setValue } from "./path.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLiteral(record: Record<string, unknown>): unknown {
  if (typeof record.literalString === "string") {
    return record.literalString;
  }
  if (typeof record.literalNumber === "number") {
    return record.literalNumber;
  }
  if (typeof record.literalBoolean === "boolean") {
    return record.literalBoolean;
  }
  if (Array.isArray(record.literalArray)) {
    return record.literalArray;
  }
  return undefined;
}

/**
 * path + literal 同时出现：把 literal 写入 dataModel（不覆盖已有值），之后渲染以 path 为准。
 */
export function applyBoundInitializers(
  dataModel: Record<string, unknown>,
  component: unknown,
): Record<string, unknown> {
  let next = dataModel;
  visit(component, (path, literal) => {
    if (getValue(next, path) !== undefined) {
      return;
    }
    next = setValue(next, path, literal);
  });
  return next;
}

function visit(value: unknown, write: (path: string, literal: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, write);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }

  const path = typeof value.path === "string" ? value.path : undefined;
  const literal = readLiteral(value);
  if (path && literal !== undefined) {
    write(path, literal);
  }

  for (const nested of Object.values(value)) {
    visit(nested, write);
  }
}
