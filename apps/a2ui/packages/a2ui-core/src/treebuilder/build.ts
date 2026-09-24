/**
 * treebuilder：把 store 里的 hydrateNode 按 parent/child 组装成可挂载的组件树。
 *
 * 调用时机：每次 parse 完一段 A2UI JSONL 之后，以及 updateModel / userAction 本地写模型之后。
 *
 * 协议里的组件是扁平的（邻接表）：Column / Row / List 的 children.explicitList 只存子组件 id。
 * children.template 则按 dataModel 列表克隆 template 组件：每一项及其子树都写成独立 hydrate node，
 * 带唯一 componentId，相对 path 绑定到当前项。
 *
 * 步骤：
 * 1. 根据各节点 childIds 回填 parentId
 * 2. 从已 beginRendering 的 surface.root 递归组装
 * 3. 每个节点从 protocol 取 props，resolve *Path，再调 renderMap[type]
 * 4. 容器把已组装的子树放进 props.children；template 列表按项克隆并登记唯一 id
 *
 * 不用 cloneElement：core 不依赖 React，容器是新建一次 render，不是改已有 element。
 */
import { resolveRenderProps, type BindingScope } from "../datamodel/bind.js";
import { joinPath, readListItems, resolvePath } from "../datamodel/path.js";
import { getA2UIStore } from "../store/index.js";
import type { HydrateNode } from "../store/types.js";
import { getChildrenTemplate, getComponentRenderRequest } from "../vnode/index.js";
import type { ComponentTree } from "./types.js";

interface AssembleOptions {
  visiting: Set<string>;
  liveInstances: Set<string>;
  scope?: unknown;
  pathPrefix?: string;
}

/**
 * 从 store 取出当前可渲染的组件树。
 * 没有 beginRender、没有 root、或 root hydrate node 还不存在时返回 null。
 */
export function buildTree(): ComponentTree {
  const store = getA2UIStore().getState();
  linkParentChild(store.hydrateNodeMap);

  for (const surface of Object.values(store.surfaceMap)) {
    if (!surface.beginRender || !surface.root) {
      continue;
    }

    const root = store.getHydrateNode(surface.root) ?? surface.rootNode;
    if (!root) {
      continue;
    }

    const liveInstances = new Set<string>();
    const tree = assembleNode(root, { visiting: new Set(), liveInstances });
    pruneStaleInstances(surface.surfaceId, liveInstances);
    return tree;
  }

  return null;
}

/** 组装当前组件树；有 renderTree 时由 SDK 在这里通知宿主挂载。 */
export function commitTree(): ComponentTree {
  const tree = buildTree();
  getA2UIStore().getState().renderTree?.(tree);
  return tree;
}

/**
 * 用 childIds 回填每个子节点的 parentId。
 * childIds 在 parse surfaceUpdate 时已经从协议 explicitList 写入；parent 方向在这里补上。
 */
function linkParentChild(hydrateNodeMap: Record<string, HydrateNode>): void {
  const store = getA2UIStore().getState();

  for (const node of Object.values(hydrateNodeMap)) {
    for (const childId of node.childIds) {
      const child = store.getHydrateNode(childId);
      if (!child || child.parentId === node.componentId) {
        continue;
      }
      store.updateHydrateNode(childId, { parentId: node.componentId });
    }
  }
}

/**
 * 递归组装一棵子树。
 * visiting 按模板/协议 id 防环（A→B→A）；template 每一项用一份新的 visiting，因为它们共用模板 id。
 */
function assembleNode(node: HydrateNode, options: AssembleOptions): ComponentTree {
  const sourceId = node.sourceComponentId ?? node.componentId;
  if (options.visiting.has(sourceId)) {
    return node.v_node;
  }
  options.visiting.add(sourceId);

  const store = getA2UIStore().getState();
  const dataModel = store.getSurface(node.ownerSurfaceId)?.dataModel ?? {};
  const component = readProtocolComponent(node);
  const template = component ? getChildrenTemplate(component) : undefined;
  const children = template
    ? assembleTemplateChildren(node, template, dataModel, options)
    : node.childIds.flatMap((childId) => {
        const child = store.getHydrateNode(childId);
        return child ? [assembleNode(child, { ...options, visiting: options.visiting })] : [];
      });

  const request = component ? getComponentRenderRequest(component) : null;
  const render = request ? store.renderMap[request.type] : undefined;
  const binding: BindingScope | undefined =
    options.scope !== undefined || options.pathPrefix
      ? { scope: options.scope, pathPrefix: options.pathPrefix }
      : undefined;
  const resolved = request ? resolveRenderProps(request.props, dataModel, binding) : {};

  let v_node: unknown = node.v_node;
  if (render && request) {
    const props: Record<string, unknown> = {
      ...resolved,
      componentId: node.componentId,
      surfaceId: node.ownerSurfaceId,
      hasMounted: node.hasMounted,
    };
    if (children.length > 0) {
      props.children = children;
    }
    v_node = render(props);
  } else if (children.length > 0) {
    v_node = {
      type: request?.type,
      children,
    };
  }

  store.updateHydrateNode(node.componentId, { v_node });
  if (store.getSurface(node.ownerSurfaceId)?.root === node.componentId) {
    store.updateSurface(node.ownerSurfaceId, { rootNode: store.getHydrateNode(node.componentId) });
  }

  return v_node;
}

function assembleTemplateChildren(
  node: HydrateNode,
  template: { componentId: string; dataBinding: string },
  dataModel: Record<string, unknown>,
  options: AssembleOptions,
): unknown[] {
  const store = getA2UIStore().getState();
  const templateNode = store.getHydrateNode(template.componentId);
  if (!templateNode) {
    store.updateHydrateNode(node.componentId, { childIds: [] });
    return [];
  }

  const items = readListItems(resolvePath(template.dataBinding, dataModel, options.scope));
  const childIds: string[] = [];
  const children = items.map((item, index) => {
    const relative = Boolean(options.pathPrefix) && !template.dataBinding.startsWith("/");
    const pathPrefix = joinPath(relative ? options.pathPrefix : undefined, template.dataBinding, index);
    const instanceId = `${node.componentId}:${index}:${template.componentId}`;
    const instance = materializeInstance(templateNode, instanceId, node.componentId, options.liveInstances);
    childIds.push(instance.componentId);
    return assembleNode(instance, {
      visiting: new Set(options.visiting),
      liveInstances: options.liveInstances,
      scope: item,
      pathPrefix,
    });
  });

  store.updateHydrateNode(node.componentId, { childIds });
  return children;
}

/** 把模板组件（及其 explicitList 子树）写成带唯一 id 的实例节点，不覆盖模板本身。 */
function materializeInstance(
  templateNode: HydrateNode,
  instanceId: string,
  parentId: string,
  liveInstances: Set<string>,
): HydrateNode {
  const store = getA2UIStore().getState();
  liveInstances.add(instanceId);

  const childIds = templateNode.childIds.map((childId) => {
    const childTemplate = store.getHydrateNode(childId);
    const childInstanceId = `${instanceId}:${childId}`;
    if (childTemplate) {
      materializeInstance(childTemplate, childInstanceId, instanceId, liveInstances);
    }
    return childInstanceId;
  });

  const existing = store.getHydrateNode(instanceId);
  const node: HydrateNode = {
    componentId: instanceId,
    v_node: existing?.v_node,
    ownerSurfaceId: templateNode.ownerSurfaceId,
    protocol: rewriteProtocolId(templateNode.protocol, instanceId),
    childIds,
    parentId,
    hasMounted: existing?.hasMounted ?? false,
    sourceComponentId: templateNode.sourceComponentId ?? templateNode.componentId,
  };
  store.addHydrateNode(node);
  return store.getHydrateNode(instanceId) ?? node;
}

function pruneStaleInstances(surfaceId: string, liveInstances: Set<string>): void {
  const store = getA2UIStore().getState();
  for (const node of Object.values(store.hydrateNodeMap)) {
    if (node.ownerSurfaceId !== surfaceId || !node.sourceComponentId) {
      continue;
    }
    if (!liveInstances.has(node.componentId)) {
      store.deleteHydrateNode(node.componentId);
    }
  }
}

function rewriteProtocolId(protocol: string, instanceId: string): string {
  try {
    const parsed = JSON.parse(protocol) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, id: instanceId });
  } catch {
    return protocol;
  }
}

/** 从 hydrate node.protocol（组件原始 JSON）里取出 component 字段，用来识别类型和 props。 */
function readProtocolComponent(node: HydrateNode): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(node.protocol) as { component?: Record<string, unknown> };
    return parsed.component;
  } catch {
    return undefined;
  }
}
