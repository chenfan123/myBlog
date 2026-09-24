import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { createMockAgent } from "../src/agent";
import { createA2UIServer } from "../src/a2ui-server";
import { createApp } from "../src/app";
import { parseChatTurns, type ChatClient } from "../src/chat/openai-chat";

describe("parseChatTurns", () => {
  it("keeps user and assistant turns", () => {
    assert.deepEqual(
      parseChatTurns([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "tool", content: "skip" },
        { role: "user" },
      ]),
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    );
  });
});

describe("POST /v1/chat", () => {
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    const chat: ChatClient = {
      provider: "openai",
      model: "gpt-test",
      async complete(messages) {
        const last = messages.at(-1)?.content ?? "";
        return `echo:${last}`;
      },
      async *stream(messages) {
        const last = messages.at(-1)?.content ?? "";
        yield "echo:";
        yield last;
      },
    };
    const app = createApp(createA2UIServer({ agent: createMockAgent() }), { chat });
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

  it("returns provider status", async () => {
    const response = await fetch(`${baseUrl}/v1/chat`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, provider: "openai", model: "gpt-test" });
  });

  it("replies to a user message", async () => {
    const response = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reply: "echo:ping", provider: "openai", model: "gpt-test" });
  });

  it("streams thinking, deltas, then the finished reply", async () => {
    const response = await fetch(`${baseUrl}/v1/chat?sse=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const events: Array<Record<string, unknown>> = [];
    for (const block of (await response.text()).split("\n\n")) {
      const dataMatch = block.match(/^data: (.+)$/m);
      if (dataMatch) {
        events.push(JSON.parse(dataMatch[1]) as Record<string, unknown>);
      }
    }
    assert.equal(events[0]?.type, "CHAT_STARTED");
    assert.deepEqual(
      events.filter((item) => item.type === "CHAT_DELTA").map((item) => item.delta),
      ["echo:", "ping"],
    );
    const finished = events.at(-1);
    assert.equal(finished?.type, "CHAT_FINISHED");
    assert.equal(finished?.reply, "echo:ping");
  });

  it("rejects an empty conversation", async () => {
    const response = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "MESSAGE_REQUIRED");
  });
});

describe("POST /v1/chat without a client", () => {
  it("returns 503", async () => {
    const app = createApp(createA2UIServer({ agent: createMockAgent() }));
    const server = http.createServer(app.callback());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("no listen port");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      assert.equal(response.status, 503);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
