export const AG_UI_EVENT = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  ACTIVITY_SNAPSHOT: "ACTIVITY_SNAPSHOT",
  MODEL_DELTA: "MODEL_DELTA",
} as const;

export type AgUiEventType = (typeof AG_UI_EVENT)[keyof typeof AG_UI_EVENT];

export interface AgUiMessage {
  id?: string;
  role?: string;
  content?: unknown;
}

export interface RunAgentInput {
  threadId?: string;
  runId?: string;
  messages?: AgUiMessage[];
  tools?: unknown[];
  context?: unknown[];
  state?: unknown;
  forwardedProps?: Record<string, unknown>;
  message?: string;
  surfaceId?: string;
  mock?: string;
  images?: unknown;
  history?: string[];
  currentMessages?: unknown[];
}

export interface AgUiBaseEvent {
  type: AgUiEventType;
  timestamp?: number;
}

export interface RunStartedEvent extends AgUiBaseEvent {
  type: "RUN_STARTED";
  threadId: string;
  runId: string;
}

export interface RunFinishedEvent extends AgUiBaseEvent {
  type: "RUN_FINISHED";
  threadId: string;
  runId: string;
  /** 模型/mock 写作形态 `{ messages }`，尚未按 component 拆条。 */
  modelOutput?: { messages: unknown[] };
  /** 转换后的 JSONL 数组：一条 surfaceUpdate 一个 component。 */
  converted?: unknown[];
  /** 被引用但尚未定义的组件 id；缺省表示树已闭环。 */
  incomplete?: { missingIds: string[] };
}

export interface RunErrorEvent extends AgUiBaseEvent {
  type: "RUN_ERROR";
  message: string;
  code?: string;
}

export interface ActivitySnapshotEvent extends AgUiBaseEvent {
  type: "ACTIVITY_SNAPSHOT";
  messageId: string;
  activityType: "a2ui-surface";
  /** true：整份替换；false：只含本帧新增的 A2UI 消息。 */
  replace: boolean;
  content: {
    version: "v0.8";
    surfaceId: string;
    catalogId: string;
    a2ui_messages: unknown[];
  };
}

export interface ModelDeltaEvent extends AgUiBaseEvent {
  type: "MODEL_DELTA";
  delta: string;
}

export type AgUiEvent = RunStartedEvent | RunFinishedEvent | RunErrorEvent | ActivitySnapshotEvent | ModelDeltaEvent;
