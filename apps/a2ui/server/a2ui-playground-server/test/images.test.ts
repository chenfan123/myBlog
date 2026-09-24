import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { createMockAgent } from "../src/agent";
import { buildUserContent } from "../src/agent/openai";
import { assertAgentImages, parseAgentImages } from "../src/agent/images";
import { createA2UIServer } from "../src/a2ui-server";
import { parseRunRequest } from "../src/ag-ui/input";
import { createApp } from "../src/app";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("agent images", () => {
  it("parses image_url parts", () => {
    assert.deepEqual(
      parseAgentImages([
        { type: "text", text: "hi" },
        { type: "image_url", image_url: { url: TINY_PNG } },
        { url: "https://example.com/a.png" },
      ]),
      [{ url: TINY_PNG }, { url: "https://example.com/a.png" }],
    );
  });

  it("rejects too many images", () => {
    assert.throws(
      () =>
        assertAgentImages([
          { url: TINY_PNG },
          { url: `${TINY_PNG}A` },
          { url: `${TINY_PNG}B` },
          { url: `${TINY_PNG}C` },
          { url: `${TINY_PNG}D` },
        ]),
      /INVALID_IMAGE|at most 4/,
    );
  });

  it("reads images from the last user AG-UI message", () => {
    const run = parseRunRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "做成登录页" },
              { type: "image_url", image_url: { url: TINY_PNG } },
            ],
          },
        ],
      },
      {},
    );
    assert.equal(run.message, "做成登录页");
    assert.equal(run.images.length, 1);
    assert.equal(run.images[0]?.url, TINY_PNG);
  });

  it("builds multimodal user content", () => {
    const content = buildUserContent("登录表单", [{ url: TINY_PNG }]);
    assert.ok(Array.isArray(content));
    assert.deepEqual(content[0], { type: "text", text: "登录表单" });
    assert.deepEqual(content[1], { type: "image_url", image_url: { url: TINY_PNG } });
  });
});

describe("POST /v1/generate with images", () => {
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    const app = createApp(createA2UIServer({ agent: createMockAgent() }), { intervalMs: 0 });
    server = http.createServer(app.callback());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("no listen port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("accepts an image-only JSON generate", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=0`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: TINY_PNG } }],
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      events?: Array<{ content?: { a2ui_messages?: unknown[] } }>;
    };
    const snapshot = payload.events?.find((item) => item.content?.a2ui_messages);
    assert.ok((snapshot?.content?.a2ui_messages?.length ?? 0) > 0);
  });

  it("rejects an invalid image URL", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=0`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: [{ url: "javascript:alert(1)" }],
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "INVALID_IMAGE");
  });
});
