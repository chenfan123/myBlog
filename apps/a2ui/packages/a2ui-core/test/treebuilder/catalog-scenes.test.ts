/**
 * 新增 catalog 场景 mock：媒体、表单控件、Tabs/Modal、Empty。
 */
import assert from "node:assert/strict";
import {
  emptyStateMock,
  formControlsMock,
  mediaPlayerMock,
  tabsModalMock,
} from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import { STANDARD_CATALOG_TYPES } from "../../src/vnode/index.js";

const renderMap = Object.fromEntries(
  [...STANDARD_CATALOG_TYPES, "Empty"].map((type) => [
    type,
    (props: Record<string, unknown>) => ({ kind: type, ...props }),
  ]),
);

function store() {
  return getA2UIStore().getState();
}

function nodeKind(id: string): string | undefined {
  const vnode = store().getHydrateNode(id)?.v_node as { kind?: string } | undefined;
  return vnode?.kind;
}

describe("catalog scene mocks", () => {
  beforeEach(() => {
    initStore({ renderMap });
  });

  it("parses the media-player mock (Image / Icon / AudioPlayer / Video / Slider / Divider)", () => {
    parse(messagesToJsonl(mediaPlayerMock));
    assert.equal(Object.values(store().errorMap).length, 0);
    assert.equal(store().getSurface("media-player")?.root, "root");
    assert.equal(nodeKind("cover"), "Image");
    assert.equal(nodeKind("fav-icon"), "Icon");
    assert.equal(nodeKind("player"), "AudioPlayer");
    assert.equal(nodeKind("clip"), "Video");
    assert.equal(nodeKind("volume"), "Slider");
    assert.equal(store().getSurface("media-player")?.dataModel.track, "Moon Speech");
  });

  it("parses the form-controls mock (DateTimeInput / MultipleChoice / CheckBox / TextField)", () => {
    parse(messagesToJsonl(formControlsMock));
    assert.equal(Object.values(store().errorMap).length, 0);
    assert.equal(nodeKind("when"), "DateTimeInput");
    assert.equal(nodeKind("transport"), "MultipleChoice");
    assert.equal(nodeKind("agree"), "CheckBox");
    assert.equal(nodeKind("notes"), "TextField");
    assert.equal(store().getSurface("form-controls")?.dataModel.notify, true);
  });

  it("parses the tabs-modal mock and links Tab / Modal child ids", () => {
    parse(messagesToJsonl(tabsModalMock));
    assert.equal(Object.values(store().errorMap).length, 0);
    assert.deepEqual(store().getHydrateNode("tabs")?.childIds, ["tab-overview", "tab-details"]);
    assert.deepEqual(store().getHydrateNode("dialog")?.childIds, ["dialog-open", "dialog-body"]);
    assert.equal(nodeKind("tabs"), "Tabs");
    assert.equal(nodeKind("dialog"), "Modal");
  });

  it("parses the empty-state mock", () => {
    parse(messagesToJsonl(emptyStateMock));
    assert.equal(Object.values(store().errorMap).length, 0);
    assert.equal(nodeKind("inbox"), "Empty");
    assert.equal(store().getSurface("empty-state")?.dataModel.reason, "No messages yet");
  });
});
