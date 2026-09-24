import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { buildAgentSystemPrompt, promptTemplatePaths } from "../src/agent/prompt";

describe("buildAgentSystemPrompt", () => {
  it("loads docs materials and prompt templates", () => {
    const paths = promptTemplatePaths();
    for (const file of [...paths.templates, ...paths.materials]) {
      assert.equal(existsSync(file), true, file);
    }
  });

  it("assembles surfaceId, schema, catalog, and local-action rules", () => {
    const prompt = buildAgentSystemPrompt({ surfaceId: "surface-test", catalogId: "a2ui-react:v0.8" });
    assert.match(prompt, /surface-test/);
    assert.match(prompt, /a2ui-react:v0\.8/);
    assert.match(prompt, /beginRendering/);
    assert.match(prompt, /"Empty"/);
    assert.match(prompt, /Card\.child/);
    assert.match(prompt, /__localUpdatePath/);
    assert.match(prompt, /openLink/);
    assert.match(prompt, /beginRendering\.styles/);
    assert.match(prompt, /theme"\s*:\s*"apple/);
    assert.match(prompt, /JSONL/);
    assert.match(prompt, /完整页面|完整界面/);
    assert.match(prompt, /3～5/);
    assert.match(prompt, /"beginRendering"/);
    assert.match(prompt, /树必须闭环|闭环/);
    assert.match(prompt, /禁止半截|半截/);
    assert.match(prompt, /微调/);
    assert.match(prompt, /多轮/);
    assert.match(prompt, /禁止另起|不要换 `root`|沿用原 root/);
    assert.match(prompt, /改\/增\/删组件必须用 `surfaceUpdate`|改\/增组件用 `surfaceUpdate`/);
    assert.match(prompt, /Image[\s\S]*prompt|prompt[\s\S]*DASHSCOPE_MODEL/);
    assert.match(prompt, /formFactor/);
    assert.match(prompt, /默认.*mobile|formFactor": "mobile"/);
    assert.match(prompt, /desktop/);
    assert.doesNotMatch(prompt, /\{\{\w+\}\}/);
  });
});
