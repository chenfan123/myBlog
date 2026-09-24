import type { SurfaceStyles } from "../style/types.js";
import type { VNode } from "../vnode/types.js";
import type { OnUserActionFn, RenderMap, RenderTreeFn } from "./render-map.js";

export type { InitOptions, OnUserActionFn, RenderFn, RenderMap, RenderProps, RenderTreeFn } from "./render-map.js";

export interface HydrateNode {
  componentId: string;
  v_node: VNode;
  ownerSurfaceId: string;
  protocol: string;
  /** 父组件 id；根节点没有。treebuild 根据 childIds 回填。 */
  parentId?: string;
  /** 协议 children.explicitList 里的子组件 id。List template 实例会改成该项自己的 id。 */
  childIds: string[];
  /**
   * 标记清除：新组件为 false（待播入场动画），动画结束后为 true。
   * parser 识别到尚未存在的 id 时写入 false；已存在的节点保持原值。
   */
  hasMounted: boolean;
  /** List/Column/Row children.template 克隆出来的实例，指向缓冲区里的模板组件 id。 */
  sourceComponentId?: string;
}

export interface Surface {
  surfaceId: string;
  beginRender: boolean;
  root?: string;
  rootNode?: HydrateNode;
  dataModel: Record<string, unknown>;
  /** beginRendering.styles，经 parseSurfaceStyles 清洗。缺省由宿主 CSS 兜底。 */
  styles?: SurfaceStyles;
}

export const ErrorType = {
  PARSE_ERROR: "PARSE_ERROR",
  UNREGISTERED_COMPONENT: "UNREGISTERED_COMPONENT",
} as const;

export type A2UIErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export interface A2UIError {
  id: string;
  type: A2UIErrorType;
  content: string;
}

export interface A2UIStoreState {
  /** 组件名 → render；init({ renderMap }) 写入，parser 从这里取来渲染 v_node。 */
  renderMap: RenderMap;
  /** 整棵组件树的挂载函数；init({ renderTree }) 写入，parse 结束后由 SDK 调用。 */
  renderTree?: RenderTreeFn;
  /** 用户操作回调；init({ onUserAction }) 写入，Button 等走 dispatchUserAction。 */
  onUserAction?: OnUserActionFn;
  surfaceMap: Record<string, Surface>;
  hydrateNodeMap: Record<string, HydrateNode>;
  errorMap: Record<string, A2UIError>;
}

export interface A2UIStoreActions {
  setRenderMap: (renderMap: RenderMap) => void;
  setRenderTree: (renderTree: RenderTreeFn | undefined) => void;
  setOnUserAction: (onUserAction: OnUserActionFn | undefined) => void;
  addSurface: (surface: Surface) => void;
  getSurface: (surfaceId: string) => Surface | undefined;
  updateSurface: (surfaceId: string, patch: Partial<Omit<Surface, "surfaceId">>) => void;
  deleteSurface: (surfaceId: string) => void;

  addHydrateNode: (node: HydrateNode) => void;
  getHydrateNode: (componentId: string) => HydrateNode | undefined;
  updateHydrateNode: (
    componentId: string,
    patch: Partial<Omit<HydrateNode, "componentId">>,
  ) => void;
  deleteHydrateNode: (componentId: string) => void;
  /** 入场动画结束：把 hydrateNode.hasMounted 置为 true。 */
  markHydrateNodeMounted: (componentId: string) => void;

  addError: (error: A2UIError) => void;
  getError: (id: string) => A2UIError | undefined;
  updateError: (id: string, patch: Partial<Omit<A2UIError, "id">>) => void;
  deleteError: (id: string) => void;
}

export type A2UIStore = A2UIStoreState & A2UIStoreActions;
