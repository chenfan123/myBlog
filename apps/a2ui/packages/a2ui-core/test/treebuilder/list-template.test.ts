/**
 * List children.template：按 dataModel 数组克隆模板组件，相对 path 绑定当前项。
 *
 * 1. 四项列表克隆出四个唯一 instanceId
 * 2. 相对 path title / artist / duration 从当前项取值
 * 3. 不把模板节点 v_node 写成某一项的画面
 * 4. dataModelUpdate 改变长度后重新组装并回收多余实例
 * 5. explicitList List 仍按静态 children 渲染
 */
import assert from "node:assert/strict";
import { readListItems } from "../../src/datamodel/index.js";
import { listTemplateMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import { buildTree } from "../../src/treebuilder/index.js";

function store() {
  return getA2UIStore().getState();
}

const renderMap = {
  Text: (props: Record<string, unknown>) => ({ kind: "text", ...props }),
  Column: (props: Record<string, unknown>) => ({ kind: "column", ...props }),
  Row: (props: Record<string, unknown>) => ({ kind: "row", ...props }),
  List: (props: Record<string, unknown>) => ({ kind: "list", ...props }),
  Card: (props: Record<string, unknown>) => ({ kind: "card", ...props }),
  Button: (props: Record<string, unknown>) => ({ kind: "button", ...props }),
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

function collectComponentIds(value: unknown, ids: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectComponentIds(item, ids);
    }
    return ids;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.componentId === "string") {
      ids.push(record.componentId);
    }
    if ("children" in record) {
      collectComponentIds(record.children, ids);
    }
  }
  return ids;
}

function cardId(index: number): string {
  return `tracks:${index}:track-card`;
}

function titleId(index: number): string {
  return `${cardId(index)}:track-row:track-info:track-title`;
}

function artistId(index: number): string {
  return `${cardId(index)}:track-row:track-info:track-meta:track-artist`;
}

function durationId(index: number): string {
  return `${cardId(index)}:track-row:track-info:track-meta:track-duration`;
}

function playBtnId(index: number): string {
  return `${cardId(index)}:track-row:play-btn`;
}

describe("List children.template", () => {
  beforeEach(() => {
    initStore({ renderMap });
  });

  it("clones the playlist template once per dataModel list item with relative bindings", () => {
    const tree = parse(messagesToJsonl(listTemplateMock));

    assert.deepEqual(store().getHydrateNode("tracks")?.childIds, [
      cardId(0),
      cardId(1),
      cardId(2),
      cardId(3),
    ]);
    assert.equal(store().getHydrateNode("track-card")?.parentId, undefined);
    assert.equal(store().getSurface("playlist")?.dataModel.playlistName, "Weekly Mix");

    const firstTitle = store().getHydrateNode(titleId(0))?.v_node as Record<string, unknown>;
    assert.equal(firstTitle.text, "Sunrise");
    assert.equal(firstTitle.textPath, "/tracks/0/title");
    const firstArtist = store().getHydrateNode(artistId(0))?.v_node as Record<string, unknown>;
    assert.equal(firstArtist.text, "Ada");
    const lastDuration = store().getHydrateNode(durationId(3))?.v_node as Record<string, unknown>;
    assert.equal(lastDuration.text, "3:56");
    assert.deepEqual(tree, buildTree());
  });

  it("registers a unique hydrate node for every cloned component", () => {
    const tree = parse(messagesToJsonl(listTemplateMock));
    const ids = collectComponentIds(tree);
    assert.deepEqual(ids, [...new Set(ids)]);

    for (const index of [0, 1, 2, 3]) {
      const card = store().getHydrateNode(cardId(index));
      const rowId = `${cardId(index)}:track-row`;
      const title = store().getHydrateNode(titleId(index));
      const play = store().getHydrateNode(playBtnId(index));
      assert.equal(card?.sourceComponentId, "track-card");
      assert.equal(card?.parentId, "tracks");
      assert.deepEqual(card?.childIds, [rowId]);
      assert.equal(title?.sourceComponentId, "track-title");
      assert.equal(play?.sourceComponentId, "play-btn");
      assert.equal(play?.parentId, rowId);
      const action = (play?.v_node as { action?: { context?: Array<{ key: string; value?: { path?: string } }> } }).action;
      assert.equal(action?.context?.find((entry) => entry.key === "title")?.value?.path, `/tracks/${index}/title`);
      assert.equal(action?.context?.find((entry) => entry.key === "artist")?.value?.path, `/tracks/${index}/artist`);
    }
  });

  it("does not overwrite the template hydrate node with a cloned item", () => {
    parse(messagesToJsonl(listTemplateMock));

    const template = store().getHydrateNode("track-card")?.v_node as Record<string, unknown> | undefined;
    assert.ok(template);
    assert.notEqual(template.componentId, cardId(3));
    assert.equal(template.type, "Card");
  });

  it("rebuilds when dataModelUpdate changes the list length", () => {
    parse(messagesToJsonl(listTemplateMock));

    parse(
      JSON.stringify({
        dataModelUpdate: {
          surfaceId: "playlist",
          path: "tracks",
          contents: [
            {
              key: "0",
              valueMap: [
                { key: "title", valueString: "Sunrise" },
                { key: "artist", valueString: "Ada" },
                { key: "duration", valueString: "3:21" },
              ],
            },
          ],
        },
      }),
    );

    assert.deepEqual(store().getHydrateNode("tracks")?.childIds, [cardId(0)]);
    assert.ok(store().getHydrateNode(cardId(0)));
    assert.equal(store().getHydrateNode(cardId(1)), undefined);
    assert.equal(store().getHydrateNode(titleId(3)), undefined);

    parse(
      JSON.stringify({
        dataModelUpdate: {
          surfaceId: "playlist",
          path: "tracks",
          contents: [
            {
              key: "0",
              valueMap: [
                { key: "title", valueString: "Sunrise" },
                { key: "artist", valueString: "Ada" },
                { key: "duration", valueString: "3:21" },
              ],
            },
            {
              key: "1",
              valueMap: [
                { key: "title", valueString: "Night Drive" },
                { key: "artist", valueString: "Grace" },
                { key: "duration", valueString: "4:05" },
              ],
            },
            {
              key: "2",
              valueMap: [
                { key: "title", valueString: "After Hours" },
                { key: "artist", valueString: "Lin" },
                { key: "duration", valueString: "2:48" },
              ],
            },
            {
              key: "3",
              valueMap: [
                { key: "title", valueString: "Dawn Chorus" },
                { key: "artist", valueString: "Kai" },
                { key: "duration", valueString: "3:56" },
              ],
            },
            {
              key: "4",
              valueMap: [
                { key: "title", valueString: "Blue Hour" },
                { key: "artist", valueString: "Nia" },
                { key: "duration", valueString: "5:02" },
              ],
            },
          ],
        },
      }),
    );

    assert.equal(store().getHydrateNode("tracks")?.childIds?.length, 5);
    assert.ok(store().getHydrateNode(cardId(4)));
    assert.ok(store().getHydrateNode(titleId(4)));
    assert.equal((store().getHydrateNode(titleId(4))?.v_node as Record<string, unknown>).text, "Blue Hour");
  });

  it("still renders List explicitList as static children", () => {
    const tree = parse(
      messagesToJsonl([
        { beginRendering: { surfaceId: "static-list", root: "root" } },
        {
          surfaceUpdate: {
            surfaceId: "static-list",
            components: [
              {
                id: "root",
                component: {
                  List: {
                    direction: "vertical",
                    children: { explicitList: ["item-a", "item-b"] },
                  },
                },
              },
            ],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "static-list",
            components: [
              {
                id: "item-a",
                component: { Text: { text: { literalString: "A" }, usageHint: "body" } },
              },
            ],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "static-list",
            components: [
              {
                id: "item-b",
                component: { Text: { text: { literalString: "B" }, usageHint: "body" } },
              },
            ],
          },
        },
      ]),
    );

    assert.deepEqual(
      tree,
      stampSurfaceId(
        {
          kind: "list",
          direction: "vertical",
          componentId: "root",
          hasMounted: false,
          children: [
            { kind: "text", text: "A", usageHint: "body", componentId: "item-a", hasMounted: false },
            { kind: "text", text: "B", usageHint: "body", componentId: "item-b", hasMounted: false },
          ],
        },
        "static-list",
      ),
    );
    assert.deepEqual(store().getHydrateNode("root")?.childIds, ["item-a", "item-b"]);
  });

  it("reads numeric-key valueMap objects as list items", () => {
    assert.deepEqual(readListItems({ "1": "b", "0": "a" }), ["a", "b"]);
    assert.deepEqual(readListItems(["a", "b"]), ["a", "b"]);
    assert.deepEqual(readListItems(undefined), []);
  });
});
