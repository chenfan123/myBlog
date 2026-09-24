import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashscopeNativeOrigin,
  nativeImageSize,
  parseImageGenerationResponse,
  parseNativeTaskResult,
  parseNativeTaskSubmit,
  readGeneratePrompt,
  sizeForUsageHint,
  usesCompatibleImageApi,
} from "../src/agent/image-generate";

describe("image generate helpers", () => {
  it("reads generate: prompts and usage sizes", () => {
    assert.equal(readGeneratePrompt("generate:杭州晴天"), "杭州晴天");
    assert.equal(readGeneratePrompt("  扁平插画  "), "扁平插画");
    assert.equal(sizeForUsageHint("header"), "1280x720");
    assert.equal(sizeForUsageHint("avatar"), "512x512");
    assert.equal(sizeForUsageHint("mediumFeature"), "1024x1024");
  });

  it("parses url and base64 image payloads", () => {
    assert.equal(
      parseImageGenerationResponse({ data: [{ url: "https://example.com/a.png" }] }),
      "https://example.com/a.png",
    );
    assert.equal(
      parseImageGenerationResponse({ data: [{ b64_json: "abc" }] }),
      "data:image/png;base64,abc",
    );
    assert.throws(() => parseImageGenerationResponse({ data: [] }), /did not return a url/);
  });

  it("routes qwen-image-plus to native async sizes", () => {
    assert.equal(usesCompatibleImageApi("qwen-image-3.0"), true);
    assert.equal(usesCompatibleImageApi("qwen-image-plus"), false);
    assert.equal(nativeImageSize("1280x720"), "1664*928");
    assert.equal(nativeImageSize("512x512"), "1328*1328");
    assert.equal(
      dashscopeNativeOrigin("https://dashscope.aliyuncs.com/compatible-mode/v1"),
      "https://dashscope.aliyuncs.com",
    );
    assert.equal(parseNativeTaskSubmit({ output: { task_id: "task-1" } }), "task-1");
    assert.equal(parseNativeTaskResult({ output: { task_status: "RUNNING" } }), "pending");
    assert.equal(
      parseNativeTaskResult({ output: { task_status: "SUCCEEDED", results: [{ url: "https://cdn.example/a.png" }] } }),
      "https://cdn.example/a.png",
    );
  });
});
