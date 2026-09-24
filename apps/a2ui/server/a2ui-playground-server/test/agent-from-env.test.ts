import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createAgentFromEnv } from "../src/agent";
import { createChatFromEnv } from "../src/chat/openai-chat";
import { dashscopeImageModel, dashscopeTextModel } from "../src/env";

const KEYS = [
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_API_BASE",
  "DASHSCOPE_MODEL",
  "DASHSCOPE_MODEL2",
  "DASHSCOPE_IMAGE_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("createAgentFromEnv", () => {
  it("uses mock when no LLM key is set", () => {
    for (const key of KEYS) {
      delete process.env[key];
    }
    assert.equal(createAgentFromEnv().kind, "mock");
  });

  it("uses dashscope when DASHSCOPE_API_KEY is set", () => {
    for (const key of KEYS) {
      delete process.env[key];
    }
    process.env.DASHSCOPE_API_KEY = "sk-test";
    process.env.DASHSCOPE_API_BASE = "https://example.invalid/v1";
    process.env.DASHSCOPE_MODEL = "qwen3.8-omni-flash";
    process.env.DASHSCOPE_MODEL2 = "qwen3.8-flash";
    assert.equal(createAgentFromEnv().kind, "dashscope");
    assert.equal(dashscopeTextModel(), "qwen3.8-flash");
    assert.equal(dashscopeImageModel(), "qwen-image-plus");
    assert.equal(createChatFromEnv()?.model, "qwen3.8-flash");
  });

  it("uses DASHSCOPE_MODEL for images when it is an image model", () => {
    for (const key of KEYS) {
      delete process.env[key];
    }
    process.env.DASHSCOPE_MODEL = "qwen-image-plus";
    assert.equal(dashscopeImageModel(), "qwen-image-plus");
  });

  it("uses DASHSCOPE_IMAGE_MODEL when set", () => {
    for (const key of KEYS) {
      delete process.env[key];
    }
    process.env.DASHSCOPE_MODEL = "qwen3.8-omni-flash";
    process.env.DASHSCOPE_IMAGE_MODEL = "qwen-image-3.0-pro";
    assert.equal(dashscopeImageModel(), "qwen-image-3.0-pro");
  });
});
