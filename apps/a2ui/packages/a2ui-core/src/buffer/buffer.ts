/**
 * A2UI JSON 流缓冲区。
 *
 * parser 只吃完整的 JSONL：一行恰好一个 JSON 对象，且必须是
 * beginRendering / surfaceUpdate / dataModelUpdate / deleteSurface 之一。
 * 真实流（或 playground 模拟）往往按字节切开，一块里可能只有半个对象，
 * 也可能一次拿到 JSON 数组、多条 JSONL、或对象首尾相接。
 *
 * 本模块负责：
 * 1. 把分片拼进 pending
 * 2. 跳过数组括号、逗号、空白，用括号匹配抽出完整 `{...}`
 * 3. 把抽出的对象补成可 parse 的 JSONL（一行一条消息）
 * 4. surfaceUpdate 若带多个 component，拆成多条独立的 surfaceUpdate JSONL
 * 5. 每凑齐一行立刻 parse()，由 SDK 决定何时 renderTree
 *
 * 不完整的对象留在 pending，等下一块；抽不出对象时不调用 parse。
 */
import { parse } from "../parser/index.js";

/**
 * 对象与对象之间允许出现的分隔符。
 * JSON 数组里的 `[` `]` `,` 和 JSONL 里的换行都当噪声丢掉，只关心 `{...}` 消息体。
 */
const NOISE = new Set([" ", "\n", "\r", "\t", ",", "[", "]"]);

/** playground 模拟完整 JSON 流时，每块字符数。 */
export const JSON_STREAM_CHUNK_SIZE = 50;

/** playground 模拟完整 JSON 流时，两块之间的间隔。 */
export const JSON_STREAM_INTERVAL_MS = 50;

/**
 * 把完整 JSON 文本切成固定长度的块，给测试和 playground 模拟分片输出。
 * size <= 0 时不切，整段当作一块（空串仍返回空数组）。
 */
export function chunkText(source: string, size = JSON_STREAM_CHUNK_SIZE): string[] {
  if (size <= 0) {
    return source ? [source] : [];
  }

  const chunks: string[] = [];
  for (let index = 0; index < source.length; index += size) {
    chunks.push(source.slice(index, index + size));
  }
  return chunks;
}

/**
 * 把一条已抽出的 A2UI 消息补成可交给 parse() 的 JSONL（每行一个 JSON）。
 *
 * - beginRendering / dataModelUpdate / deleteSurface：JSON.stringify 成一行即可
 * - surfaceUpdate：协议允许 components 数组里有多个组件；parser 也能吃，
 *   但流式渲染要求「一条 JSONL = 一个组件」。这里按 component 拆开，
 *   每条都补全为带 surfaceId 和单元素 components 的完整 surfaceUpdate。
 * - 不是对象、或 surfaceUpdate 形态不完整：无法补协议，返回空数组或原样一行
 *
 * JSON.stringify 本身不会换行，所以产出一定是合法 JSONL 行。
 */
export function toProtocolJsonl(message: unknown): string[] {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return [];
  }

  // 非 surfaceUpdate：一条消息一行
  if (!("surfaceUpdate" in message)) {
    return [JSON.stringify(message)];
  }

  const update = (message as { surfaceUpdate: unknown }).surfaceUpdate;
  if (typeof update !== "object" || update === null) {
    return [JSON.stringify(message)];
  }

  const surfaceId = (update as { surfaceId?: unknown }).surfaceId;
  const components = (update as { components?: unknown }).components;
  if (!Array.isArray(components) || components.length === 0) {
    return [JSON.stringify(message)];
  }

  // 每个 component 单独包一层 surfaceUpdate，便于流式逐条推送
  return components.map((component) =>
    JSON.stringify({
      surfaceUpdate: {
        surfaceId,
        components: [component],
      },
    }),
  );
}

/**
 * 流式缓冲区：反复 push 分片，内部攒 pending，抽出完整对象后再 parse。
 * 一次 push 可能产出 0 条（对象还没闭合）或多条（一块里结束了好几个对象）。
 */
export class A2UIStreamBuffer {
  /** 尚未形成完整 `{...}` 的尾巴，含半截 key、字符串、嵌套对象等。 */
  #pending = "";

  /** 当前未解析完的缓冲，测试里用来断言「分片不够时不会 parse」。 */
  get pending(): string {
    return this.#pending;
  }

  /**
   * 追加一块文本。
   * 循环：能抽出完整对象 → 补 JSONL → parse；抽不出就停下等下一块。
   * 返回值：
   * - jsonl：本次新产出的协议行（已按 component 拆开）
   * - tree：最后一次 parse() 返回的组件树；本次没有完整消息则为 null
   */
  push(chunk: string): { jsonl: string[]; tree: unknown } {
    this.#pending += chunk;
    const jsonl: string[] = [];
    let tree: unknown = null;

    while (true) {
      const extracted = extractNextObject(this.#pending);
      if (!extracted) {
        // 没有完整对象（或只剩噪声），留给后续分片
        break;
      }

      this.#pending = extracted.rest;
      if (extracted.invalid) {
        // 括号配平了但 JSON.parse 失败：丢掉这段，避免死循环卡在同一段上
        continue;
      }
      const lines = toProtocolJsonl(extracted.value);
      for (const line of lines) {
        jsonl.push(line);
        // 一行一条消息，parse 结束会 treebuild 并调用 renderTree
        tree = parse(line);
      }
    }

    // 对象之间的 `]` `,` 空白等此时已无用，清掉以免一直堆在 pending 里
    this.#pending = drainNoise(this.#pending);
    return { jsonl, tree };
  }
}

/** 去掉开头的数组括号、逗号、空白，返回剩下的正文（可能仍是半个 `{`）。 */
function drainNoise(source: string): string {
  return source.slice(skipNoise(source, 0));
}

/** 从 from 起跳过 NOISE，返回第一个非噪声下标；全是噪声则返回 source.length。 */
function skipNoise(source: string, from: number): number {
  let index = from;
  while (index < source.length && NOISE.has(source[index] ?? "")) {
    index += 1;
  }
  return index;
}

/**
 * 从缓冲头部取出下一个完整 JSON 对象。
 *
 * 返回 null：还没有以 `{` 开头的完整对象（数据不够，或只剩噪声）。
 * invalid=true：配对括号找齐了，但内容不是合法 JSON，调用方应丢弃 rest 之前的那段。
 * invalid=false：value 是 JSON.parse 后的对象，rest 是对象结束符之后的剩余文本。
 */
function extractNextObject(
  source: string,
): { value: unknown; rest: string; invalid: boolean } | null {
  const start = skipNoise(source, 0);
  // A2UI 消息一定是对象；数字/字符串/数组本身不是一条协议，等更多数据或当作未完成
  if (start >= source.length || source[start] !== "{") {
    return null;
  }

  const end = findJsonObjectEnd(source, start);
  if (end === null) {
    // `{` 已出现但 `}` 还没配平，分片切断在对象中间
    return null;
  }

  const raw = source.slice(start, end + 1);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { value: undefined, rest: source.slice(end + 1), invalid: true };
  }

  return { value, rest: source.slice(end + 1), invalid: false };
}

/**
 * 从 start（必须是 `{`）扫描到与之配对的 `}` 的下标。
 *
 * 只数不在 JSON 字符串里的花括号：字符串内的 `{` `}` 和 `\"` 转义不能改变深度。
 * 扫到末尾仍未回到深度 0 → 对象不完整，返回 null。
 */
function findJsonObjectEnd(source: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        // 上一个字符是反斜杠，当前字符无论是 `"` 还是 `{` 都只是字面量
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}
