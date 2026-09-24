import type { IncomingMessage } from "node:http";
import Koa from "koa";
import cors from "@koa/cors";
import Router from "@koa/router";
import { A2UIServerError, type A2UIServer } from "./a2ui-server";
import { sseHeaders, sleep } from "./a2ui-server/sse";
import { loadLocalMock } from "./agent/local-mocks";
import {
  AG_UI_EVENT,
  bindResponseDisconnect,
  destroyResponse,
  endIfOpen,
  guardSocketDisconnect,
  isDisconnectError,
  parseRunRequest,
  wantsSse,
  writeAgUiEvent,
  writeSseJson,
} from "./ag-ui";
import type { A2UIMessage } from "./a2ui-server/protocol";
import type { ActivitySnapshotEvent, RunAgentInput } from "./ag-ui/types";
import { parseChatTurns, type ChatClient, type ChatTurn } from "./chat/openai-chat";
import { generateDashscopeImage, readGeneratePrompt, sizeForUsageHint } from "./agent/image-generate";
import { parseAgentImages } from "./agent/images";
import { dashscopeImageModel } from "./env";
import { buildProfilePrompt, buildProfileProtocol, normalizeProfileInput } from "./profile";

export interface CreateAppOptions {
  intervalMs?: number;
  chat?: ChatClient;
}

const PROFILE_GENERATION_TIMEOUT_MS = 90_000;

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new A2UIServerError(504, "PROFILE_GENERATION_TIMEOUT", "profile generation timed out")),
      timeoutMs,
    ) as unknown as number;
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createApp(server: A2UIServer, options: CreateAppOptions = {}): Koa {
  const intervalMs = options.intervalMs ?? Number(process.env.A2UI_SSE_INTERVAL_MS ?? 160);
  const chat = options.chat;
  const app = new Koa();
  const router = new Router();
  const profileCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
  const profilePending = new Map<string, Promise<void>>();
  const profileFailures = new Map<string, { expiresAt: number; error: A2UIServerError }>();

  app.use(cors());
  app.use(async (ctx, next) => {
    guardSocketDisconnect(ctx.req.socket);
    await next();
  });
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      const err =
        error instanceof A2UIServerError
          ? error
          : new A2UIServerError(500, "INTERNAL", error instanceof Error ? error.message : "internal error");
      ctx.status = err.status;
      ctx.body = { error: { code: err.code, message: err.message } };
    }
  });

  router.get("/health", (ctx) => {
    ctx.body = {
      ok: true,
      chat: chat ? { available: true, provider: chat.provider, model: chat.model } : { available: false },
      image: { model: dashscopeImageModel() },
    };
  });

  router.post("/v1/profile", async (ctx) => {
    let body: unknown;
    try {
      body = await readJsonBody(ctx.req);
    } catch {
      throw new A2UIServerError(400, "INVALID_JSON", "request body must be JSON");
    }
    const input = normalizeProfileInput(body);
    if (!input.name || !input.role) {
      throw new A2UIServerError(400, "PROFILE_REQUIRED", "name and role are required");
    }

    const key = JSON.stringify(input);
    const cached = profileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      ctx.body = { ...cached.payload, cached: true };
      return;
    }

    const failed = profileFailures.get(key);
    const retryBlocked = Boolean(failed && failed.expiresAt > Date.now());
    if (failed && !retryBlocked) profileFailures.delete(key);

    let pending = profilePending.get(key);
    if (!pending && !retryBlocked) {
      pending = withTimeout(
        server.generate({ message: buildProfilePrompt(input) }),
        Number(process.env.A2UI_PROFILE_GENERATION_TIMEOUT_MS ?? PROFILE_GENERATION_TIMEOUT_MS),
      )
        .then((generated) => {
          if (generated.incomplete) {
            throw new A2UIServerError(502, "PROFILE_INCOMPLETE", "generated profile protocol is incomplete");
          }
          const payload: Record<string, unknown> = {
            surfaceId: generated.surfaceId,
            catalogId: generated.catalogId,
            converted: generated.messages,
          };
          profileCache.set(key, {
            expiresAt: Date.now() + Number(process.env.A2UI_PROFILE_CACHE_MS ?? 21_600_000),
            payload,
          });
        })
        .catch((error: unknown) => {
          const failure =
            error instanceof A2UIServerError
              ? error
              : new A2UIServerError(502, "PROFILE_GENERATION_FAILED", error instanceof Error ? error.message : "profile generation failed");
          profileFailures.set(key, { expiresAt: Date.now() + 30_000, error: failure });
        })
        .finally(() => profilePending.delete(key));
      profilePending.set(key, pending);
    }
    // 先返回确定性 A2UI，避免通用 Agent 的长提示词阻塞首屏；模型成功后下次请求会命中上方缓存。
    ctx.body = {
      surfaceId: "profile-home",
      catalogId: "a2ui-react:v0.8",
      converted: buildProfileProtocol(input),
      cached: false,
      source: "template",
      refreshing: Boolean(pending),
    };
  });

  router.get("/v1/chat", (ctx) => {
    if (!chat) {
      throw new A2UIServerError(503, "CHAT_UNAVAILABLE", "OPENAI_API_KEY or DASHSCOPE_API_KEY is not set");
    }
    ctx.body = { ok: true, provider: chat.provider, model: chat.model };
  });

  router.post("/v1/chat", async (ctx) => {
    if (!chat) {
      throw new A2UIServerError(503, "CHAT_UNAVAILABLE", "OPENAI_API_KEY or DASHSCOPE_API_KEY is not set");
    }
    let payload: Record<string, unknown>;
    try {
      payload = await readJsonBody(ctx.req);
    } catch {
      throw new A2UIServerError(400, "INVALID_JSON", "request body must be JSON");
    }
    const turns = parseChatTurns(payload.messages);
    if (!turns.some((item) => item.role === "user" && item.content.trim())) {
      throw new A2UIServerError(400, "MESSAGE_REQUIRED", "messages must include a user turn");
    }
    if (wantsChatSse(ctx)) {
      await streamChatReply(ctx, chat, turns);
      return;
    }

    const reply = await chat.complete(turns);
    ctx.body = { reply, provider: chat.provider, model: chat.model };
  });

  router.post("/v1/images/generate", async (ctx) => {
    let payload: Record<string, unknown>;
    try {
      payload = await readJsonBody(ctx.req);
    } catch {
      throw new A2UIServerError(400, "INVALID_JSON", "request body must be JSON");
    }
    const prompt = readGeneratePrompt(typeof payload.prompt === "string" ? payload.prompt : "");
    const usageHint = typeof payload.usageHint === "string" ? payload.usageHint : undefined;
    const generated = await generateDashscopeImage({
      prompt,
      images: parseAgentImages(payload.images),
      size: typeof payload.size === "string" ? payload.size : sizeForUsageHint(usageHint),
    });
    ctx.body = generated;
  });

  router.get("/v1/surfaces/:surfaceId", (ctx) => {
    const surface = server.getSurface(ctx.params.surfaceId);
    if (!surface) {
      throw new A2UIServerError(404, "SURFACE_NOT_FOUND", "surface not found");
    }
    ctx.body = surface;
  });

  async function handleGenerate(ctx: Koa.Context) {
    let body: RunAgentInput | undefined;
    if (ctx.method !== "GET") {
      try {
        body = (await readJsonBody(ctx.req)) as RunAgentInput;
      } catch {
        throw new A2UIServerError(400, "INVALID_JSON", "request body must be JSON");
      }
    }

    const query = ctx.query as Record<string, unknown>;
    const run = parseRunRequest(body, query);

    if (run.mockId && !loadLocalMock(run.mockId)) {
      throw new A2UIServerError(404, "MOCK_NOT_FOUND", `unknown mock: ${run.mockId}`);
    }

    if (!wantsSse(query)) {
      const generated = await server.generate({
        message: run.message,
        surfaceId: run.surfaceId,
        mockId: run.mockId,
        images: run.images,
        history: run.history,
        currentMessages: run.currentMessages,
      });
      ctx.body = {
        threadId: run.threadId,
        runId: run.runId,
        surfaceId: generated.surfaceId,
        catalogId: generated.catalogId,
        modelOutput: { messages: generated.modelMessages },
        converted: generated.messages,
        ...(generated.incomplete ? { incomplete: generated.incomplete } : {}),
        events: [
          { type: AG_UI_EVENT.RUN_STARTED, threadId: run.threadId, runId: run.runId },
          activitySnapshot(run.threadId, generated.surfaceId, generated.catalogId, generated.messages, true),
          {
            type: AG_UI_EVENT.RUN_FINISHED,
            threadId: run.threadId,
            runId: run.runId,
            modelOutput: { messages: generated.modelMessages },
            converted: generated.messages,
            ...(generated.incomplete ? { incomplete: generated.incomplete } : {}),
          },
        ],
      };
      return;
    }

    ctx.respond = false;
    ctx.req.socket.setTimeout(0);
    let aborted = false;
    const markAborted = () => {
      if (aborted) {
        return;
      }
      aborted = true;
      destroyResponse(ctx.res);
    };
    ctx.req.on("close", markAborted);
    ctx.req.on("aborted", markAborted);
    bindResponseDisconnect(ctx.req, ctx.res, markAborted);
    ctx.req.socket.setNoDelay?.(true);
    ctx.res.writeHead(200, sseHeaders());
    ctx.res.flushHeaders?.();
    if (
      !writeAgUiEvent(ctx.res, {
        type: AG_UI_EVENT.RUN_STARTED,
        threadId: run.threadId,
        runId: run.runId,
      })
    ) {
      destroyResponse(ctx.res);
      return;
    }

    try {
      let surfaceId = "";
      let catalogId = "";
      let modelMessages: A2UIMessage[] = [];
      let converted: A2UIMessage[] = [];
      let incomplete: { missingIds: string[] } | undefined;

      for await (const event of server.stream({
        message: run.message,
        surfaceId: run.surfaceId,
        mockId: run.mockId,
        images: run.images,
        history: run.history,
        currentMessages: run.currentMessages,
      })) {
        if (aborted || !ctx.res.writable || ctx.res.writableEnded) {
          break;
        }
        if (event.event === "delta") {
          if (!writeAgUiEvent(ctx.res, { type: AG_UI_EVENT.MODEL_DELTA, delta: event.data.text })) {
            aborted = true;
            break;
          }
          continue;
        }
        if (event.event === "a2ui") {
          const action = Object.keys(event.data)[0];
          const payload = event.data[action] as { surfaceId?: string; catalogId?: string } | undefined;
          surfaceId = payload?.surfaceId ?? surfaceId;
          catalogId = payload?.catalogId ?? catalogId;
          if (
            !writeAgUiEvent(
              ctx.res,
              activitySnapshot(run.threadId, surfaceId, catalogId, [event.data], false),
            )
          ) {
            aborted = true;
            break;
          }
          if (intervalMs > 0) {
            await sleep(intervalMs);
          }
          continue;
        }
        if (event.event === "done") {
          surfaceId = event.data.surfaceId || surfaceId;
          catalogId = event.data.catalogId || catalogId;
          modelMessages = event.data.modelMessages;
          converted = event.data.messages;
          incomplete = event.data.incomplete;
        }
      }

      if (!aborted && ctx.res.writable && !ctx.res.writableEnded) {
        writeAgUiEvent(ctx.res, {
          type: AG_UI_EVENT.RUN_FINISHED,
          threadId: run.threadId,
          runId: run.runId,
          modelOutput: { messages: modelMessages },
          converted,
          ...(incomplete ? { incomplete } : {}),
        });
      }
    } catch (error) {
      if (aborted || isDisconnectError(error)) {
        return;
      }
      const err =
        error instanceof A2UIServerError
          ? error
          : new A2UIServerError(500, "INTERNAL", error instanceof Error ? error.message : "internal error");
      writeAgUiEvent(ctx.res, {
        type: AG_UI_EVENT.RUN_ERROR,
        message: err.message,
        code: err.code,
      });
    } finally {
      if (aborted) {
        destroyResponse(ctx.res);
      } else {
        endIfOpen(ctx.res);
      }
    }
  }

  router.get("/v1/generate", handleGenerate);
  router.post("/v1/generate", handleGenerate);

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

/** 对话 SSE 必须显式开启：Accept: text/event-stream 或 ?sse=1，默认仍返回 JSON。 */
function wantsChatSse(ctx: Koa.Context): boolean {
  const accept = String(ctx.get("Accept") ?? "");
  if (accept.includes("text/event-stream")) {
    return true;
  }
  const query = ctx.query as Record<string, unknown>;
  return "sse" in query && wantsSse(query);
}

async function streamChatReply(ctx: Koa.Context, chat: ChatClient, turns: ChatTurn[]): Promise<void> {
  ctx.respond = false;
  ctx.req.socket.setTimeout(0);
  const abort = new AbortController();
  let aborted = false;
  const markAborted = () => {
    if (aborted) {
      return;
    }
    aborted = true;
    abort.abort();
    destroyResponse(ctx.res);
  };
  ctx.req.on("close", markAborted);
  ctx.req.on("aborted", markAborted);
  bindResponseDisconnect(ctx.req, ctx.res, markAborted);
  ctx.res.writeHead(200, sseHeaders());
  ctx.res.flushHeaders?.();

  if (
    !writeSseJson(ctx.res, {
      type: "CHAT_STARTED",
      provider: chat.provider,
      model: chat.model,
    })
  ) {
    destroyResponse(ctx.res);
    return;
  }

  try {
    let reply = "";
    for await (const delta of chat.stream(turns, abort.signal)) {
      if (aborted || !ctx.res.writable || ctx.res.writableEnded) {
        break;
      }
      if (!delta) {
        continue;
      }
      reply += delta;
      if (!writeSseJson(ctx.res, { type: "CHAT_DELTA", delta })) {
        aborted = true;
        break;
      }
    }

    if (!aborted && ctx.res.writable && !ctx.res.writableEnded) {
      writeSseJson(ctx.res, {
        type: "CHAT_FINISHED",
        reply,
        provider: chat.provider,
        model: chat.model,
      });
    }
  } catch (error) {
    if (aborted || isDisconnectError(error)) {
      return;
    }
    const err =
      error instanceof A2UIServerError
        ? error
        : new A2UIServerError(500, "INTERNAL", error instanceof Error ? error.message : "internal error");
    writeSseJson(ctx.res, {
      type: "CHAT_ERROR",
      message: err.message,
      code: err.code,
    });
  } finally {
    if (aborted) {
      destroyResponse(ctx.res);
    } else {
      endIfOpen(ctx.res);
    }
  }
}

function activitySnapshot(
  threadId: string,
  surfaceId: string,
  catalogId: string,
  messages: A2UIMessage[],
  replace: boolean,
): ActivitySnapshotEvent {
  return {
    type: AG_UI_EVENT.ACTIVITY_SNAPSHOT,
    messageId: `a2ui-surface-${surfaceId || threadId}`,
    activityType: "a2ui-surface",
    replace,
    content: {
      version: "v0.8",
      surfaceId,
      catalogId,
      a2ui_messages: messages,
    },
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
