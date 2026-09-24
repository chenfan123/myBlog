import { DEFAULT_CATALOG_ID, type A2UIMessage } from "../a2ui-server/protocol";
import type { AgentImage } from "./images";

export type { AgentImage } from "./images";
export type { A2UIMessage };

export interface GenerateA2UIInput {
  message: string;
  surfaceId: string;
  catalogId?: string;
  images?: AgentImage[];
  /** 此前用户说过的话（不含本轮）。 */
  history?: string[];
  /** 当前已上屏的 A2UI 协议，后续轮据此微调。 */
  currentMessages?: A2UIMessage[];
  /** 上一轮树未闭环时，只补缺失节点。 */
  continuation?: {
    alreadyEmitted: string;
    missingIds: string[];
  };
}

export interface GenerateA2UIResult {
  messages?: A2UIMessage[];
  raw?: string;
}

export interface AgentStreamDelta {
  type: "delta";
  text: string;
}

export type AgentStreamChunk = A2UIMessage | AgentStreamDelta;

export interface A2UIAgent {
  readonly kind: string;
  generate(input: GenerateA2UIInput): Promise<GenerateA2UIResult>;
  stream?(input: GenerateA2UIInput): AsyncIterable<AgentStreamChunk>;
}

export { DEFAULT_CATALOG_ID };
