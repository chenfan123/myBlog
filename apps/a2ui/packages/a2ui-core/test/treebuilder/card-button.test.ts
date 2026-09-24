/**
 * Card / Button 是带单个 child id 的容器：parse 时不 render，treebuild 把子树放进 children。
 */
import assert from "node:assert/strict";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import { buildTree } from "../../src/treebuilder/index.js";

function store() {
  return getA2UIStore().getState();
}

const renderMap = {
  Text: (props: Record<string, unknown>) => ({ kind: "text", ...props }),
  Card: (props: Record<string, unknown>) => ({ kind: "card", ...props }),
  Button: (props: Record<string, unknown>) => ({ kind: "button", ...props }),
};

const cardButtonMock = [
  { beginRendering: { surfaceId: "card", root: "root" } },
  {
    surfaceUpdate: {
      surfaceId: "card",
      components: [
        { id: "root", component: { Card: { child: "action" } } },
        {
          id: "action",
          component: { Button: { child: "label", primary: true, action: { name: "go" } } },
        },
        {
          id: "label",
          component: { Text: { text: { literalString: "Go" }, usageHint: "body" } },
        },
      ],
    },
  },
];

describe("buildTree Card and Button", () => {
  beforeEach(() => {
    initStore({ renderMap });
  });

  it("defers Card and Button render until children are assembled", () => {
    parse(messagesToJsonl(cardButtonMock));

    assert.deepEqual(store().getHydrateNode("root")?.childIds, ["action"]);
    assert.deepEqual(store().getHydrateNode("action")?.childIds, ["label"]);
    assert.deepEqual(store().getHydrateNode("label")?.childIds, []);
    assert.equal(store().getHydrateNode("label")?.parentId, "action");
    assert.equal(store().getHydrateNode("action")?.parentId, "root");
  });

  it("nests Button inside Card with the Text label as Button children", () => {
    const tree = parse(messagesToJsonl(cardButtonMock));

    assert.deepEqual(tree, {
      kind: "card",
      componentId: "root",
      surfaceId: "card",
      hasMounted: false,
      children: [
        {
          kind: "button",
          primary: true,
          action: { name: "go" },
          componentId: "action",
          surfaceId: "card",
          hasMounted: false,
          children: [
            {
              kind: "text",
              text: "Go",
              usageHint: "body",
              componentId: "label",
              surfaceId: "card",
              hasMounted: false,
            },
          ],
        },
      ],
    });
    assert.deepEqual(tree, buildTree());
  });
});
