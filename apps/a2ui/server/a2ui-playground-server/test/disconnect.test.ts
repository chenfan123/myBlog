import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDisconnectError } from "../src/ag-ui";

describe("isDisconnectError", () => {
  it("recognizes EPIPE by code, errno, or message", () => {
    assert.equal(isDisconnectError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), true);
    assert.equal(isDisconnectError(Object.assign(new Error("write EPIPE"), { errno: -32 })), true);
    assert.equal(isDisconnectError(new Error("write EPIPE")), true);
    assert.equal(isDisconnectError({ code: "ECONNRESET" }), true);
    assert.equal(isDisconnectError(new Error("socket hang up")), true);
    assert.equal(isDisconnectError(new Error("boom")), false);
  });
});
