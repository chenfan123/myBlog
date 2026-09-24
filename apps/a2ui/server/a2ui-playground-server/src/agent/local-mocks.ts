import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { A2UIMessage } from "../a2ui-server/protocol";

const MOCK_DIR = join(__dirname, "../../../../packages/a2ui-core/src/mock");

export const LOCAL_MOCK_FILES = {
  "simple-text": "simple-text.json",
  "column-text": "column-text.json",
  "nested-column": "nested-column.json",
  "standard-catalog": "standard-catalog.json",
  "login-form": "login-form.json",
  "local-update-text": "local-update-text.json",
  "open-link": "open-link.json",
  "list-template": "list-template.json",
  "cart-list": "cart-list.json",
  "media-player": "media-player.json",
  "form-controls": "form-controls.json",
  "tabs-modal": "tabs-modal.json",
  "empty-state": "empty-state.json",
} as const;

export type LocalMockId = keyof typeof LOCAL_MOCK_FILES;

export function isLocalMockId(value: string): value is LocalMockId {
  return value in LOCAL_MOCK_FILES;
}

/** 读取 a2ui-core 里的本地 mock：支持消息数组或 `{ messages }` 对象。 */
export function loadLocalMock(id: string): A2UIMessage[] | undefined {
  if (!isLocalMockId(id)) {
    return undefined;
  }
  const raw = JSON.parse(readFileSync(join(MOCK_DIR, LOCAL_MOCK_FILES[id]), "utf8")) as unknown;
  if (Array.isArray(raw)) {
    return raw as A2UIMessage[];
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { messages?: unknown }).messages)) {
    return (raw as { messages: A2UIMessage[] }).messages;
  }
  return undefined;
}
