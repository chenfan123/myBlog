export type RenderProps = Record<string, unknown>;

/** 组件名 → 渲染函数。由 a2ui-react 等宿主提供，core 不依赖 React。 */
export type RenderFn = (props: RenderProps) => unknown;

export type RenderMap = Record<string, RenderFn>;

/**
 * 把组装好的组件树交给宿主挂载（playground 里是 createRoot().render）。
 * 何时调用由 SDK 决定，宿主只负责怎么画。
 */
export type RenderTreeFn = (tree: unknown) => void;

/** 协议 userAction 回调：解析 context 之后交给宿主（playground / agent）。 */
export type OnUserActionFn = (payload: import("../datamodel/types.js").UserActionPayload) => void;

export interface InitOptions {
  renderMap?: RenderMap;
  renderTree?: RenderTreeFn;
  onUserAction?: OnUserActionFn;
}
