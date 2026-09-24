/**
 * A2UI v0.8 JSONL parser。
 *
 * 协议是 JSONL：每一行一个 JSON 对象，且必须恰好包含一种
 * server→client 消息：beginRendering / surfaceUpdate / dataModelUpdate / deleteSurface。
 * parse() 按行解析后交给对应 handler，结果写入全局 store；
 * 全部解析完再 treebuild，若 init 时传了 renderTree 则由 SDK 调用它挂载组件树。
 */
import { applyBoundInitializers } from "../datamodel/init.js";
import { resolveRenderProps } from "../datamodel/bind.js";
import { applyDataModelUpdate } from "../datamodel/update.js";
import { ErrorType, getA2UIStore } from "../store/index.js";
import type { A2UIErrorType, HydrateNode, Surface } from "../store/types.js";
import { parseSurfaceStyles } from "../style/index.js";
import { commitTree, type ComponentTree } from "../treebuilder/index.js";
import {
  mapComponentToVNode,
  getChildIds,
  getChildrenTemplate,
  getComponentRenderRequest,
} from "../vnode/index.js";
import {
  SERVER_TO_CLIENT_ACTIONS,
  type A2UIServerMessage,
  type BeginRenderingMessage,
  type DataModelUpdateMessage,
  type DeleteSurfaceMessage,
  type ServerToClientAction,
  type SurfaceUpdateMessage,
} from "./types.js";

/** 把消息数组转成 JSONL 字符串（每行一条消息），给测试和 playground 用。 */
export function messagesToJsonl(messages: readonly unknown[]): string {
  return messages.map((message) => JSON.stringify(message)).join('\n');
}

/** 解析 JSONL 流：空行跳过，非法 JSON 记 PARSE_ERROR，合法消息走 dispatch；最后组装组件树并交给宿主渲染。 */
export function parse(jsonl: string): ComponentTree {
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      addParseError(`Invalid JSONL line: ${trimmed}`);
      continue;
    }

    // 识别这一行是 4 种消息里的哪一种，再交给对应 handler 写 store
    dispatch(message);
  }

  return commitTree();
}

/** 按消息类型分发到 4 个 handler；不是恰好一种合法 action 则记 PARSE_ERROR。 */
function dispatch(message: unknown): void {
  const action = getServerToClientAction(message);
  if (!action) {
    addParseError(
      'A2UI message must contain exactly one of beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface',
    );
    return;
  }

  switch (action) {
    case 'beginRendering':
      handleBeginRendering(message as BeginRenderingMessage);
      return;
    case 'surfaceUpdate':
      handleSurfaceUpdate(message as SurfaceUpdateMessage);
      return;
    case 'dataModelUpdate':
      handleDataModelUpdate(message as DataModelUpdateMessage);
      return;
    case 'deleteSurface':
      handleDeleteSurface(message as DeleteSurfaceMessage);
  }
}

/** 判断对象上是否恰好有一种 server→client action。 */
function getServerToClientAction(
  message: unknown,
): ServerToClientAction | undefined {
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }

  const present = SERVER_TO_CLIENT_ACTIONS.filter((key) => key in message);
  if (present.length !== 1) {
    return undefined;
  }

  return present[0];
}

/**
 * beginRendering：标记 surface 可渲染，并记下 root 组件 id。
 * 如果对应 hydrate node 已经存在（surfaceUpdate 先到），同时挂上 rootNode。
 */
function handleBeginRendering(message: BeginRenderingMessage): void {
  const { surfaceId, root, styles } = message.beginRendering;
  const store = getA2UIStore().getState();
  ensureSurface(surfaceId);
  store.updateSurface(surfaceId, {
    beginRender: true,
    root,
    rootNode: store.getHydrateNode(root),
    styles: parseSurfaceStyles(styles),
  });
}

/**
 * surfaceUpdate：把 components 写成 hydrate node。
 * protocol 保存该组件的原始 JSON。
 * 若 init 时注入了 renderMap，则先检查协议组件是否已注册：
 * 叶子组件立刻 render 写入 v_node；容器只检查是否注册，children 交给 treebuild。
 * 未注册则写入 UNREGISTERED_COMPONENT 错误，并退回 mapped vnode。
 * 若 id 等于 surface.root，则更新 rootNode。
 * 新组件 hasMounted=false（待入场动画）；已有组件保持原标记。
 * BoundValue 同时带 path 和 literal 时，先把 literal 写入 dataModel（不覆盖已有值），渲染再按 path 取值。
 */
function handleSurfaceUpdate(message: SurfaceUpdateMessage): void {
  const { surfaceId, components } = message.surfaceUpdate;
  ensureSurface(surfaceId);

  const store = getA2UIStore().getState();
  let dataModel = store.getSurface(surfaceId)?.dataModel ?? {};
  for (const component of components) {
    dataModel = applyBoundInitializers(dataModel, component.component);
  }
  store.updateSurface(surfaceId, { dataModel });

  for (const component of components) {
    const childIds = getChildIds(component.component);
    const existing = store.getHydrateNode(component.id);
    const hasMounted = existing?.hasMounted ?? false;
    const node: HydrateNode = {
      componentId: component.id,
      v_node: renderComponent(component.component, {
        componentId: component.id,
        surfaceId,
        childIds,
        hasMounted,
      }),
      ownerSurfaceId: surfaceId,
      protocol: JSON.stringify(component),
      childIds,
      parentId: existing?.parentId,
      hasMounted,
    };
    store.addHydrateNode(node);

    const surface = store.getSurface(surfaceId);
    if (surface?.root === component.id) {
      store.updateSurface(surfaceId, { rootNode: node });
    }
  }
}

/**
 * 用 renderMap[组件名](props) 渲染实例。
 * 协议里的组件类型必须已在 renderMap 注册；否则记 UNREGISTERED_COMPONENT，v_node 退回 mapped。
 * 容器（有 childIds，或 children.template）先不 render，等 treebuild 把子树挂上再 render。
 */
function renderComponent(
  component: Record<string, unknown>,
  context: { componentId: string; surfaceId: string; childIds: string[]; hasMounted: boolean },
) {
  const request = getComponentRenderRequest(component);
  if (!request) {
    return mapComponentToVNode(component);
  }

  const render = getA2UIStore().getState().renderMap[request.type];
  if (!render) {
    addStoreError(
      ErrorType.UNREGISTERED_COMPONENT,
      `Component type "${request.type}" is not registered in renderMap (componentId: "${context.componentId}", surfaceId: "${context.surfaceId}")`,
    );
    return request.mapped;
  }

  if (context.childIds.length > 0 || getChildrenTemplate(component)) {
    return request.mapped;
  }

  return render({
    ...resolveRenderProps(request.props, getA2UIStore().getState().getSurface(context.surfaceId)?.dataModel ?? {}),
    componentId: context.componentId,
    surfaceId: context.surfaceId,
    hasMounted: context.hasMounted,
  });
}

/** dataModelUpdate：按 path 把 contents 写入该 surface 的 dataModel。 */
function handleDataModelUpdate(message: DataModelUpdateMessage): void {
  const { surfaceId, path, contents } = message.dataModelUpdate;
  const store = getA2UIStore().getState();
  const surface = ensureSurface(surfaceId);
  store.updateSurface(surfaceId, {
    dataModel: applyDataModelUpdate(surface.dataModel, path, contents),
  });
}

/**
 * deleteSurface：同步清掉 store 里的 surface，以及 ownerSurfaceId 属于它的全部 hydrate node。
 * 先收集 node id 再删，避免遍历时 map 被改掉。
 */
function handleDeleteSurface(message: DeleteSurfaceMessage): void {
  const { surfaceId } = message.deleteSurface;
  const store = getA2UIStore().getState();
  const ownedComponentIds = Object.values(store.hydrateNodeMap)
    .filter((node) => node.ownerSurfaceId === surfaceId)
    .map((node) => node.componentId);

  store.deleteSurface(surfaceId);
  for (const componentId of ownedComponentIds) {
    store.deleteHydrateNode(componentId);
  }
}

/** 没有该 surface 时先建一个空的（beginRender=false，空 dataModel）。 */
function ensureSurface(surfaceId: string): Surface {
  const store = getA2UIStore().getState();
  const existing = store.getSurface(surfaceId);
  if (existing) {
    return existing;
  }

  const surface: Surface = {
    surfaceId,
    beginRender: false,
    dataModel: {},
  };
  store.addSurface(surface);
  return store.getSurface(surfaceId) ?? surface;
}

/** 解析失败写入 store.errorMap，类型为 PARSE_ERROR。 */
function addParseError(content: string): void {
  addStoreError(ErrorType.PARSE_ERROR, content);
}

function addStoreError(type: A2UIErrorType, content: string): void {
  getA2UIStore().getState().addError({
    id: crypto.randomUUID(),
    type,
    content,
  });
}

export type { A2UIServerMessage };
