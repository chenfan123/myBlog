/**
 * mock agent + AG-UI SSE：POST /v1/generate 按 RunAgentInput 流式下发 ACTIVITY_SNAPSHOT。
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { createMockAgent } from "../src/agent";
import { createA2UIServer } from "../src/a2ui-server";
import { wantsSse } from "../src/ag-ui/input";
import { createApp } from "../src/app";

function parseAgUiSse(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const block of body.split("\n\n")) {
    const dataMatch = block.match(/^data: (.+)$/m);
    if (!dataMatch) {
      continue;
    }
    events.push(JSON.parse(dataMatch[1]) as Record<string, unknown>);
  }
  return events;
}

describe("POST /v1/generate AG-UI SSE", () => {
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

  it("streams RUN_STARTED, a2ui ACTIVITY_SNAPSHOT, then RUN_FINISHED", async () => {
    const response = await fetch(`${baseUrl}/v1/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: "thread_1",
        runId: "run_1",
        messages: [{ id: "msg_1", role: "user", content: "你好，流式 mock" }],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const events = parseAgUiSse(await response.text());
    assert.equal(events[0]?.type, "RUN_STARTED");
    assert.equal(events[0]?.threadId, "thread_1");
    assert.equal(events[0]?.runId, "run_1");
    assert.equal(events[events.length - 1]?.type, "RUN_FINISHED");

    const snapshots = events.filter((item) => item.type === "ACTIVITY_SNAPSHOT");
    assert.equal(snapshots.length, 5);
    const last = snapshots[4] as {
      activityType?: string;
      replace?: boolean;
      content?: {
        version?: string;
        a2ui_messages?: Array<{ dataModelUpdate?: { contents?: Array<{ key?: string; valueString?: string }> } }>;
      };
    };
    assert.equal(last.activityType, "a2ui-surface");
    assert.equal(last.replace, false);
    assert.equal(last.content?.version, "v0.8");
    assert.equal(last.content?.a2ui_messages?.length, 1);
    assert.equal(
      last.content?.a2ui_messages?.[0]?.dataModelUpdate?.contents?.find((entry) => entry.key === "body")?.valueString,
      "你好，流式 mock",
    );
    assert.equal(
      snapshots.every((item) => (item as { replace?: unknown }).replace === false),
      true,
    );
    assert.equal(
      snapshots.every(
        (item) => ((item as { content?: { a2ui_messages?: unknown[] } }).content?.a2ui_messages?.length ?? 0) === 1,
      ),
      true,
    );
  });

  it("emits RUN_ERROR when the user message is missing", async () => {
    const response = await fetch(`${baseUrl}/v1/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "thread_2", runId: "run_2", messages: [] }),
    });
    const events = parseAgUiSse(await response.text());
    assert.equal(events[0]?.type, "RUN_STARTED");
    assert.equal(events[1]?.type, "RUN_ERROR");
    assert.equal(events[1]?.code, "MESSAGE_REQUIRED");
  });

  it("returns one-shot JSON when sse=0", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=0`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        threadId: "thread_json",
        runId: "run_json",
        messages: [{ id: "msg_1", role: "user", content: "一次性 JSON" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);

    const body = (await response.json()) as {
      threadId: string;
      runId: string;
      surfaceId: string;
      catalogId: string;
      modelOutput?: { messages?: unknown[] };
      converted?: unknown[];
      events: Array<Record<string, unknown>>;
    };
    assert.equal(body.threadId, "thread_json");
    assert.equal(body.runId, "run_json");
    assert.equal(body.catalogId, "a2ui-react:v0.8");
    assert.ok(Array.isArray(body.modelOutput?.messages));
    assert.ok((body.modelOutput?.messages?.length ?? 0) > 0);
    assert.ok(Array.isArray(body.converted));
    assert.equal(body.converted?.length, 5);
    assert.equal(body.events[0]?.type, "RUN_STARTED");
    assert.equal(body.events[1]?.type, "ACTIVITY_SNAPSHOT");
    assert.equal(body.events[2]?.type, "RUN_FINISHED");
    assert.equal(body.events.length, 3);

    const snapshot = body.events[1] as {
      replace?: boolean;
      content?: { a2ui_messages?: Array<{ dataModelUpdate?: { contents?: Array<{ key?: string; valueString?: string }> } }> };
    };
    assert.equal(snapshot.replace, true);
    assert.equal(snapshot.content?.a2ui_messages?.length, 5);
    assert.equal(
      snapshot.content?.a2ui_messages?.at(-1)?.dataModelUpdate?.contents?.find((entry) => entry.key === "body")
        ?.valueString,
      "一次性 JSON",
    );
  });

  it("streams a local mock catalog over SSE when mock is set", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=1&mock=simple-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: "thread_mock",
        runId: "run_mock",
        messages: [{ id: "msg_1", role: "user", content: "Simple Text" }],
        forwardedProps: { mock: "simple-text" },
      }),
    });
    const events = parseAgUiSse(await response.text());
    assert.equal(events[0]?.type, "RUN_STARTED");
    assert.equal(events[events.length - 1]?.type, "RUN_FINISHED");
    const snapshots = events.filter((item) => item.type === "ACTIVITY_SNAPSHOT");
    assert.equal(snapshots.length, 2);
    const first = snapshots[0] as {
      replace?: boolean;
      content?: { a2ui_messages?: Array<{ beginRendering?: unknown; surfaceUpdate?: unknown }> };
    };
    const last = snapshots[1] as {
      replace?: boolean;
      content?: { a2ui_messages?: Array<{ beginRendering?: unknown; surfaceUpdate?: unknown }> };
    };
    assert.equal(first.replace, false);
    assert.equal(first.content?.a2ui_messages?.length, 1);
    assert.ok(first.content?.a2ui_messages?.[0]?.beginRendering);
    assert.equal(last.replace, false);
    assert.equal(last.content?.a2ui_messages?.length, 1);
    assert.ok(last.content?.a2ui_messages?.[0]?.surfaceUpdate);
  });

  it("streams a { messages } mock after flattening components", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=1&mock=login-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: "thread_login",
        runId: "run_login",
        messages: [{ id: "msg_1", role: "user", content: "Login Form" }],
        forwardedProps: { mock: "login-form" },
      }),
    });
    const events = parseAgUiSse(await response.text());
    const snapshots = events.filter((item) => item.type === "ACTIVITY_SNAPSHOT");
    assert.equal(snapshots.length, 10);
    const finished = events[events.length - 1] as {
      type?: string;
      modelOutput?: { messages?: unknown[] };
      converted?: unknown[];
    };
    assert.equal(finished.type, "RUN_FINISHED");
    assert.ok((finished.modelOutput?.messages?.length ?? 0) > 0);
    assert.ok((finished.modelOutput?.messages?.length ?? 0) < (finished.converted?.length ?? 0));
    assert.equal(finished.converted?.length, 10);
    const first = snapshots[0] as {
      replace?: boolean;
      content?: { a2ui_messages?: Array<{ beginRendering?: unknown; dataModelUpdate?: unknown }> };
    };
    const last = snapshots.at(-1) as {
      replace?: boolean;
      content?: { a2ui_messages?: Array<{ beginRendering?: unknown; dataModelUpdate?: unknown }> };
    };
    assert.equal(first.replace, false);
    assert.equal(first.content?.a2ui_messages?.length, 1);
    assert.ok(first.content?.a2ui_messages?.[0]?.beginRendering);
    assert.equal(last.replace, false);
    assert.equal(last.content?.a2ui_messages?.length, 1);
    assert.ok(last.content?.a2ui_messages?.[0]?.dataModelUpdate);
  });

  it("returns JSON 404 for an unknown mock before opening SSE", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=1&mock=does-not-exist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: "thread_missing",
        runId: "run_missing",
        forwardedProps: { mock: "does-not-exist" },
      }),
    });
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") ?? "", /json/);
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    assert.equal(payload.error?.code, "MOCK_NOT_FOUND");
    assert.match(payload.error?.message ?? "", /does-not-exist/);
  });

  it("does not crash when the SSE client disconnects", async () => {
    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/v1/generate?sse=1&mock=simple-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      signal: controller.signal,
      body: JSON.stringify({
        threadId: "thread_abort",
        runId: "run_abort",
        forwardedProps: { mock: "simple-text" },
      }),
    });
    controller.abort();
    await pending.catch(() => undefined);
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { ok?: boolean };
    assert.equal(healthBody.ok, true);
  });

  it("does not crash when the SSE client disconnects mid-stream", async () => {
    const app = createApp(createA2UIServer({ agent: createMockAgent() }), { intervalMs: 40 });
    const slowServer = http.createServer(app.callback());
    await new Promise<void>((resolve) => {
      slowServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = slowServer.address();
    if (!address || typeof address === "string") {
      throw new Error("no listen port");
    }
    const slowUrl = `http://127.0.0.1:${address.port}`;
    const controller = new AbortController();
    try {
      const response = await fetch(`${slowUrl}/v1/generate?sse=1&mock=nested-column`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        signal: controller.signal,
        body: JSON.stringify({
          threadId: "thread_mid",
          runId: "run_mid",
          forwardedProps: { mock: "nested-column" },
        }),
      });
      assert.equal(response.status, 200);
      const reader = response.body?.getReader();
      assert.ok(reader);
      await reader.read();
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const health = await fetch(`${slowUrl}/health`);
      assert.equal(health.status, 200);
    } finally {
      controller.abort();
      await new Promise<void>((resolve, reject) => {
        slowServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("emits ACTIVITY_SNAPSHOT as agent.stream yields, without calling generate", async () => {
    const agent = {
      kind: "test-stream",
      async generate() {
        throw new Error("generate should not run for streamed SSE");
      },
      async *stream() {
        yield { type: "delta" as const, text: '{"beginRendering"' };
        yield { beginRendering: { surfaceId: "s", root: "root", catalogId: "c" } };
        yield {
          surfaceUpdate: {
            surfaceId: "s",
            components: [{ id: "root", component: { Text: { text: { literalString: "streamed" } } } }],
          },
        };
      },
    };
    const app = createApp(createA2UIServer({ agent }), { intervalMs: 0 });
    const streamServer = http.createServer(app.callback());
    await new Promise<void>((resolve) => {
      streamServer.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = streamServer.address();
      if (!address || typeof address === "string") {
        throw new Error("no listen port");
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/generate?sse=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          threadId: "thread_stream",
          runId: "run_stream",
          messages: [{ id: "msg_1", role: "user", content: "流式" }],
        }),
      });
      const events = parseAgUiSse(await response.text());
      assert.equal(events.some((item) => item.type === "MODEL_DELTA" && item.delta === '{"beginRendering"'), true);
      const snapshots = events.filter((item) => item.type === "ACTIVITY_SNAPSHOT");
      assert.equal(snapshots.length, 2);
      assert.equal(
        (snapshots[1] as { content?: { a2ui_messages?: Array<{ surfaceUpdate?: { components?: Array<{ component?: { Text?: { text?: { literalString?: string } } } }> } }> } })
          .content?.a2ui_messages?.[0]?.surfaceUpdate?.components?.[0]?.component?.Text?.text?.literalString,
        "streamed",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        streamServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns JSON error when sse=0 and the user message is missing", async () => {
    const response = await fetch(`${baseUrl}/v1/generate?sse=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "thread_json_err", runId: "run_json_err", messages: [] }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "MESSAGE_REQUIRED");
  });
});

describe("wantsSse", () => {
  it("defaults to SSE and treats 0/false as JSON", () => {
    assert.equal(wantsSse({}), true);
    assert.equal(wantsSse({ sse: "1" }), true);
    assert.equal(wantsSse({ sse: "true" }), true);
    assert.equal(wantsSse({ sse: "" }), true);
    assert.equal(wantsSse({ sse: "0" }), false);
    assert.equal(wantsSse({ sse: "false" }), false);
    assert.equal(wantsSse({ sse: "off" }), false);
  });
});
