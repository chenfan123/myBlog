/**
 * 购物车 mock：List template 克隆商品卡，相对绑定 name/price/sku/quantity/selected。
 */
import assert from "node:assert/strict";
import { cartListMock } from "../../src/mock/index.js";
import { messagesToJsonl, parse } from "../../src/parser/index.js";
import { getA2UIStore, initStore } from "../../src/store/index.js";

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
  CheckBox: (props: Record<string, unknown>) => ({ kind: "checkbox", ...props }),
  Image: (props: Record<string, unknown>) => ({ kind: "image", ...props }),
  Icon: (props: Record<string, unknown>) => ({ kind: "icon", ...props }),
  Divider: (props: Record<string, unknown>) => ({ kind: "divider", ...props }),
  Slider: (props: Record<string, unknown>) => ({ kind: "slider", ...props }),
};

describe("cart list mock", () => {
  beforeEach(() => {
    initStore({ renderMap });
  });

  it("clones three cart items with unique ids and relative bindings", () => {
    parse(messagesToJsonl(cartListMock));

    assert.deepEqual(store().getHydrateNode("items")?.childIds, [
      "items:0:item-card",
      "items:1:item-card",
      "items:2:item-card",
    ]);
    assert.equal(store().getSurface("cart")?.dataModel.total, "¥137.00");

    const name = store().getHydrateNode("items:1:item-card:item-body:item-row:item-info:item-name")?.v_node as Record<
      string,
      unknown
    >;
    assert.equal(name.text, "亚麻托特包");
    assert.equal(name.textPath, "/items/1/name");

    const qty = store().getHydrateNode("items:1:item-card:item-body:item-qty-row:item-qty")?.v_node as Record<
      string,
      unknown
    >;
    assert.equal(qty.value, 2);
    assert.equal(qty.valuePath, "/items/1/quantity");
  });
});
