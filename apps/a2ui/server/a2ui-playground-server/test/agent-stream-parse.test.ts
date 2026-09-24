import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentStreamParser, prepareStreamMessages } from "../src/a2ui-server/parse";

describe("createAgentStreamParser", () => {
  it("extracts messages from a { messages } wrapper as each object closes", () => {
    const parser = createAgentStreamParser();
    assert.deepEqual(parser.push('{ "messages": ['), []);

    const first = parser.push(
      '{"beginRendering":{"surfaceId":"s1","root":"root","catalogId":"cat"}},',
    );
    assert.equal(first.length, 1);
    assert.equal("beginRendering" in first[0], true);

    const second = parser.push(
      '{"surfaceUpdate":{"surfaceId":"s1","components":[{"id":"root","component":{"Text":{"text":{"literalString":"Hi"}}}}]} } ] }',
    );
    assert.equal(second.length, 1);
    assert.equal("surfaceUpdate" in second[0], true);
    assert.deepEqual(parser.finish(), []);
  });

  it("extracts JSONL objects across token chunks", () => {
    const parser = createAgentStreamParser();
    const line =
      '{"beginRendering":{"surfaceId":"s1","root":"root"}}\n{"dataModelUpdate":{"surfaceId":"s1","contents":[]}}\n';
    assert.deepEqual(parser.push(line.slice(0, 18)), []);
    const mid = parser.push(line.slice(18, 70));
    assert.equal(mid.length, 1);
    const rest = parser.push(line.slice(70));
    assert.equal(rest.length, 1);
    assert.equal("dataModelUpdate" in rest[0], true);
  });

  it("finish() parses a complete leftover document", () => {
    const parser = createAgentStreamParser();
    parser.push("not json yet ");
    const messages = parser.finish();
    assert.equal(messages.length, 0);
    const late = createAgentStreamParser();
    const extracted = late.push('{"messages":[{"beginRendering":{"surfaceId":"s1","root":"root"}}]}');
    assert.equal(extracted.length + late.finish().length, 1);
  });
});

describe("prepareStreamMessages", () => {
  it("splits multi-component surfaceUpdate and fills catalogId", () => {
    const prepared = prepareStreamMessages(
      [
        { beginRendering: { root: "root" } },
        {
          surfaceUpdate: {
            components: [
              { id: "root", component: { Column: { children: { explicitList: ["a"] } } } },
              { id: "a", component: { Text: { text: { literalString: "x" } } } },
            ],
          },
        },
      ],
      "surface-live",
      "a2ui-react:v0.8",
    );
    assert.equal(prepared.length, 3);
    assert.equal((prepared[0].beginRendering as { catalogId?: string }).catalogId, "a2ui-react:v0.8");
    assert.equal((prepared[0].beginRendering as { surfaceId?: string }).surfaceId, "surface-live");
    assert.equal((prepared[1].surfaceUpdate as { components: unknown[] }).components.length, 1);
  });
});
