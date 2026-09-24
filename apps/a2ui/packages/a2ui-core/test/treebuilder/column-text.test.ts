/**
 * treebuilder 测试覆盖：
 *
 * 1. 未 beginRendering 时没有组件树
 * 2. 单 Text mock：树就是 root 的 v_node（没有 children，不组装）
 * 3. parse() 的返回值与 buildTree() 相同
 * 4. Column + 3 个 Text：
 *    - root.childIds 指向三个叶子
 *    - 叶子 parentId 指向 root
 *    - 组装后的树是 Column render 结果，children 为三个 Text（含 componentId）
 */
import assert from "node:assert/strict";
import { columnTextMock, simpleTextMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import { buildTree } from "../../src/treebuilder/index.js";

function store() {
  return getA2UIStore().getState();
}

const textRenderMap = {
  Text: (props: Record<string, unknown>) => ({ kind: "tree", ...props }),
};

const columnRenderMap = {
  ...textRenderMap,
  Column: (props: Record<string, unknown>) => ({ kind: "column", ...props }),
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

describe("buildTree", () => {
  describe("single Text", () => {
    beforeEach(() => {
      initStore({ renderMap: textRenderMap });
    });

    it("returns null when the surface is not ready to render", () => {
      parse(
        JSON.stringify({
          surfaceUpdate: {
            surfaceId: "simple-text",
            components: [
              {
                id: "text",
                component: {
                  Text: {
                    text: { literalString: "Hello, A2UI" },
                    usageHint: "h1",
                  },
                },
              },
            ],
          },
        }),
      );

      assert.equal(buildTree(), null);
      assert.equal(store().getSurface("simple-text")?.beginRender, false);
    });

    it("returns the root v_node for a single-component mock", () => {
      parse(messagesToJsonl(simpleTextMock));

      assert.deepEqual(
        buildTree(),
        stampSurfaceId(
          {
            kind: "tree",
            text: "Hello, A2UI",
            usageHint: "h1",
            componentId: "text",
            hasMounted: false,
          },
          "simple-text",
        ),
      );
    });

    it("is returned from parse after the JSONL is applied", () => {
      const tree = parse(messagesToJsonl(simpleTextMock));

      assert.equal(tree, store().getHydrateNode("text")?.v_node);
      assert.deepEqual(tree, buildTree());
    });
  });

  describe("Column with three Text children", () => {
    beforeEach(() => {
      initStore({ renderMap: columnRenderMap });
    });

    it("links parent and child ids on hydrate nodes", () => {
      parse(messagesToJsonl(columnTextMock));

      const root = store().getHydrateNode("root");
      assert.ok(root);
      assert.equal(root.parentId, undefined);
      assert.deepEqual(root.childIds, ["title", "subtitle", "body"]);
      assert.equal(store().getHydrateNode("title")?.parentId, "root");
      assert.equal(store().getHydrateNode("subtitle")?.parentId, "root");
      assert.equal(store().getHydrateNode("body")?.parentId, "root");
      assert.deepEqual(store().getHydrateNode("title")?.childIds, []);
    });

    it("assembles Column with the three Text v_nodes as children", () => {
      const tree = parse(messagesToJsonl(columnTextMock));

      assert.deepEqual(
        tree,
        stampSurfaceId(
          {
            kind: "column",
            distribution: "start",
            alignment: "start",
            componentId: "root",
            hasMounted: false,
            children: [
              { kind: "tree", text: "Hello, A2UI", usageHint: "h1", componentId: "title", hasMounted: false },
              { kind: "tree", text: "Column layout", usageHint: "h2", componentId: "subtitle", hasMounted: false },
              { kind: "tree", text: "Three text children in a column.", usageHint: "body", componentId: "body", hasMounted: false },
            ],
          },
          "column-text",
        ),
      );
      assert.deepEqual(tree, buildTree());
    });
  });
});
