/**
 * 最小本地更新：按钮 action.context 带 __localUpdate*，
 * trigger / dispatchUserAction 用 updateModel 改 /message，Text 跟着刷新。
 */
import assert from "node:assert/strict";
import { dispatchUserAction } from "../../src/datamodel/index.js";
import { localUpdateTextMock } from "../../src/mock/index.js";
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

describe("local update text mock", () => {
  beforeEach(() => {
    initStore({ renderMap });
  });

  it("updates the bound message after the button action", () => {
    parse(messagesToJsonl(localUpdateTextMock));

    const before = store().getHydrateNode("message")?.v_node as { text?: string };
    assert.equal(before.text, "点按钮更新这行文案");
    assert.equal(store().getSurface("local-update")?.dataModel.message, "点按钮更新这行文案");

    const button = store().getHydrateNode("update-btn")?.v_node as {
      action?: {
        name?: string;
        context?: Array<{ key: string; value?: { literalString?: string } }>;
      };
    };
    assert.equal(button.action?.name, "updateMessage");

    dispatchUserAction({
      name: button.action?.name ?? "",
      surfaceId: "local-update",
      sourceComponentId: "update-btn",
      context: button.action?.context,
    });

    assert.equal(store().getSurface("local-update")?.dataModel.message, "你好，文案已更新");
    const after = store().getHydrateNode("message")?.v_node as { text?: string };
    assert.equal(after.text, "你好，文案已更新");
  });
});
