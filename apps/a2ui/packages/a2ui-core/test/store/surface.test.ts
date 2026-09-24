/**
 * store 测试覆盖：
 *
 * 1. addSurface / getSurface
 *    - root 是字符串组件 id（"text"）
 *    - rootNode 是 HydrateNode 对象，不是字符串
 *    - 读回来的 rootNode 带有 componentId、v_node、protocol
 *
 * 2. updateSurface
 *    - 可以替换 rootNode 为另一个 HydrateNode 对象
 *    - root 字符串保持不变，除非显式改
 *
 * 3. addHydrateNode 与 surface.rootNode
 *    - 把同一份 HydrateNode 放进 hydrateNodeMap 并赋给 rootNode 时，是同一对象引用
 *
 * 4. deleteSurface
 *    - 只删 surfaceMap，不会自动清 hydrateNodeMap（那是 parser deleteSurface 的职责）
 */
import assert from "node:assert/strict";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import type { HydrateNode, Surface } from "../../src/store/types.js";

function textNode(overrides: Partial<HydrateNode> = {}): HydrateNode {
  return {
    componentId: "text",
    v_node: { type: "Text", text: "Hello, A2UI", usageHint: "h1" },
    ownerSurfaceId: "simple-text",
    childIds: [],
    hasMounted: false,
    protocol: JSON.stringify({
      id: "text",
      component: {
        Text: {
          text: { literalString: "Hello, A2UI" },
          usageHint: "h1",
        },
      },
    }),
    ...overrides,
  };
}

function textSurface(rootNode: HydrateNode): Surface {
  return {
    surfaceId: "simple-text",
    beginRender: true,
    root: "text",
    rootNode,
    dataModel: {},
  };
}

describe("store surface rootNode", () => {
  beforeEach(() => {
    initStore();
  });

  // root 是 id 字符串；rootNode 是 HydrateNode 对象
  it("stores rootNode as a HydrateNode object, not a string", () => {
    const { addSurface, getSurface } = getA2UIStore().getState();
    const node = textNode();
    addSurface(textSurface(node));

    const surface = getSurface("simple-text");

    assert.ok(surface);
    assert.equal(typeof surface.root, "string");
    assert.equal(surface.root, "text");
    assert.equal(typeof surface.rootNode, "object");
    assert.notEqual(typeof surface.rootNode, "string");
    assert.equal(surface.rootNode?.componentId, "text");
    assert.deepEqual(surface.rootNode?.v_node, {
      type: "Text",
      text: "Hello, A2UI",
      usageHint: "h1",
    });
  });

  // updateSurface 用新的 HydrateNode 对象替换 rootNode
  it("updates rootNode with another HydrateNode object", () => {
    const store = getA2UIStore();
    const original = textNode();
    store.getState().addSurface(textSurface(original));

    const next = textNode({
      v_node: { type: "Text", text: "Updated" },
    });
    store.getState().updateSurface("simple-text", { rootNode: next });

    const surface = store.getState().getSurface("simple-text");

    assert.equal(surface?.root, "text");
    assert.equal((surface?.rootNode?.v_node as { text?: string } | undefined)?.text, "Updated");
    assert.equal(surface?.rootNode?.componentId, "text");
  });

  // 同一 HydrateNode 实例同时放进 map 和 surface.rootNode
  it("can point rootNode at the same object as hydrateNodeMap", () => {
    const { addSurface, addHydrateNode, getSurface, getHydrateNode } = getA2UIStore().getState();
    const node = textNode();

    addHydrateNode(node);
    addSurface(textSurface(node));

    assert.equal(getSurface("simple-text")?.rootNode, getHydrateNode("text"));
    assert.equal(getSurface("simple-text")?.rootNode, node);
  });

  // deleteSurface 只删 surface，hydrate node 仍在
  it("deleteSurface does not remove hydrate nodes by itself", () => {
    const { addSurface, addHydrateNode, deleteSurface, getSurface, getHydrateNode } =
      getA2UIStore().getState();
    const node = textNode();

    addHydrateNode(node);
    addSurface(textSurface(node));
    deleteSurface("simple-text");

    assert.equal(getSurface("simple-text"), undefined);
    assert.ok(getHydrateNode("text"));
  });
});
