import assert from "node:assert/strict";
import test from "node:test";

import { buildProfilePrompt, buildProfileProtocol, normalizeProfileInput } from "../src/profile";

test("normalizes profile data and removes unsupported values", () => {
  const profile = normalizeProfileInput({
    name: "  陈健华  ",
    role: "全栈开发工程师",
    introduction: "专注现代 Web 应用与智能应用研发",
    phone: "15158016432",
    email: "chen@example.com",
    skillGroups: [
      { title: "前端", skills: ["React", "TypeScript", 42, ""] },
      { title: "", skills: ["ignored"] },
      null,
    ],
  });

  assert.deepEqual(profile, {
    name: "陈健华",
    role: "全栈开发工程师",
    introduction: "专注现代 Web 应用与智能应用研发",
    phone: "15158016432",
    email: "chen@example.com",
    availability: "开放机会",
    skillGroups: [{ title: "前端", skills: ["React", "TypeScript"] }],
  });
});

test("profile prompt fixes the layout contract and preserves provided facts", () => {
  const profile = normalizeProfileInput({
    name: "陈健华",
    role: "前端开发工程师 / Agent 开发工程师",
    introduction: "重视工程质量和实际业务价值",
    phone: "15158016432",
    email: "chen@example.com",
    availability: "正在寻找新的工作机会",
    skillGroups: [{ title: "Agent", skills: ["LangGraph", "RAG"] }],
  });
  const prompt = buildProfilePrompt(profile);

  assert.match(prompt, /A2UI v0\.8/);
  assert.match(prompt, /不得修改姓名、电话、邮箱、履历或自行补充事实/);
  assert.match(prompt, /不要生成头像、导航栏、表单、弹窗、图片或整页背景/);
  assert.match(prompt, /最多生成 20 个组件/);
  assert.match(prompt, /禁止把每项技术拆成独立组件/);
  assert.match(prompt, /陈健华/);
  assert.match(prompt, /LangGraph/);
});

test("builds a compact deterministic A2UI profile fallback", () => {
  const profile = normalizeProfileInput({
    name: "陈健华",
    role: "Agent 开发工程师",
    introduction: "重视工程质量",
    phone: "15158016432",
    email: "chen@example.com",
    skillGroups: [{ title: "Agent", skills: ["LangGraph", "RAG"] }],
  });
  const messages = buildProfileProtocol(profile);
  const serialized = JSON.stringify(messages);

  assert.ok(messages.length <= 20);
  assert.match(serialized, /陈健华/);
  assert.match(serialized, /LangGraph · RAG/);
  assert.match(serialized, /a2ui-react:v0\.8/);
});
