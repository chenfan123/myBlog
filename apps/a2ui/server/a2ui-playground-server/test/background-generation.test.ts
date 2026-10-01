import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { A2UIServer } from "../src/a2ui-server";
import { createApp } from "../src/app";

test("profile returns fallback immediately while generation continues in background", async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "a2ui-profile-cache-"));
  const previousCacheDirectory = process.env.A2UI_CACHE_DIR;
  process.env.A2UI_CACHE_DIR = cacheDirectory;
  let failStream = false;
  const a2ui: A2UIServer = {
    async generate() {
      await delay(100);
      return {
        surfaceId: "profile-home",
        catalogId: "a2ui-react:v0.8",
        prompt: "profile",
        modelMessages: [],
        messages: [{ beginRendering: { surfaceId: "profile-home", root: "root" } }],
        jsonl: "",
        updatedAt: new Date().toISOString(),
      };
    },
    async *stream() {
      if (failStream) throw new Error("model unavailable");
      yield { event: "a2ui" as const, data: { beginRendering: { surfaceId: "profile-home", root: "root" } } };
      await delay(20);
      const messages = [
        { beginRendering: { surfaceId: "profile-home", root: "root" } },
        { surfaceUpdate: { surfaceId: "profile-home", components: [{ id: "root", component: { Column: { children: [] } } }] } },
      ];
      yield { event: "a2ui" as const, data: messages[1] };
      yield {
        event: "done" as const,
        data: {
          surfaceId: "profile-home",
          catalogId: "a2ui-react:v0.8",
          modelMessages: messages,
          messages,
        },
      };
    },
    getSurface() {
      return undefined;
    },
  };
  const server = http.createServer(createApp(a2ui).callback());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/profile`;
  const request = () => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "陈健华", role: "工程师" }),
  });

  try {
    const first = await request();
    const firstBody = await first.json() as { fallback?: boolean; generating?: boolean };
    assert.equal(first.status, 202);
    assert.equal(firstBody.fallback, true);
    assert.equal(firstBody.generating, true);

    await delay(150);
    const second = await request();
    const secondBody = await second.json() as { fallback?: boolean; cached?: boolean };
    assert.equal(second.status, 200);
    assert.equal(secondBody.fallback, undefined);
    assert.equal(secondBody.cached, true);

    const streamed = await fetch(`${url}?sse=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ name: "陈健华", role: "设计师" }),
    });
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get("content-type") ?? "", /text\/event-stream/);
    const streamBody = await streamed.text();
    assert.match(streamBody, /"type":"A2UI_MESSAGE"/);
    assert.match(streamBody, /"type":"A2UI_DONE"/);
    assert.ok(streamBody.indexOf("A2UI_MESSAGE") < streamBody.indexOf("A2UI_DONE"));

    failStream = true;
    const failedGeneration = await fetch(`${url}?sse=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ name: "陈健华", role: "新的职位" }),
    });
    const fallbackBody = await failedGeneration.text();
    assert.match(fallbackBody, /"previousVersion":true/);
    assert.match(fallbackBody, /"type":"A2UI_DONE"/);
    assert.doesNotMatch(fallbackBody, /"type":"A2UI_ERROR"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousCacheDirectory === undefined) delete process.env.A2UI_CACHE_DIR;
    else process.env.A2UI_CACHE_DIR = previousCacheDirectory;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
