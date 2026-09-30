import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { A2UIServer } from "../src/a2ui-server";
import { createApp } from "../src/app";

test("profile returns fallback immediately while generation continues in background", async () => {
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
    async *stream() {},
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
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
