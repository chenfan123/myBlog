/**
 * openLink：action 名为 openLink，__openLinkUrl 从 dataModel 取 http(s) 地址。
 * 发出的 userAction 去掉保留键，保留 url。
 */
import assert from "node:assert/strict";
import { dispatchUserAction } from "../../src/datamodel/index.js";
import { openLinkMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";

function store() {
  return getA2UIStore().getState();
}

const renderMap = {
  Text: (props: Record<string, unknown>) => ({ kind: "text", ...props }),
  Column: (props: Record<string, unknown>) => ({ kind: "column", ...props }),
  Button: (props: Record<string, unknown>) => ({ kind: "button", ...props }),
};

describe("open link mock", () => {
  it("maps openLink and strips reserved keys from the emitted userAction", () => {
    const actions: unknown[] = [];
    initStore({
      renderMap,
      onUserAction: (payload) => {
        actions.push(payload);
      },
    });
    parse(messagesToJsonl(openLinkMock));

    const button = store().getHydrateNode("open-btn")?.v_node as {
      action?: {
        name?: string;
        context?: Array<{ key: string; value?: { path?: string; literalString?: string } }>;
      };
    };
    assert.equal(button.action?.name, "openLink");
    assert.equal(button.action?.context?.find((entry) => entry.key === "__openLinkUrl")?.value?.path, "/url");

    dispatchUserAction({
      name: button.action?.name ?? "",
      surfaceId: "open-link",
      sourceComponentId: "open-btn",
      context: button.action?.context,
    });

    const payload = actions[0] as { name: string; context: Record<string, unknown> };
    assert.equal(payload.name, "openLink");
    assert.deepEqual(payload.context, { url: "https://github.com/google/A2UI" });
    assert.equal("__openLinkUrl" in payload.context, false);
    assert.equal("__openLinkTarget" in payload.context, false);
  });
});
