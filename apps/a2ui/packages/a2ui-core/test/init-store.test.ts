import assert from "node:assert/strict";
import { init, initStore } from "../src/store/index.js";

describe("initStore", () => {
  it("initializes the store successfully", () => {
    const store = initStore();

    assert.ok(store, "store instance should be created");

    const state = store.getState();

    assert.deepEqual(state.renderMap, {});
    assert.deepEqual(state.surfaceMap, {});
    assert.deepEqual(state.hydrateNodeMap, {});
    assert.deepEqual(state.errorMap, {});
    assert.equal(state.renderTree, undefined);
    assert.equal(state.onUserAction, undefined);
  });

  it("stores renderMap passed to init", () => {
    const renderText = (props: Record<string, unknown>) => props;
    const store = init({ renderMap: { Text: renderText } });

    assert.equal(store.getState().renderMap.Text, renderText);
  });

  it("stores renderTree passed to init", () => {
    const renderTree = (tree: unknown) => tree;
    const store = init({ renderTree });

    assert.equal(store.getState().renderTree, renderTree);
  });

  it("stores onUserAction passed to init", () => {
    const onUserAction = () => undefined;
    const store = init({ onUserAction });

    assert.equal(store.getState().onUserAction, onUserAction);
  });
});
