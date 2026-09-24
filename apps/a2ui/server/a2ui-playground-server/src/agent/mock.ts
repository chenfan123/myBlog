import { flattenMessages, normalizeMessages } from "../a2ui-server/parse";
import { DEFAULT_CATALOG_ID } from "../a2ui-server/protocol";
import type { A2UIAgent, GenerateA2UIInput, GenerateA2UIResult } from "./types";

/** 用固定 A2UI 协议冒充 agent：用户输入写进 dataModel.body，用来先把 SSE 接口跑通。 */
export function createMockAgent(): A2UIAgent {
  return {
    kind: "mock",
    async generate(input: GenerateA2UIInput): Promise<GenerateA2UIResult> {
      const surfaceId = input.surfaceId;
      const catalogId = input.catalogId ?? DEFAULT_CATALOG_ID;
      const text = input.message.trim() || (input.images?.length ? `Layout from ${input.images.length} image(s)` : "Hello, A2UI");
      return {
        messages: [
          { beginRendering: { surfaceId, root: "root", catalogId } },
          {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: "root",
                  component: {
                    Column: {
                      alignment: "stretch",
                      distribution: "start",
                      children: { explicitList: ["title", "body"] },
                    },
                  },
                },
              ],
            },
          },
          {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: "title",
                  component: {
                    Text: { text: { path: "/title" }, usageHint: "h2" },
                  },
                },
              ],
            },
          },
          {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: "body",
                  component: {
                    Text: { text: { path: "/body" }, usageHint: "body" },
                  },
                },
              ],
            },
          },
          {
            dataModelUpdate: {
              surfaceId,
              contents: [
                { key: "title", valueString: "Mock A2UI" },
                { key: "body", valueString: text },
              ],
            },
          },
        ],
      };
    },
    async *stream(input: GenerateA2UIInput) {
      const result = await this.generate(input);
      const messages = flattenMessages(
        normalizeMessages(result.messages ?? [], input.surfaceId, input.catalogId ?? DEFAULT_CATALOG_ID),
      );
      for (const message of messages) {
        yield message;
      }
    },
  };
}

/** @deprecated 使用 createMockAgent */
export const createStubAgent = createMockAgent;
