/**
 * treebuilder 多级嵌套（Row / Column 混排）。
 * mock 源是 `{ messages }`：beginRendering 之后一条 surfaceUpdate 带齐全部组件；
 * 流式协议再由 toProtocolJsonl 拆成「一条 JSONL = 一个组件」。
 *
 * root Column
 *   ├─ page-title Text
 *   ├─ header Row
 *   │    ├─ intro-title Text
 *   │    └─ intro-tag Text
 *   └─ body Row
 *        ├─ intro Column
 *        │    └─ intro-body Text
 *        └─ details Column
 *             ├─ details-title Text
 *             ├─ item Row
 *             │    ├─ item-name Text
 *             │    └─ item-desc Text
 *             └─ details-footer Text
 */
import assert from "node:assert/strict";
import { toProtocolJsonl } from "../../src/buffer/index.js";
import { nestedColumnMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import { buildTree } from "../../src/treebuilder/index.js";

function store() {
  return getA2UIStore().getState();
}

const layoutRenderMap = {
  Text: (props: Record<string, unknown>) => ({ kind: "tree", ...props }),
  Column: (props: Record<string, unknown>) => ({ kind: "column", ...props }),
  Row: (props: Record<string, unknown>) => ({ kind: "row", ...props }),
};

function stampSurfaceId(value: unknown, surfaceId: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stampSurfaceId(item, surfaceId));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...record };
    if ("componentId" in record) {
      next.surfaceId = surfaceId;
    }
    if ("children" in record) {
      next.children = stampSurfaceId(record.children, surfaceId);
    }
    return next;
  }
  return value;
}

describe("buildTree nested Row and Column", () => {
  beforeEach(() => {
    initStore({ renderMap: layoutRenderMap });
  });

  it("authoring mock packs all components into one surfaceUpdate", () => {
    const begin = nestedColumnMock[0] as { beginRendering?: unknown };
    assert.equal("beginRendering" in begin, true);
    assert.equal(nestedColumnMock.length, 2);

    const update = nestedColumnMock[1] as { surfaceUpdate: { components: unknown[] } };
    assert.equal("surfaceUpdate" in update, true);
    assert.equal(update.surfaceUpdate.components.length, 14);

    const lines = toProtocolJsonl(update);
    assert.equal(lines.length, 14);
    for (const line of lines) {
      const message = JSON.parse(line) as { surfaceUpdate: { components: unknown[] } };
      assert.equal("surfaceUpdate" in message, true);
      assert.equal(message.surfaceUpdate.components.length, 1);
    }
  });

  it("links parent and child ids across mixed Row and Column levels", () => {
    parse(messagesToJsonl(nestedColumnMock));

    assert.deepEqual(store().getHydrateNode("root")?.childIds, ["page-title", "header", "body"]);
    assert.equal(store().getHydrateNode("root")?.hasMounted, false);
    assert.equal(store().getHydrateNode("header")?.parentId, "root");
    assert.equal(store().getHydrateNode("body")?.parentId, "root");
    assert.deepEqual(store().getHydrateNode("header")?.childIds, ["intro-title", "intro-tag"]);
    assert.equal(store().getHydrateNode("intro-title")?.parentId, "header");
    assert.deepEqual(store().getHydrateNode("body")?.childIds, ["intro", "details"]);
    assert.equal(store().getHydrateNode("intro")?.parentId, "body");
    assert.deepEqual(store().getHydrateNode("intro")?.childIds, ["intro-body"]);
    assert.equal(store().getHydrateNode("details")?.parentId, "body");
    assert.deepEqual(store().getHydrateNode("details")?.childIds, [
      "details-title",
      "item",
      "details-footer",
    ]);
    assert.equal(store().getHydrateNode("item")?.parentId, "details");
    assert.deepEqual(store().getHydrateNode("item")?.childIds, ["item-name", "item-desc"]);
    assert.equal(store().getHydrateNode("item-name")?.parentId, "item");
    assert.equal(store().getHydrateNode("item-desc")?.parentId, "item");
  });

  it("assembles a mixed Row and Column tree", () => {
    const tree = parse(messagesToJsonl(nestedColumnMock));

    assert.deepEqual(tree, stampSurfaceId({
      kind: "column",
      distribution: "start",
      alignment: "stretch",
      componentId: "root",
      hasMounted: false,
      children: [
        {
          kind: "tree",
          text: "A2UI nested layout",
          usageHint: "h1",
          componentId: "page-title",
          hasMounted: false,
        },
        {
          kind: "row",
          distribution: "spaceBetween",
          alignment: "center",
          componentId: "header",
          hasMounted: false,
          children: [
            { kind: "tree", text: "Overview", usageHint: "h2", componentId: "intro-title", hasMounted: false },
            { kind: "tree", text: "Row + Column", usageHint: "caption", componentId: "intro-tag", hasMounted: false },
          ],
        },
        {
          kind: "row",
          distribution: "start",
          alignment: "stretch",
          componentId: "body",
          hasMounted: false,
          children: [
            {
              kind: "column",
              distribution: "start",
              alignment: "start",
              componentId: "intro",
              hasMounted: false,
              children: [
                {
                  kind: "tree",
                  text: "Left column inside a row.",
                  usageHint: "body",
                  componentId: "intro-body",
                  hasMounted: false,
                },
              ],
            },
            {
              kind: "column",
              distribution: "start",
              alignment: "start",
              componentId: "details",
              hasMounted: false,
              children: [
                { kind: "tree", text: "Details", usageHint: "h3", componentId: "details-title", hasMounted: false },
                {
                  kind: "row",
                  distribution: "start",
                  alignment: "center",
                  componentId: "item",
                  hasMounted: false,
                  children: [
                    { kind: "tree", text: "Nested item", usageHint: "h4", componentId: "item-name", hasMounted: false },
                    {
                      kind: "tree",
                      text: "This text sits in a row under details.",
                      usageHint: "body",
                      componentId: "item-desc",
                      hasMounted: false,
                    },
                  ],
                },
                {
                  kind: "tree",
                  text: "End of details",
                  usageHint: "caption",
                  componentId: "details-footer",
                  hasMounted: false,
                },
              ],
            },
          ],
        },
      ],
    },
      "nested-column",
    ));
    assert.deepEqual(tree, buildTree());
  });
});
