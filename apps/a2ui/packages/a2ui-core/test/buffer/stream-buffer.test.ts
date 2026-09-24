/**
 * JSON 流缓冲区：
 *
 * 1. 不完整分片留在 pending，不 parse
 * 2. 抽出完整 JSON 对象后补成 JSONL 再 parse
 * 3. surfaceUpdate 每个 component 拆成独立 surfaceUpdate JSONL
 * 4. 50 字节分片重放 nested-column / column-text 与整包 parse 结果一致
 */
import assert from "node:assert/strict";
import {
  A2UIStreamBuffer,
  chunkText,
  columnTextMock,
  nestedColumnMock,
  parse,
  messagesToJsonl,
  toProtocolJsonl,
} from "../../src/index.js";
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

describe("A2UIStreamBuffer", () => {
  beforeEach(() => {
    initStore({ renderMap: layoutRenderMap });
  });

  it("keeps incomplete JSON in the buffer without parsing", () => {
    const buffer = new A2UIStreamBuffer();
    const source = JSON.stringify(nestedColumnMock, null, 2);
    const result = buffer.push(source.slice(0, 50));

    assert.deepEqual(result.jsonl, []);
    assert.equal(result.tree, null);
    assert.ok(buffer.pending.length > 0);
    assert.equal(store().getHydrateNode("root"), undefined);
  });

  it("completes a JSONL line once the object is whole", () => {
    const buffer = new A2UIStreamBuffer();
    const source = JSON.stringify(nestedColumnMock, null, 2);
    buffer.push(source.slice(0, 50));
    assert.equal(store().getSurface("nested-column"), undefined);

    for (const chunk of chunkText(source.slice(50), 50)) {
      buffer.push(chunk);
      if (store().getSurface("nested-column")?.beginRender) {
        break;
      }
    }

    assert.equal(store().getSurface("nested-column")?.beginRender, true);
    assert.equal(store().getSurface("nested-column")?.root, "root");
  });

  it("splits a multi-component surfaceUpdate into one JSONL per component", () => {
    const message = {
      surfaceUpdate: {
        surfaceId: "nested-column",
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: { explicitList: ["page-title", "header", "body"] },
                distribution: "start",
                alignment: "stretch",
              },
            },
          },
          {
            id: "page-title",
            component: {
              Text: {
                text: { literalString: "A2UI nested layout" },
                usageHint: "h1",
              },
            },
          },
        ],
      },
    };

    const lines = toProtocolJsonl(message);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
      surfaceUpdate: {
        surfaceId: "nested-column",
        components: [message.surfaceUpdate.components[0]],
      },
    });
    assert.deepEqual(JSON.parse(lines[1] ?? "{}"), {
      surfaceUpdate: {
        surfaceId: "nested-column",
        components: [message.surfaceUpdate.components[1]],
      },
    });
    assert.equal(lines[0]?.includes("\n"), false);
  });

  it("parses each split surfaceUpdate independently", () => {
    const buffer = new A2UIStreamBuffer();
    const source = JSON.stringify(columnTextMock, null, 2);
    let jsonlCount = 0;
    for (const chunk of chunkText(source, 50)) {
      jsonlCount += buffer.push(chunk).jsonl.length;
    }

    assert.equal(jsonlCount, 5);
    assert.ok(store().getHydrateNode("root"));
    assert.ok(store().getHydrateNode("title"));
    assert.ok(store().getHydrateNode("subtitle"));
    assert.ok(store().getHydrateNode("body"));
    assert.deepEqual(store().getHydrateNode("root")?.childIds, ["title", "subtitle", "body"]);
  });

  it("replays nested-column 50-char chunks into the same tree as a full parse", () => {
    parse(messagesToJsonl(nestedColumnMock));
    const expected = buildTree();

    initStore({ renderMap: layoutRenderMap });
    const buffer = new A2UIStreamBuffer();
    for (const chunk of chunkText(JSON.stringify(nestedColumnMock, null, 2), 50)) {
      buffer.push(chunk);
    }

    assert.equal(buffer.pending, "");
    assert.deepEqual(buildTree(), expected);
    assert.equal(Object.keys(store().hydrateNodeMap).length, 14);
  });
});
