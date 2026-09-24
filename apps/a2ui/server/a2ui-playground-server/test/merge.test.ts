import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createA2UIServer, mergeProtocol } from "../src/a2ui-server";
import { sanitizeRefinePatch } from "../src/a2ui-server/merge";
import { parseRunRequest } from "../src/ag-ui/input";
import type { A2UIAgent } from "../src/agent/types";
import type { A2UIMessage } from "../src/a2ui-server/protocol";

const current: A2UIMessage[] = [
  {
    beginRendering: {
      surfaceId: "surface-1",
      root: "root",
      catalogId: "a2ui-react:v0.8",
      styles: { theme: "apple", primaryColor: "#1d1d1f" },
    },
  },
  {
    surfaceUpdate: {
      surfaceId: "surface-1",
      components: [{ id: "root", component: { Card: { child: "title" } } }],
    },
  },
  {
    surfaceUpdate: {
      surfaceId: "surface-1",
      components: [
        {
          id: "title",
          component: { Text: { text: { literalString: "理赔帮助" }, usageHint: "h1" } },
        },
      ],
    },
  },
];

describe("mergeProtocol", () => {
  it("updates styles and replaces a component by id", () => {
    const merged = mergeProtocol(
      current,
      [
        {
          beginRendering: {
            surfaceId: "surface-1",
            root: "root",
            catalogId: "a2ui-react:v0.8",
            styles: { primaryColor: "#0071e3" },
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "title",
                component: { Text: { text: { literalString: "车险理赔" }, usageHint: "h1" } },
              },
            ],
          },
        },
      ],
      "surface-1",
      "a2ui-react:v0.8",
    );

    const begin = merged[0]?.beginRendering as { styles?: { theme?: string; primaryColor?: string } };
    assert.equal(begin.styles?.theme, "apple");
    assert.equal(begin.styles?.primaryColor, "#0071e3");
    const title = merged.find((item) => {
      const update = item.surfaceUpdate as { components?: Array<{ id?: string }> } | undefined;
      return update?.components?.[0]?.id === "title";
    });
    assert.match(JSON.stringify(title), /车险理赔/);
    assert.equal(merged.filter((item) => item.surfaceUpdate).length, 2);
  });

  it("keeps the original tree when the model emits an unrelated full page", () => {
    const merged = mergeProtocol(
      current,
      [
        {
          beginRendering: {
            surfaceId: "surface-1",
            root: "launch-root",
            catalogId: "a2ui-react:v0.8",
            styles: { primaryColor: "#ff2d55" },
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [{ id: "launch-root", component: { Card: { child: "launch-title" } } }],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "launch-title",
                component: { Text: { text: { literalString: "新品发布" }, usageHint: "h1" } },
              },
            ],
          },
        },
      ],
      "surface-1",
      "a2ui-react:v0.8",
    );

    const begin = merged[0]?.beginRendering as { root?: string; styles?: { primaryColor?: string } };
    assert.equal(begin.root, "root");
    assert.equal(begin.styles?.primaryColor, "#ff2d55");
    assert.match(JSON.stringify(merged), /理赔帮助/);
    assert.doesNotMatch(JSON.stringify(merged), /新品发布/);
  });

  it("adds a new component with surfaceUpdate on the existing tree", () => {
    const withColumn: A2UIMessage[] = [
      current[0]!,
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [
            {
              id: "root",
              component: { Column: { children: { explicitList: ["title"] }, alignment: "stretch" } },
            },
          ],
        },
      },
      current[2]!,
    ];
    const merged = mergeProtocol(
      withColumn,
      [
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "root",
                component: {
                  Column: { children: { explicitList: ["title", "caption"] }, alignment: "stretch" },
                },
              },
            ],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "caption",
                component: { Text: { text: { literalString: "补充说明" }, usageHint: "caption" } },
              },
            ],
          },
        },
      ],
      "surface-1",
      "a2ui-react:v0.8",
    );

    assert.match(JSON.stringify(merged), /理赔帮助/);
    assert.match(JSON.stringify(merged), /补充说明/);
    assert.equal(merged.filter((item) => item.surfaceUpdate).length, 3);
    const root = merged.find((item) => {
      const update = item.surfaceUpdate as { components?: Array<{ id?: string }> } | undefined;
      return update?.components?.[0]?.id === "root";
    });
    assert.match(JSON.stringify(root), /caption/);
  });

  it("keeps a newly added subtree when the child message arrives first", () => {
    const withColumn: A2UIMessage[] = [
      current[0]!,
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [
            {
              id: "root",
              component: { Column: { children: { explicitList: ["title"] }, alignment: "stretch" } },
            },
          ],
        },
      },
      current[2]!,
    ];
    const patch: A2UIMessage[] = [
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [
            {
              id: "caption",
              component: { Text: { text: { literalString: "补充说明" }, usageHint: "caption" } },
            },
          ],
        },
      },
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [
            {
              id: "btn-label",
              component: { Text: { text: { literalString: "未来7天" }, usageHint: "body" } },
            },
          ],
        },
      },
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [
            {
              id: "forecast-btn",
              component: { Button: { child: "btn-label", primary: false } },
            },
          ],
        },
      },
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [
            {
              id: "root",
              component: {
                Column: { children: { explicitList: ["title", "caption", "forecast-btn"] }, alignment: "stretch" },
              },
            },
          ],
        },
      },
    ];

    const first = sanitizeRefinePatch(withColumn, [patch[0]!], { keepOrphans: true });
    assert.match(JSON.stringify(first), /补充说明/);

    const merged = mergeProtocol(withColumn, patch, "surface-1", "a2ui-react:v0.8");
    assert.match(JSON.stringify(merged), /理赔帮助/);
    assert.match(JSON.stringify(merged), /补充说明/);
    assert.match(JSON.stringify(merged), /未来7天/);
    assert.match(JSON.stringify(merged), /forecast-btn/);
  });

  it("wraps an existing child with a Row so a sibling can be added", () => {
    const merged = mergeProtocol(
      current,
      [
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "action-row",
                component: { Row: { children: { explicitList: ["title", "extra"] } } },
              },
            ],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "root",
                component: { Card: { child: "action-row" } },
              },
            ],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "extra",
                component: { Text: { text: { literalString: "未来7天" }, usageHint: "body" } },
              },
            ],
          },
        },
      ],
      "surface-1",
      "a2ui-react:v0.8",
    );

    assert.match(JSON.stringify(merged), /理赔帮助/);
    assert.match(JSON.stringify(merged), /未来7天/);
    const root = merged.find((item) => {
      const update = item.surfaceUpdate as { components?: Array<{ id?: string }> } | undefined;
      return update?.components?.[0]?.id === "root";
    });
    assert.match(JSON.stringify(root), /action-row/);
  });
});

describe("parseRunRequest history", () => {
  it("reads previous user turns and current protocol", () => {
    const run = parseRunRequest(
      {
        messages: [
          { role: "user", content: "先做理赔帮助页" },
          { role: "user", content: "标题改成车险理赔" },
        ],
        history: ["先做理赔帮助页"],
        currentMessages: current,
        surfaceId: "surface-1",
      },
      {},
    );
    assert.equal(run.message, "标题改成车险理赔");
    assert.deepEqual(run.history, ["先做理赔帮助页"]);
    assert.equal(run.currentMessages.length, 3);
    assert.equal(run.surfaceId, "surface-1");
  });
});

describe("stream refine", () => {
  it("merges a patch onto the current protocol", async () => {
    const agent: A2UIAgent = {
      kind: "test",
      async generate() {
        return { messages: [] };
      },
      async *stream(input) {
        assert.equal(input.currentMessages?.length, 3);
        assert.deepEqual(input.history, ["先做理赔帮助页"]);
        yield {
          surfaceUpdate: {
            surfaceId: "surface-1",
            components: [
              {
                id: "title",
                component: { Text: { text: { literalString: "车险理赔" }, usageHint: "h1" } },
              },
            ],
          },
        };
      },
    };

    let done: { messages?: A2UIMessage[]; modelMessages?: A2UIMessage[] } | undefined;
    for await (const event of createA2UIServer({ agent }).stream({
      message: "标题改成车险理赔",
      surfaceId: "surface-1",
      history: ["先做理赔帮助页"],
      currentMessages: current,
    })) {
      if (event.event === "done") {
        done = event.data;
      }
    }
    assert.equal(done?.modelMessages?.length, 1);
    assert.match(JSON.stringify(done?.messages), /车险理赔/);
    assert.match(JSON.stringify(done?.messages), /beginRendering/);
    assert.equal(done?.messages?.filter((item) => item.surfaceUpdate).length, 2);
  });
});
