import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PersistentCache } from "../src/persistent-cache";

test("persistent cache keeps the last successful payload even after logical expiry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2ui-cache-"));
  try {
    const cache = new PersistentCache(directory);
    const record = {
      key: "profile-key",
      input: { name: "陈健华" },
      expiresAt: Date.now() - 1,
      payload: { converted: [{ beginRendering: { surfaceId: "profile-home" } }] },
    };
    await cache.set("profile", record);

    assert.deepEqual(await cache.get("profile", record.key), record);
    assert.deepEqual(await cache.list("profile"), [record]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

