/**
 * 标准目录 vnode 映射：扁平化 bound 字段，抽出 childIds，render props 不含 child id。
 */
import assert from "node:assert/strict";
import { standardCatalogMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";
import {
  getChildIds,
  getChildrenTemplate,
  getComponentRenderRequest,
  mapComponentToVNode,
  STANDARD_CATALOG_TYPES,
} from "../../src/vnode/index.js";

describe("standard catalog vnode", () => {
  it("lists all 18 v0.8 catalog component types", () => {
    assert.equal(STANDARD_CATALOG_TYPES.length, 18);
  });

  it("maps Text literalString and usageHint", () => {
    const mapped = mapComponentToVNode({
      Text: { text: { literalString: "Hello, A2UI" }, usageHint: "h1" },
    });
    assert.deepEqual(mapped, { type: "Text", text: "Hello, A2UI", usageHint: "h1" });
  });

  it("keeps Text path when there is no literal", () => {
    const mapped = mapComponentToVNode({
      Text: { text: { path: "/doc/title" }, usageHint: "body" },
    });
    assert.deepEqual(mapped, { type: "Text", text: "", textPath: "/doc/title", usageHint: "body" });
  });

  it("maps Image / Icon / Video / AudioPlayer bound urls", () => {
    assert.deepEqual(
      mapComponentToVNode({
        Image: { url: { literalString: "https://example/a.png" }, fit: "cover", usageHint: "avatar" },
      }),
      { type: "Image", url: "https://example/a.png", fit: "cover", usageHint: "avatar" },
    );
    assert.deepEqual(
      mapComponentToVNode({
        Image: {
          url: { literalString: "" },
          prompt: { literalString: "杭州晴天城市插画" },
          usageHint: "header",
        },
      }),
      { type: "Image", url: "", prompt: "杭州晴天城市插画", usageHint: "header" },
    );
    assert.deepEqual(mapComponentToVNode({ Icon: { name: { literalString: "star" } } }), {
      type: "Icon",
      name: "star",
    });
    assert.deepEqual(mapComponentToVNode({ Video: { url: { path: "/clip" } } }), {
      type: "Video",
      url: "",
      urlPath: "/clip",
    });
    assert.deepEqual(
      mapComponentToVNode({
        AudioPlayer: { url: { literalString: "https://example/a.mp3" }, description: { literalString: "Theme" } },
      }),
      { type: "AudioPlayer", url: "https://example/a.mp3", description: "Theme" },
    );
  });

  it("extracts explicitList child ids for Column, Row, and List", () => {
    assert.deepEqual(
      getChildIds({ Column: { children: { explicitList: ["a", "b"] }, distribution: "start" } }),
      ["a", "b"],
    );
    assert.deepEqual(getChildIds({ Row: { children: { explicitList: ["x"] } } }), ["x"]);
    assert.deepEqual(
      getChildIds({ List: { children: { explicitList: ["one", "two"] }, direction: "vertical" } }),
      ["one", "two"],
    );
  });

  it("accepts the catalog List children key typo (a single space)", () => {
    assert.deepEqual(
      getChildIds({ List: { " ": { explicitList: ["a"] }, direction: "horizontal" } }),
      ["a"],
    );
  });

  it("reads children.template without treating the template component as a static child", () => {
    const list = {
      List: {
        direction: "vertical",
        children: {
          template: { componentId: "track-row", dataBinding: "/tracks" },
        },
      },
    };
    assert.deepEqual(getChildIds(list), []);
    assert.deepEqual(getChildrenTemplate(list), { componentId: "track-row", dataBinding: "/tracks" });
    assert.deepEqual(mapComponentToVNode(list), {
      type: "List",
      childIds: [],
      template: { componentId: "track-row", dataBinding: "/tracks" },
      direction: "vertical",
    });
    assert.deepEqual(getComponentRenderRequest(list)?.props, { direction: "vertical" });
    assert.equal(getChildrenTemplate({ Column: { children: { explicitList: ["a"] } } }), undefined);
  });

  it("extracts Card.child, Button.child, Modal slots, and Tabs tabItems", () => {
    assert.deepEqual(getChildIds({ Card: { child: "body" } }), ["body"]);
    assert.deepEqual(
      getChildIds({ Button: { child: "label", primary: true, action: { name: "go" } } }),
      ["label"],
    );
    assert.deepEqual(
      getChildIds({ Modal: { entryPointChild: "open", contentChild: "panel" } }),
      ["open", "panel"],
    );
    assert.deepEqual(
      getChildIds({
        Tabs: {
          tabItems: [
            { title: { literalString: "One" }, child: "tab-a" },
            { title: { literalString: "Two" }, child: "tab-b" },
          ],
        },
      }),
      ["tab-a", "tab-b"],
    );
  });

  it("omits child ids from render request props", () => {
    const card = getComponentRenderRequest({ Card: { child: "body" } });
    assert.equal(card?.type, "Card");
    assert.equal("childId" in (card?.props ?? {}), false);
    assert.equal("childIds" in (card?.props ?? {}), false);

    const button = getComponentRenderRequest({
      Button: { child: "label", primary: true, action: { name: "login" } },
    });
    assert.deepEqual(button?.props, { primary: true, action: { name: "login" } });

    const column = getComponentRenderRequest({
      Column: { children: { explicitList: ["a"] }, distribution: "start", alignment: "center" },
    });
    assert.deepEqual(column?.props, { distribution: "start", alignment: "center" });
  });

  it("maps form controls and leaves", () => {
    assert.deepEqual(
      mapComponentToVNode({
        CheckBox: { label: { literalString: "On" }, value: { literalBoolean: true } },
      }),
      { type: "CheckBox", label: "On", value: true },
    );
    assert.deepEqual(
      mapComponentToVNode({
        TextField: {
          label: { literalString: "Email" },
          text: { path: "/email" },
          textFieldType: "shortText",
        },
      }),
      { type: "TextField", label: "Email", textPath: "/email", textFieldType: "shortText" },
    );
    assert.deepEqual(
      mapComponentToVNode({
        Slider: { value: { literalNumber: 8 }, minValue: 0, maxValue: 10 },
      }),
      { type: "Slider", value: 8, minValue: 0, maxValue: 10 },
    );
    assert.deepEqual(mapComponentToVNode({ Divider: { axis: "vertical" } }), {
      type: "Divider",
      axis: "vertical",
    });
    assert.deepEqual(getChildIds({ Divider: { axis: "horizontal" } }), []);
    assert.deepEqual(getChildIds({ Text: { text: { literalString: "Hi" } } }), []);
    assert.deepEqual(
      mapComponentToVNode({ Empty: { description: { literalString: "暂无内容" } } }),
      { type: "Empty", description: "暂无内容" },
    );
  });

  it("returns null for multi-key components and unknown types", () => {
    assert.equal(mapComponentToVNode({ Text: {}, Column: {} }), null);
    assert.equal(mapComponentToVNode({ GhostWidget: { n: 1 } }), null);
    assert.equal(getComponentRenderRequest({ Text: {}, Column: {} }), null);
  });

  it("parses the standard catalog mock without unregistered components", () => {
    const renderMap = Object.fromEntries(
      STANDARD_CATALOG_TYPES.map((type) => [type, (props: Record<string, unknown>) => ({ kind: type, ...props })]),
    );
    initStore({ renderMap });
    parse(messagesToJsonl(standardCatalogMock));
    assert.equal(Object.values(getA2UIStore().getState().errorMap).length, 0);
    assert.equal(getA2UIStore().getState().getSurface("standard-catalog")?.root, "root");
    assert.ok(getA2UIStore().getState().getHydrateNode("root"));
  });
});
