import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createA2UIServer, inspectComponentGraph } from "../src/a2ui-server";
import type { A2UIAgent } from "../src/agent/types";

const truncatedClaimHelp = [
  {
    beginRendering: {
      surfaceId: "surface-5528bd06",
      root: "root",
      catalogId: "a2ui-react:v0.8",
    },
  },
  {
    surfaceUpdate: {
      surfaceId: "surface-5528bd06",
      components: [{ id: "root", component: { Card: { child: "root-col" } } }],
    },
  },
  {
    surfaceUpdate: {
      surfaceId: "surface-5528bd06",
      components: [
        {
          id: "root-col",
          component: {
            Column: {
              children: {
                explicitList: ["page-title", "page-caption", "photo-block-card", "docs-block-card"],
              },
            },
          },
        },
      ],
    },
  },
  {
    surfaceUpdate: {
      surfaceId: "surface-5528bd06",
      components: [
        {
          id: "page-title",
          component: { Text: { text: { literalString: "理赔帮助" }, usageHint: "h1" } },
        },
      ],
    },
  },
];

describe("inspectComponentGraph", () => {
  it("flags referenced ids that have no surfaceUpdate", () => {
    const report = inspectComponentGraph(truncatedClaimHelp);
    assert.deepEqual(report.missingIds, ["docs-block-card", "page-caption", "photo-block-card"]);
    assert.ok(report.definedIds.includes("page-title"));
  });
});

describe("stream continuation", () => {
  it("requests missing nodes and omits incomplete when the tree closes", async () => {
    let passes = 0;
    const agent: A2UIAgent = {
      kind: "test",
      async generate() {
        return { messages: [] };
      },
      async *stream(input) {
        passes += 1;
        if (passes === 1) {
          yield { beginRendering: { surfaceId: "s", root: "root", catalogId: "c" } };
          yield {
            surfaceUpdate: {
              surfaceId: "s",
              components: [{ id: "root", component: { Card: { child: "title" } } }],
            },
          };
          return;
        }
        assert.deepEqual(input.continuation?.missingIds, ["title"]);
        yield {
          surfaceUpdate: {
            surfaceId: "s",
            components: [
              {
                id: "title",
                component: { Text: { text: { literalString: "Hi" }, usageHint: "h1" } },
              },
            ],
          },
        };
      },
    };

    const events = [];
    for await (const event of createA2UIServer({ agent }).stream({ message: "hi" })) {
      events.push(event);
    }
    const done = events.find((event) => event.event === "done");
    assert.equal(passes, 2);
    assert.equal(done?.event, "done");
    if (done?.event === "done") {
      assert.equal(done.data.incomplete, undefined);
      assert.equal(done.data.messages.length, 3);
    }
  });

  it("keeps incomplete when the second pass still misses ids", async () => {
    const agent: A2UIAgent = {
      kind: "test",
      async generate() {
        return { messages: [] };
      },
      async *stream() {
        yield { beginRendering: { surfaceId: "s", root: "root", catalogId: "c" } };
        yield {
          surfaceUpdate: {
            surfaceId: "s",
            components: [{ id: "root", component: { Card: { child: "title" } } }],
          },
        };
      },
    };

    let done: { event: string; data?: { incomplete?: { missingIds: string[] } } } | undefined;
    for await (const event of createA2UIServer({ agent }).stream({ message: "hi" })) {
      if (event.event === "done") {
        done = event;
      }
    }
    assert.deepEqual(done?.data?.incomplete?.missingIds, ["title"]);
  });
});
