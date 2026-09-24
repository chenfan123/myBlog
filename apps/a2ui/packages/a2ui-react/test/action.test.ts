/**
 * a2ui-react triggerAction：openLink 只打开 http(s)，忽略 javascript:。
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { initStore } from "a2ui-core";
import { triggerAction } from "../src/action.js";

describe("triggerAction openLink", () => {
  const opens: Array<{ url: string; target?: string; features?: string }> = [];
  let previousOpen: typeof globalThis.open;

  beforeEach(() => {
    opens.length = 0;
    previousOpen = globalThis.open;
    globalThis.open = ((url: string, target?: string, features?: string) => {
      opens.push({ url, target, features });
      return null;
    }) as typeof globalThis.open;
    initStore({
      renderMap: {
        Text: (props: Record<string, unknown>) => props,
      },
    });
  });

  afterEach(() => {
    globalThis.open = previousOpen;
  });

  it("opens a bound https url in a new tab", () => {
    triggerAction({
      name: "openLink",
      surfaceId: "missing",
      sourceComponentId: "open-btn",
      context: [
        { key: "__openLinkUrl", value: { literalString: "https://github.com/google/A2UI" } },
        { key: "__openLinkTarget", value: { literalString: "_blank" } },
      ],
    });
    assert.deepEqual(opens, [
      {
        url: "https://github.com/google/A2UI",
        target: "_blank",
        features: "noopener,noreferrer",
      },
    ]);
  });

  it("ignores javascript urls", () => {
    triggerAction({
      name: "openLink",
      surfaceId: "missing",
      sourceComponentId: "open-btn",
      context: [{ key: "__openLinkUrl", value: { literalString: "javascript:alert(1)" } }],
    });
    assert.deepEqual(opens, []);
  });
});
