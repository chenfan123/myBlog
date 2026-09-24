import type { A2UIStoreState } from "a2ui-core";

const DEFAULT_CATALOG_ID = "a2ui-react:v0.8";

/** 取当前预览背后的协议：优先上次渲染成功的消息，否则从 store 还原。 */
export function snapshotRenderedProtocol(
  state: A2UIStoreState,
  fallback: readonly unknown[] = [],
): unknown[] {
  if (fallback.length > 0) {
    return [...fallback];
  }
  return protocolFromStore(state);
}

/** 把增量拼进原始协议。锁定 root，用 surfaceUpdate 增改组件，丢掉未挂上的整页重写。 */
export function concatProtocol(original: readonly unknown[], incremental: readonly unknown[]): unknown[] {
  if (original.length === 0) {
    return replay(incremental);
  }
  return replay([...original, ...sanitizeRefinePatch(original, incremental)]);
}

/** 微调补丁：接受 surfaceUpdate 增改节点；beginRendering 只合并 styles，不换 root。 */
export function sanitizeRefinePatch(
  original: readonly unknown[],
  incremental: readonly unknown[],
  options?: { keepOrphans?: boolean },
): unknown[] {
  const components = componentMap(original);
  const known = new Set(components.keys());
  const locked = readBegin(original);
  const incomingItems: Array<{ id: string; component: Record<string, unknown> }> = [];

  for (const message of incremental) {
    if (!isRecord(message) || !isRecord(message.surfaceUpdate) || !Array.isArray(message.surfaceUpdate.components)) {
      continue;
    }
    for (const item of message.surfaceUpdate.components) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id || !isRecord(item.component)) {
        continue;
      }
      incomingItems.push({ id: item.id, component: item.component });
    }
  }

  for (const item of incomingItems) {
    if (!components.has(item.id)) {
      components.set(item.id, item);
    }
  }
  for (const item of incomingItems) {
    if (!known.has(item.id)) {
      components.set(item.id, item);
      continue;
    }
    components.set(item.id, attachChildren(components.get(item.id), item, known, components));
  }

  const out: unknown[] = [];
  for (const message of incremental) {
    if (!isRecord(message) || "deleteSurface" in message) {
      continue;
    }
    if (isRecord(message.beginRendering) && locked) {
      const incoming = message.beginRendering;
      const currentStyles = isRecord(locked.styles) ? locked.styles : {};
      const incomingStyles = isRecord(incoming.styles) ? incoming.styles : {};
      out.push({
        beginRendering: {
          ...locked,
          styles: { ...currentStyles, ...incomingStyles },
        },
      });
      continue;
    }
    if (isRecord(message.dataModelUpdate)) {
      out.push(message);
      continue;
    }
    const update = message.surfaceUpdate;
    if (!isRecord(update) || !Array.isArray(update.components)) {
      continue;
    }
    const kept: Array<{ id: string; component: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    for (const item of update.components) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) {
        continue;
      }
      const resolved = components.get(item.id);
      if (!resolved) {
        continue;
      }
      seen.add(item.id);
      kept.push(resolved);
    }
    if (kept.length > 0) {
      out.push({
        surfaceUpdate: {
          surfaceId: update.surfaceId,
          components: kept,
        },
      });
    }
  }

  if (options?.keepOrphans) {
    return out;
  }
  const reach = reachableIds(typeof locked?.root === "string" ? locked.root : undefined, components);
  return out.flatMap((message) => {
    if (!isRecord(message) || !isRecord(message.surfaceUpdate) || !Array.isArray(message.surfaceUpdate.components)) {
      return [message];
    }
    const componentsKept = message.surfaceUpdate.components.filter(
      (item) => isRecord(item) && typeof item.id === "string" && reach.has(item.id),
    );
    if (componentsKept.length === 0) {
      return [];
    }
    return [{ surfaceUpdate: { surfaceId: message.surfaceUpdate.surfaceId, components: componentsKept } }];
  });
}

export function protocolFromStore(state: A2UIStoreState): unknown[] {
  const messages: unknown[] = [];
  for (const surface of Object.values(state.surfaceMap)) {
    if (!surface.beginRender || !surface.root) {
      continue;
    }
    messages.push({
      beginRendering: {
        surfaceId: surface.surfaceId,
        root: surface.root,
        catalogId: DEFAULT_CATALOG_ID,
        ...(surface.styles ? { styles: surface.styles } : {}),
      },
    });
  }
  for (const node of Object.values(state.hydrateNodeMap)) {
    if (node.sourceComponentId) {
      continue;
    }
    const parsed = parseNodeProtocol(node.protocol, node.componentId);
    if (!parsed) {
      continue;
    }
    messages.push({
      surfaceUpdate: {
        surfaceId: node.ownerSurfaceId,
        components: [parsed],
      },
    });
  }
  return messages;
}

function replay(messages: readonly unknown[]): unknown[] {
  let begin: Record<string, unknown> | undefined;
  const components = new Map<string, { id: string; component: unknown }>();
  const dataUpdates: unknown[] = [];
  const surfaceId = readAnySurfaceId(messages);

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    if ("deleteSurface" in message) {
      begin = undefined;
      components.clear();
      dataUpdates.length = 0;
      continue;
    }
    if (isRecord(message.beginRendering)) {
      begin = mergeBegin(begin, message.beginRendering);
      continue;
    }
    if (isRecord(message.dataModelUpdate)) {
      dataUpdates.push(message);
      continue;
    }
    const update = message.surfaceUpdate;
    if (!isRecord(update) || !Array.isArray(update.components)) {
      continue;
    }
    for (const item of update.components) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) {
        continue;
      }
      components.set(item.id, item as { id: string; component: unknown });
    }
  }

  const combined: unknown[] = [];
  if (begin) {
    combined.push({
      beginRendering: {
        ...begin,
        ...(surfaceId ? { surfaceId } : {}),
        root: begin.root,
      },
    });
  }
  for (const component of components.values()) {
    combined.push({
      surfaceUpdate: {
        surfaceId,
        components: [component],
      },
    });
  }
  combined.push(...dataUpdates);
  return combined;
}

function componentMap(
  messages: readonly unknown[],
): Map<string, { id: string; component: Record<string, unknown> }> {
  const map = new Map<string, { id: string; component: Record<string, unknown> }>();
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.surfaceUpdate) || !Array.isArray(message.surfaceUpdate.components)) {
      continue;
    }
    for (const item of message.surfaceUpdate.components) {
      if (isRecord(item) && typeof item.id === "string" && isRecord(item.component)) {
        map.set(item.id, { id: item.id, component: item.component });
      }
    }
  }
  return map;
}

function readBegin(messages: readonly unknown[]): Record<string, unknown> | undefined {
  for (const message of messages) {
    if (isRecord(message) && isRecord(message.beginRendering)) {
      return { ...message.beginRendering };
    }
  }
  return undefined;
}

function attachChildren(
  previous: { id: string; component: Record<string, unknown> } | undefined,
  incoming: { id: string; component: Record<string, unknown> },
  known: ReadonlySet<string>,
  working: Map<string, { id: string; component: Record<string, unknown> }>,
): { id: string; component: Record<string, unknown> } {
  if (!previous) {
    return incoming;
  }
  let component = incoming.component;
  const oldIds = explicitList(previous.component);
  const newIds = explicitList(incoming.component);
  if (oldIds.length > 0 && newIds.length > 0 && !oldIds.some((id) => newIds.includes(id))) {
    component = withExplicitList(component, [...new Set([...oldIds, ...newIds])]);
  }
  component = preserveChildPointers(previous.component, component, known, working);
  return { id: incoming.id, component };
}

function preserveChildPointers(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>,
  known: ReadonlySet<string>,
  working: Map<string, { id: string; component: Record<string, unknown> }>,
): Record<string, unknown> {
  const type = Object.keys(incoming)[0];
  if (!type) {
    return incoming;
  }
  const incomingProps = isRecord(incoming[type]) ? { ...incoming[type] } : {};
  const previousType = Object.keys(previous)[0];
  const previousProps = previousType && isRecord(previous[previousType]) ? previous[previousType] : undefined;
  let changed = false;
  for (const key of ["child", "entryPointChild", "contentChild"] as const) {
    const oldId = previousProps && typeof previousProps[key] === "string" ? previousProps[key] : "";
    const newId = typeof incomingProps[key] === "string" ? incomingProps[key] : "";
    if (!oldId || !newId || oldId === newId || known.has(newId)) {
      continue;
    }
    const wrapper = working.get(newId);
    if (wrapper && childRefs(wrapper.component).includes(oldId)) {
      continue;
    }
    incomingProps[key] = oldId;
    changed = true;
  }
  return changed ? { [type]: incomingProps } : incoming;
}

function reachableIds(
  root: string | undefined,
  components: Map<string, { id: string; component: Record<string, unknown> }>,
): Set<string> {
  const reach = new Set<string>();
  const stack = root ? [root] : [...components.keys()];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || reach.has(id)) {
      continue;
    }
    reach.add(id);
    const node = components.get(id);
    if (node) {
      stack.push(...childRefs(node.component));
    }
  }
  return reach;
}

function explicitList(component: Record<string, unknown>): string[] {
  const types = Object.keys(component);
  const props = types.length === 1 ? component[types[0] ?? ""] : undefined;
  if (!isRecord(props) || !isRecord(props.children) || !Array.isArray(props.children.explicitList)) {
    return [];
  }
  return props.children.explicitList.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function withExplicitList(component: Record<string, unknown>, list: string[]): Record<string, unknown> {
  const type = Object.keys(component)[0];
  if (!type) {
    return component;
  }
  const props = isRecord(component[type]) ? { ...component[type] } : {};
  const children = isRecord(props.children) ? { ...props.children } : {};
  children.explicitList = list;
  props.children = children;
  return { [type]: props };
}

function childRefs(component: Record<string, unknown>): string[] {
  const types = Object.keys(component);
  if (types.length !== 1) {
    return [];
  }
  const props = component[types[0] ?? ""];
  if (!isRecord(props)) {
    return [];
  }
  const ids: string[] = [];
  const children = isRecord(props.children) ? props.children : undefined;
  if (Array.isArray(children?.explicitList)) {
    ids.push(...children.explicitList.filter((item): item is string => typeof item === "string" && item.length > 0));
  }
  const template = children && isRecord(children.template) ? children.template : undefined;
  if (typeof template?.componentId === "string" && template.componentId) {
    ids.push(template.componentId);
  }
  for (const key of ["child", "entryPointChild", "contentChild"] as const) {
    const value = props[key];
    if (typeof value === "string" && value) {
      ids.push(value);
    }
  }
  if (Array.isArray(props.tabItems)) {
    for (const item of props.tabItems) {
      if (isRecord(item) && typeof item.child === "string" && item.child) {
        ids.push(item.child);
      }
    }
  }
  return ids;
}

function parseNodeProtocol(protocol: string, fallbackId: string): { id: string; component: unknown } | undefined {
  try {
    const parsed = JSON.parse(protocol) as { id?: unknown; component?: unknown };
    const id = typeof parsed.id === "string" && parsed.id ? parsed.id : fallbackId;
    if (!parsed.component || typeof parsed.component !== "object") {
      return undefined;
    }
    return { id, component: parsed.component };
  } catch {
    return undefined;
  }
}

function mergeBegin(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!previous) {
    return { ...incoming };
  }
  const currentStyles = isRecord(previous.styles) ? previous.styles : {};
  const incomingStyles = isRecord(incoming.styles) ? incoming.styles : {};
  return {
    ...previous,
    ...incoming,
    root: previous.root ?? incoming.root,
    styles: { ...currentStyles, ...incomingStyles },
  };
}

function readAnySurfaceId(messages: readonly unknown[]): string {
  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    for (const key of ["beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"] as const) {
      const body = message[key];
      if (isRecord(body) && typeof body.surfaceId === "string" && body.surfaceId) {
        return body.surfaceId;
      }
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
