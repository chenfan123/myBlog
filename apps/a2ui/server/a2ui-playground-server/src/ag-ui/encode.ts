import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { AgUiEvent } from "./types";

const guardedSockets = new WeakSet<Socket>();

/** AG-UI SSE：每条事件一行 `data: {json}`，type 在 JSON 里，不用自定义 event 名。 */
export function encodeAgUiEvent(event: AgUiEvent): string {
  return `data: ${JSON.stringify({ timestamp: Date.now(), ...event })}\n\n`;
}

export function isDisconnectError(error: unknown): boolean {
  if (error == null) {
    return false;
  }
  const record = error as { code?: unknown; errno?: unknown; message?: unknown };
  const code = String(record.code ?? "");
  const message = error instanceof Error ? error.message : String(record.message ?? error);
  const errno = Number(record.errno);
  return (
    code === "EPIPE" ||
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    code === "ERR_STREAM_DESTROYED" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    errno === -32 ||
    errno === -54 ||
    errno === -104 ||
    /EPIPE|ECONNRESET|ECONNABORTED|socket hang up/i.test(message)
  );
}

function responseClosed(res: ServerResponse): boolean {
  const socket = res.socket;
  return Boolean(
    !res.writable ||
      res.writableEnded ||
      res.destroyed ||
      socket?.destroyed ||
      socket?.writable === false,
  );
}

/**
 * Node 在 cork/uncork 之后才真正 writev，EPIPE 打在 socket 上而不是 res.write()。
 * 每个 socket 只挂一次，避免 keep-alive 重复监听。
 */
export function guardSocketDisconnect(socket: Socket | undefined): void {
  if (!socket || guardedSockets.has(socket)) {
    return;
  }
  guardedSockets.add(socket);
  socket.on("error", (error) => {
    if (!isDisconnectError(error)) {
      console.error(error);
    }
  });
}

/** 客户端已断开时返回 false，避免继续往已关闭的连接写。 */
export function writeSseJson(res: ServerResponse, event: Record<string, unknown>): boolean {
  if (responseClosed(res)) {
    return false;
  }
  try {
    const ok = res.write(`data: ${JSON.stringify({ timestamp: Date.now(), ...event })}\n\n`, (error) => {
      if (error && !isDisconnectError(error)) {
        console.error(error);
      }
    });
    const flushable = res as ServerResponse & { flush?: () => void };
    flushable.flush?.();
    return ok;
  } catch (error) {
    if (isDisconnectError(error)) {
      return false;
    }
    throw error;
  }
}

export function writeAgUiEvent(res: ServerResponse, event: AgUiEvent): boolean {
  return writeSseJson(res, event as unknown as Record<string, unknown>);
}

/** 正常结束响应。已断开时不要 end()，否则 uncork 还会再写一次并打出 EPIPE。 */
export function endIfOpen(res: ServerResponse): void {
  if (responseClosed(res)) {
    return;
  }
  try {
    res.end();
  } catch (error) {
    if (!isDisconnectError(error)) {
      throw error;
    }
  }
}

export function destroyResponse(res: ServerResponse): void {
  try {
    if (!res.destroyed) {
      res.destroy();
    }
  } catch {
    // 断开后的 destroy 可以忽略
  }
}

export function bindResponseDisconnect(req: IncomingMessage, res: ServerResponse, onDisconnect: () => void): void {
  guardSocketDisconnect(req.socket);
  const onError = (error: unknown) => {
    if (isDisconnectError(error)) {
      onDisconnect();
    }
  };
  req.on("error", onError);
  res.on("error", onError);
  req.socket.on("error", onError);
}

export function installProcessDisconnectGuard(): void {
  const swallow = (error: unknown) => isDisconnectError(error);
  process.on("uncaughtException", (error) => {
    if (swallow(error)) {
      return;
    }
    console.error(error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    if (swallow(reason)) {
      return;
    }
    console.error(reason);
  });
}
