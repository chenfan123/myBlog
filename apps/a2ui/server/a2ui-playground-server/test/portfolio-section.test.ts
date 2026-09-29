import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioSectionPrompt,
  normalizePortfolioSection,
} from "../src/portfolio-section";

test("normalizes agent links and keeps only internal routes", () => {
  const section = normalizePortfolioSection({
    kind: "agents",
    title: "Agent 实现",
    items: [
      { title: "导诊 Agent", tags: ["RAG", 42], demo_url: "/agent-demo/medical-triage" },
      { title: "外链", demo_url: "https://example.com" },
    ],
  });

  assert.deepEqual(section.items, [
    { title: "导诊 Agent", description: "", tags: ["RAG"], status: "", demoUrl: "/agent-demo/medical-triage" },
    { title: "外链", description: "", tags: [], status: "", demoUrl: "" },
  ]);
});

test("builds a creative but fact-bound experience prompt", () => {
  const section = normalizePortfolioSection({
    kind: "experiences",
    title: "工作经历",
    items: [{ company: "示例公司", role: "工程师", time: "2024 — 至今", achievements: ["性能提升 30%"] }],
  });
  const prompt = buildPortfolioSectionPrompt(section);

  assert.match(prompt, /现代编辑式履历时间线/);
  assert.match(prompt, /不得杜撰或夸大/);
  assert.match(prompt, /示例公司/);
  assert.match(prompt, /性能提升 30%/);
});
