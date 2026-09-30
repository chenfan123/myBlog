import assert from "node:assert/strict";
import test from "node:test";

import { A2UIServerError } from "../src/a2ui-server";
import { retryGeneration } from "../src/app";

test("generation retries transient failures and returns the successful result", async () => {
  let calls = 0;
  const result = await retryGeneration(
    async () => {
      calls += 1;
      if (calls < 3) throw new A2UIServerError(502, "AGENT_UNAVAILABLE", "upstream reset");
      return "ready";
    },
    { attempts: 3, delayMs: 0 },
  );

  assert.equal(result, "ready");
  assert.equal(calls, 3);
});

test("generation does not retry permanent authentication or quota failures", async () => {
  let calls = 0;
  await assert.rejects(
    retryGeneration(
      async () => {
        calls += 1;
        throw new A2UIServerError(502, "AGENT_UNAVAILABLE", "403 Free quota exhausted");
      },
      { attempts: 3, delayMs: 0 },
    ),
    /quota exhausted/,
  );

  assert.equal(calls, 1);
});
