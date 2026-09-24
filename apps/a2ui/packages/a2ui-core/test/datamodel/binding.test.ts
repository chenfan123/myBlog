/**
 * 数据绑定 / updateModel / userAction：
 * - path+literal 隐式写入 dataModel，且不覆盖已有值
 * - 仅 path 且模型为空时渲染回退空串
 * - dataModelUpdate / updateModel 后 treebuild 用新值
 * - userAction 解析 context；__localUpdatePath 先改模型
 */
import assert from "node:assert/strict";
import { applyDataModelUpdate, dispatchUserAction, getValue, qualifyPath, resolvePath, setValue, updateModel } from "../../src/datamodel/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import { buildTree } from "../../src/treebuilder/index.js";

function store() {
  return getA2UIStore().getState();
}

const textRenderMap = {
  Text: (props: Record<string, unknown>) => ({ kind: "text", ...props }),
};

describe("datamodel path", () => {
  it("treats /user/name and user/name as the same path", () => {
    const model = setValue({}, "/user/name", "Ada");
    assert.equal(getValue(model, "/user/name"), "Ada");
    assert.equal(getValue(model, "user/name"), "Ada");
  });

  it("applies a nested dataModelUpdate without a leading slash", () => {
    const next = applyDataModelUpdate({ user: { name: "Ada" } }, "user", [
      { key: "name", valueString: "Grace" },
      { key: "role", valueString: "admin" },
    ]);
    assert.deepEqual(next, { user: { name: "Grace", role: "admin" } });
  });

  it("resolves relative list-item paths against the current scope", () => {
    const model = { tracks: { "0": { title: "Sunrise" } } };
    const item = { title: "Sunrise", artist: "Ada" };
    assert.equal(resolvePath("title", model, item), "Sunrise");
    assert.equal(resolvePath(".", model, item), item);
    assert.equal(resolvePath("/tracks/0/title", model, item), "Sunrise");
    assert.equal(qualifyPath("title", "/tracks/0"), "/tracks/0/title");
    assert.equal(qualifyPath("/user/name", "/tracks/0"), "/user/name");
  });
});

describe("BoundValue", () => {
  beforeEach(() => {
    initStore({ renderMap: textRenderMap });
  });

  it("writes path+literal into dataModel once and does not overwrite existing values", () => {
    parse(
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: "bound",
          components: [
            {
              id: "title",
              component: {
                Text: {
                  text: { path: "/headline", literalString: "Hello" },
                  usageHint: "h1",
                },
              },
            },
          ],
        },
      }),
    );

    assert.equal(store().getSurface("bound")?.dataModel.headline, "Hello");

    parse(
      JSON.stringify({
        dataModelUpdate: {
          surfaceId: "bound",
          contents: [{ key: "headline", valueString: "Updated" }],
        },
      }),
    );
    parse(
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: "bound",
          components: [
            {
              id: "title",
              component: {
                Text: {
                  text: { path: "/headline", literalString: "Hello" },
                  usageHint: "h1",
                },
              },
            },
          ],
        },
      }),
    );

    assert.equal(store().getSurface("bound")?.dataModel.headline, "Updated");
  });

  it("renders an empty string when only a path is bound and the model has no value", () => {
    const tree = parse(
      messagesToJsonl([
        { beginRendering: { surfaceId: "bound", root: "title" } },
        {
          surfaceUpdate: {
            surfaceId: "bound",
            components: [
              {
                id: "title",
                component: {
                  Text: {
                    text: { path: "/headline" },
                    usageHint: "h1",
                  },
                },
              },
            ],
          },
        },
      ]),
    );

    assert.deepEqual(store().getSurface("bound")?.dataModel, {});
    assert.equal((tree as { text?: string }).text, "");
  });

  it("re-renders Text after dataModelUpdate using the current model value", () => {
    parse(
      messagesToJsonl([
        { beginRendering: { surfaceId: "bound", root: "title" } },
        {
          surfaceUpdate: {
            surfaceId: "bound",
            components: [
              {
                id: "title",
                component: {
                  Text: {
                    text: { path: "/headline" },
                    usageHint: "h1",
                  },
                },
              },
            ],
          },
        },
      ]),
    );

    parse(
      JSON.stringify({
        dataModelUpdate: {
          surfaceId: "bound",
          contents: [{ key: "headline", valueString: "First" }],
        },
      }),
    );
    assert.equal((buildTree() as { text?: string }).text, "First");

    parse(
      JSON.stringify({
        dataModelUpdate: {
          surfaceId: "bound",
          contents: [{ key: "headline", valueString: "Second" }],
        },
      }),
    );
    assert.equal((buildTree() as { text?: string }).text, "Second");
  });

  it("reflects updateModel writes in the next buildTree", () => {
    parse(
      messagesToJsonl([
        { beginRendering: { surfaceId: "bound", root: "title" } },
        {
          surfaceUpdate: {
            surfaceId: "bound",
            components: [
              {
                id: "title",
                component: {
                  Text: {
                    text: { path: "/headline", literalString: "Hello" },
                    usageHint: "h1",
                  },
                },
              },
            ],
          },
        },
      ]),
    );

    updateModel("bound", "/headline", "From SDK");
    assert.equal(store().getSurface("bound")?.dataModel.headline, "From SDK");
    assert.equal((buildTree() as { text?: string }).text, "From SDK");
  });
});

describe("userAction", () => {
  it("resolves context paths from the data model", () => {
    const actions: unknown[] = [];
    initStore({
      renderMap: textRenderMap,
      onUserAction: (payload) => {
        actions.push(payload);
      },
    });

    parse(
      messagesToJsonl([
        { beginRendering: { surfaceId: "bound", root: "title" } },
        {
          surfaceUpdate: {
            surfaceId: "bound",
            components: [
              {
                id: "title",
                component: {
                  Text: {
                    text: { path: "/email" },
                    usageHint: "body",
                  },
                },
              },
            ],
          },
        },
        {
          dataModelUpdate: {
            surfaceId: "bound",
            contents: [{ key: "email", valueString: "demo@a2ui.dev" }],
          },
        },
      ]),
    );

    dispatchUserAction({
      name: "login",
      surfaceId: "bound",
      sourceComponentId: "submit",
      context: [{ key: "email", value: { path: "/email" } }],
    });

    assert.equal(actions.length, 1);
    const payload = actions[0] as { name: string; context: Record<string, unknown>; timestamp: string };
    assert.equal(payload.name, "login");
    assert.deepEqual(payload.context, { email: "demo@a2ui.dev" });
    assert.equal(typeof payload.timestamp, "string");
  });

  it("applies __localUpdatePath before emitting the action", () => {
    const actions: unknown[] = [];
    initStore({
      renderMap: textRenderMap,
      onUserAction: (payload) => {
        actions.push(payload);
      },
    });

    parse(
      messagesToJsonl([
        { beginRendering: { surfaceId: "bound", root: "title" } },
        {
          surfaceUpdate: {
            surfaceId: "bound",
            components: [
              {
                id: "title",
                component: {
                  Text: {
                    text: { path: "/email" },
                    usageHint: "body",
                  },
                },
              },
            ],
          },
        },
        {
          dataModelUpdate: {
            surfaceId: "bound",
            contents: [{ key: "email", valueString: "old@a2ui.dev" }],
          },
        },
      ]),
    );

    dispatchUserAction({
      name: "save",
      surfaceId: "bound",
      sourceComponentId: "submit",
      context: [
        { key: "__localUpdatePath", value: { literalString: "/email" } },
        { key: "__localUpdateString", value: { literalString: "new@a2ui.dev" } },
        { key: "email", value: { path: "/email" } },
      ],
    });

    assert.equal(store().getSurface("bound")?.dataModel.email, "new@a2ui.dev");
    assert.equal((buildTree() as { text?: string }).text, "new@a2ui.dev");
    const payload = actions[0] as { context: Record<string, unknown> };
    assert.deepEqual(payload.context, { email: "new@a2ui.dev" });
    assert.equal("__localUpdatePath" in payload.context, false);
  });
});
