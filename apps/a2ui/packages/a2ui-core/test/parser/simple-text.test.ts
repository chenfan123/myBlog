/**
 * parser 测试覆盖：
 *
 * 1. beginRendering
 *    - 创建 surface simple-text
 *    - beginRender = true
 *    - 记录 root = "text"
 *    - 此时还没有 hydrate node / rootNode
 *
 * 2. surfaceUpdate
 *    - 创建 Text 对应的 hydrate node
 *    - ownerSurfaceId、protocol（文案 Hello, A2UI、usageHint h1）
 *    - 新组件 hasMounted = false
 *    - 未注入 renderMap 时，v_node 退回 mapped Text，并记 UNREGISTERED_COMPONENT
 *    - 尚未 beginRendering，beginRender = false
 *
 * 3. render
 *    - surfaceUpdate 时调用 renderMap.Text，入参为 mapped props + componentId + hasMounted
 *    - 返回值写入 hydrate node.v_node
 *    - 没有 Text render 时不调用其它类型，退回 mapped vnode，并记 UNREGISTERED_COMPONENT
 *    - 协议组件未在 renderMap 注册时写入 errorMap（含类型、componentId、surfaceId）
 *    - 已注册则不写 error
 *    - 多个 Text 各调用一次
 *    - simple-text mock 整段解析也会调用 render，rootNode.v_node 是实例
 *    - init({ renderTree }) 时，parse 结束后 SDK 调用一次 renderTree，入参是组装好的树
 *
 * 4. dataModelUpdate
 *    - 把 contents 写进该 surface 的 dataModel（title = Hello, A2UI）
 *
 * 5. deleteSurface
 *    - 先有 beginRendering + surfaceUpdate，再删除
 *    - surface 和 hydrate node 都被清掉
 *
 * 6. simple-text JSONL 整段 mock
 *    - 先 beginRendering 再 surfaceUpdate
 *    - 最终 surface 可渲染，rootNode 指向 text hydrate node
 *    - protocol 与 hydrateNodeMap 里的 text 一致
 */
import assert from "node:assert/strict";
import { simpleTextMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { ErrorType, getA2UIStore, initStore } from "../../src/store/index.js";

function store() {
  return getA2UIStore().getState();
}

function errors() {
  return Object.values(store().errorMap);
}

const textSurfaceUpdate = {
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
};

/**
 * A2UI v0.8 是 JSONL：每一行恰好一种 server→client 消息。
 * 四种消息分开断言：beginRendering / surfaceUpdate / dataModelUpdate / deleteSurface。
 */
describe("parser", () => {
  beforeEach(() => {
    initStore();
  });

  describe("beginRendering", () => {
    // 只处理 beginRendering：创建 surface、beginRender=true、记下 root id（此时还没有 hydrate node）
    it("creates a surface and marks it ready to render", () => {
      parse(
        JSON.stringify({
          beginRendering: {
            surfaceId: "simple-text",
            root: "text",
          },
        }),
      );

      const surface = store().getSurface("simple-text");

      assert.ok(surface, "surface simple-text should exist");
      assert.equal(surface.surfaceId, "simple-text");
      assert.equal(surface.beginRender, true);
      assert.equal(surface.root, "text");
      assert.equal(surface.rootNode, undefined);
    });

    it("stores sanitized beginRendering.styles on the surface", () => {
      parse(
        JSON.stringify({
          beginRendering: {
            surfaceId: "simple-text",
            root: "text",
            styles: {
              theme: "apple",
              primaryColor: "#1d1d1f",
              font: "url(https://evil.example)",
              radius: 18,
            },
          },
        }),
      );

      const surface = store().getSurface("simple-text");
      assert.deepEqual(surface?.styles, { theme: "apple", primaryColor: "#1d1d1f", radius: 18 });
    });
  });

  describe("surfaceUpdate", () => {
    // 只处理 surfaceUpdate：写入 Text 对应的 hydrate node，surface 尚未 beginRendering
    it("creates a hydrate node from the Text component", () => {
      parse(JSON.stringify(textSurfaceUpdate));

      const surface = store().getSurface("simple-text");
      const node = store().getHydrateNode("text");

      assert.ok(surface, "surface simple-text should exist");
      assert.equal(surface.beginRender, false);
      assert.ok(node, "hydrate node text should exist");
      assert.equal(node.componentId, "text");
      assert.equal(node.ownerSurfaceId, "simple-text");
      assert.deepEqual(node.v_node, {
        type: "Text",
        text: "Hello, A2UI",
        usageHint: "h1",
      });

      const protocol = JSON.parse(node.protocol) as {
        id: string;
        component: {
          Text: {
            text: { literalString: string };
            usageHint: string;
          };
        };
      };

      assert.equal(protocol.id, "text");
      assert.equal(protocol.component.Text.text.literalString, "Hello, A2UI");
      assert.equal(protocol.component.Text.usageHint, "h1");
      assert.equal(node.hasMounted, false);
    });
  });

  describe("render", () => {
    it("calls renderMap.Text with mapped props", () => {
      const calls: unknown[] = [];
      initStore({
        renderMap: {
          Text: (props) => {
            calls.push(props);
            return { kind: "rendered-text", ...props };
          },
        },
      });

      parse(JSON.stringify(textSurfaceUpdate));

      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], {
        text: "Hello, A2UI",
        usageHint: "h1",
        componentId: "text",
        surfaceId: "simple-text",
        hasMounted: false,
      });
    });

    it("writes the render return value onto v_node", () => {
      const instance = { kind: "rendered-text" };
      initStore({
        renderMap: {
          Text: () => instance,
        },
      });

      parse(JSON.stringify(textSurfaceUpdate));

      assert.equal(store().getHydrateNode("text")?.v_node, instance);
    });

    it("does not call other renders when Text is missing from renderMap", () => {
      let buttonCalled = false;
      initStore({
        renderMap: {
          Button: () => {
            buttonCalled = true;
            return { kind: "button" };
          },
        },
      });

      parse(JSON.stringify(textSurfaceUpdate));

      assert.equal(buttonCalled, false);
      assert.deepEqual(store().getHydrateNode("text")?.v_node, {
        type: "Text",
        text: "Hello, A2UI",
        usageHint: "h1",
      });
      assert.equal(errors().length, 1);
      assert.equal(errors()[0]?.type, ErrorType.UNREGISTERED_COMPONENT);
    });

    it("records an error when the protocol component is not registered", () => {
      parse(JSON.stringify(textSurfaceUpdate));

      const [error] = errors();
      assert.ok(error);
      assert.equal(error.type, ErrorType.UNREGISTERED_COMPONENT);
      assert.match(error.content, /"Text"/);
      assert.match(error.content, /componentId: "text"/);
      assert.match(error.content, /surfaceId: "simple-text"/);
      assert.match(error.content, /not registered in renderMap/);
    });

    it("records an error for an unknown protocol component type", () => {
      initStore({
        renderMap: {
          Text: (props) => props,
        },
      });

      parse(
        JSON.stringify({
          surfaceUpdate: {
            surfaceId: "simple-text",
            components: [
              {
                id: "action",
                component: {
                  GhostWidget: {
                    label: { literalString: "Go" },
                  },
                },
              },
            ],
          },
        }),
      );

      const [error] = errors();
      assert.ok(error);
      assert.equal(error.type, ErrorType.UNREGISTERED_COMPONENT);
      assert.match(error.content, /"GhostWidget"/);
      assert.match(error.content, /componentId: "action"/);
      assert.equal(store().getHydrateNode("action")?.v_node, null);
    });

    it("does not record an error when Text is registered", () => {
      initStore({
        renderMap: {
          Text: (props) => ({ kind: "rendered-text", ...props }),
        },
      });

      parse(JSON.stringify(textSurfaceUpdate));

      assert.equal(errors().length, 0);
    });

    it("calls render once per Text component", () => {
      const calls: unknown[] = [];
      initStore({
        renderMap: {
          Text: (props) => {
            calls.push(props);
            return props;
          },
        },
      });

      parse(
        JSON.stringify({
          surfaceUpdate: {
            surfaceId: "simple-text",
            components: [
              {
                id: "title",
                component: {
                  Text: {
                    text: { literalString: "Hello" },
                    usageHint: "h1",
                  },
                },
              },
              {
                id: "body",
                component: {
                  Text: {
                    text: { literalString: "A2UI" },
                    usageHint: "body",
                  },
                },
              },
            ],
          },
        }),
      );

      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], { text: "Hello", usageHint: "h1", componentId: "title", surfaceId: "simple-text", hasMounted: false });
      assert.deepEqual(calls[1], { text: "A2UI", usageHint: "body", componentId: "body", surfaceId: "simple-text", hasMounted: false });
      assert.equal(store().getHydrateNode("title")?.v_node, calls[0]);
      assert.equal(store().getHydrateNode("body")?.v_node, calls[1]);
    });

    it("calls render when parsing the simple-text mock", () => {
      const calls: unknown[] = [];
      initStore({
        renderMap: {
          Text: (props) => {
            calls.push(props);
            return { kind: "rendered-text", ...props };
          },
        },
      });

      parse(messagesToJsonl(simpleTextMock));

      const rendered = {
        kind: "rendered-text",
        text: "Hello, A2UI",
        usageHint: "h1",
        componentId: "text",
        surfaceId: "simple-text",
        hasMounted: false,
      };

      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], {
        text: "Hello, A2UI",
        usageHint: "h1",
        componentId: "text",
        surfaceId: "simple-text",
        hasMounted: false,
      });
      assert.deepEqual(calls[1], calls[0]);
      assert.deepEqual(store().getHydrateNode("text")?.v_node, rendered);
      assert.deepEqual(store().getSurface("simple-text")?.rootNode?.v_node, rendered);
      assert.equal(errors().length, 0);
    });

    it("calls renderTree with the assembled tree after parse", () => {
      const trees: unknown[] = [];
      initStore({
        renderMap: {
          Text: (props) => ({ kind: "rendered-text", ...props }),
        },
        renderTree: (tree) => {
          trees.push(tree);
        },
      });

      const tree = parse(messagesToJsonl(simpleTextMock));

      assert.equal(trees.length, 1);
      assert.equal(trees[0], tree);
      assert.deepEqual(tree, {
        kind: "rendered-text",
        text: "Hello, A2UI",
        usageHint: "h1",
        componentId: "text",
        surfaceId: "simple-text",
        hasMounted: false,
      });
    });

    it("calls renderTree after each parse of a JSONL line", () => {
      const trees: unknown[] = [];
      initStore({
        renderMap: {
          Text: (props) => ({ kind: "rendered-text", ...props }),
        },
        renderTree: (tree) => {
          trees.push(tree);
        },
      });

      for (const message of simpleTextMock) {
        parse(JSON.stringify(message));
      }

      assert.equal(trees.length, simpleTextMock.length);
      assert.equal(trees[0], null);
      assert.deepEqual(trees[1], {
        kind: "rendered-text",
        text: "Hello, A2UI",
        usageHint: "h1",
        componentId: "text",
        surfaceId: "simple-text",
        hasMounted: false,
      });
    });

    it("keeps hasMounted true after markHydrateNodeMounted and another surfaceUpdate", () => {
      initStore({
        renderMap: {
          Text: (props) => ({ kind: "rendered-text", ...props }),
        },
      });

      parse(JSON.stringify(textSurfaceUpdate));
      assert.equal(store().getHydrateNode("text")?.hasMounted, false);

      store().markHydrateNodeMounted("text");
      assert.equal(store().getHydrateNode("text")?.hasMounted, true);

      parse(JSON.stringify(textSurfaceUpdate));
      assert.equal(store().getHydrateNode("text")?.hasMounted, true);
    });
  });

  describe("dataModelUpdate", () => {
    // 只处理 dataModelUpdate：把 contents 写进该 surface 的 dataModel
    it("writes contents onto the surface data model", () => {
      parse(
        JSON.stringify({
          dataModelUpdate: {
            surfaceId: "simple-text",
            contents: [{ key: "title", valueString: "Hello, A2UI" }],
          },
        }),
      );

      const surface = store().getSurface("simple-text");

      assert.ok(surface, "surface simple-text should exist");
      assert.deepEqual(surface.dataModel, { title: "Hello, A2UI" });
    });
  });

  describe("deleteSurface", () => {
    // 只处理 deleteSurface：删掉 surface 以及属于它的 hydrate node
    it("removes the surface and its hydrate nodes", () => {
      parse(
        messagesToJsonl([
          {
            beginRendering: {
              surfaceId: "simple-text",
              root: "text",
            },
          },
          {
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
          },
          {
            deleteSurface: {
              surfaceId: "simple-text",
            },
          },
        ]),
      );

      assert.equal(store().getSurface("simple-text"), undefined);
      assert.equal(store().getHydrateNode("text"), undefined);
    });
  });

  describe("simple-text JSONL stream", () => {
    // mock 是 JSONL 流：先 beginRendering，再 surfaceUpdate，最终 surface 和 hydrate node 对齐
    it("parses simple-text mock into a surface", () => {
      parse(messagesToJsonl(simpleTextMock));

      const surface = store().getSurface("simple-text");

      assert.ok(surface, "surface simple-text should exist");
      assert.equal(surface.surfaceId, "simple-text");
      assert.equal(surface.beginRender, true);
      assert.equal(surface.rootNode?.componentId, "text");
    });

    it("parses simple-text mock into a hydrate node", () => {
      parse(messagesToJsonl(simpleTextMock));

      const node = store().getHydrateNode("text");

      assert.ok(node, "hydrate node text should exist");
      assert.equal(node.componentId, "text");
      assert.equal(node.ownerSurfaceId, "simple-text");
      assert.deepEqual(node.v_node, {
        type: "Text",
        text: "Hello, A2UI",
        usageHint: "h1",
      });

      const protocol = JSON.parse(node.protocol) as {
        id: string;
        component: {
          Text: {
            text: { literalString: string };
            usageHint: string;
          };
        };
      };

      assert.equal(protocol.id, "text");
      assert.equal(protocol.component.Text.text.literalString, "Hello, A2UI");
      assert.equal(protocol.component.Text.usageHint, "h1");
    });

    it("links surface.rootNode to the parsed hydrate node", () => {
      parse(messagesToJsonl(simpleTextMock));

      const surface = store().getSurface("simple-text");
      const node = store().getHydrateNode("text");

      assert.ok(surface);
      assert.ok(node);
      assert.equal(surface.rootNode?.componentId, node.componentId);
      assert.equal(surface.rootNode?.ownerSurfaceId, node.ownerSurfaceId);
      assert.equal(surface.rootNode?.protocol, node.protocol);
    });
  });
});
