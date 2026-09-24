import { getAction, stampModelMessage } from "./parse";
import type { A2UIMessage } from "./protocol";

/** 把微调补丁合并进当前协议：锁定原 root，接受 surfaceUpdate 增改组件。 */
export function mergeProtocol(
  current: readonly A2UIMessage[],
  patch: readonly A2UIMessage[],
  surfaceId: string,
  catalogId: string,
): A2UIMessage[] {
  if (current.length === 0) {
    return flattenApply(patch, surfaceId, catalogId);
  }
  return flattenApply([...current, ...sanitizeRefinePatch(current, patch)], surfaceId, catalogId);
}

export function sanitizeRefinePatch(
  current: readonly A2UIMessage[],
  patch: readonly A2UIMessage[],
  options?: { keepOrphans?: boolean },
): A2UIMessage[] {
  const components = componentMap(current);
  const known = new Set(components.keys());
  const locked = readBegin(current);
  const incomingItems: Array<{ id: string; component: Record<string, unknown> }> = [];

  for (const raw of patch) {
    if (getAction(raw) !== "surfaceUpdate") {
      continue;
    }
    const update = raw.surfaceUpdate as { components?: unknown };
    if (!Array.isArray(update.components)) {
      continue;
    }
    for (const item of update.components) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id || !isRecord(item.component)) {
        continue;
      }
      incomingItems.push(item as { id: string; component: Record<string, unknown> });
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

  const out: A2UIMessage[] = [];
  for (const raw of patch) {
    const action = getAction(raw);
    if (action === "deleteSurface") {
      continue;
    }
    if (action === "beginRendering" && locked) {
      const incoming = isRecord(raw.beginRendering) ? raw.beginRendering : {};
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
    if (action === "dataModelUpdate") {
      out.push(raw);
      continue;
    }
    if (action !== "surfaceUpdate") {
      continue;
    }
    const update = raw.surfaceUpdate as { surfaceId?: string; components?: unknown };
    if (!Array.isArray(update.components)) {
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
    const update = message.surfaceUpdate as { surfaceId?: string; components?: Array<{ id: string }> } | undefined;
    if (!update || !Array.isArray(update.components)) {
      return [message];
    }
    const componentsKept = update.components.filter((item) => reach.has(item.id));
    if (componentsKept.length === 0) {
      return [];
    }
    return [{ surfaceUpdate: { surfaceId: update.surfaceId, components: componentsKept } }];
  });
}

export function surfaceIdFromMessages(messages: readonly unknown[]): string | undefined {
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
  return undefined;
}

function flattenApply(messages: readonly A2UIMessage[], surfaceId: string, catalogId: string): A2UIMessage[] {
  let begin: A2UIMessage | undefined;
  const components = new Map<string, { id: string; component: unknown }>();
  const dataUpdates: A2UIMessage[] = [];

  for (const raw of messages) {
    const message = stampModelMessage(raw, surfaceId, catalogId);
    const action = getAction(message);
    if (action === "deleteSurface") {
      begin = undefined;
      components.clear();
      dataUpdates.length = 0;
      continue;
    }
    if (action === "beginRendering") {
      begin = mergeBegin(begin, message);
      continue;
    }
    if (action === "dataModelUpdate") {
      dataUpdates.push(message);
      continue;
    }
    if (action !== "surfaceUpdate") {
      continue;
    }
    const update = message.surfaceUpdate as { components?: unknown };
    if (!Array.isArray(update.components)) {
      continue;
    }
    for (const item of update.components) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) {
        continue;
      }
      components.set(item.id, item as { id: string; component: unknown });
    }
  }

  const merged: A2UIMessage[] = [];
  if (begin) {
    merged.push(begin);
  }
  for (const component of components.values()) {
    merged.push({
      surfaceUpdate: {
        surfaceId,
        components: [component],
      },
    });
  }
  merged.push(...dataUpdates);
  return merged;
}

function componentMap(messages: readonly A2UIMessage[]): Map<string, { id: string; component: Record<string, unknown> }> {
  const map = new Map<string, { id: string; component: Record<string, unknown> }>();
  for (const message of messages) {
    const update = message.surfaceUpdate as { components?: unknown } | undefined;
    if (!Array.isArray(update?.components)) {
      continue;
    }
    for (const item of update.components) {
      if (isRecord(item) && typeof item.id === "string" && isRecord(item.component)) {
        map.set(item.id, item as { id: string; component: Record<string, unknown> });
      }
    }
  }
  return map;
}

function readBegin(messages: readonly A2UIMessage[]): Record<string, unknown> | undefined {
  for (const message of messages) {
    if (isRecord(message.beginRendering)) {
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
    component = withExplicitList(component, uniqueIds([...oldIds, ...newIds]));
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
  const previousProps = singleTypeProps(previous);
  let changed = false;
  for (const key of ["child", "entryPointChild", "contentChild"] as const) {
    const oldId = typeof previousProps?.[key] === "string" ? previousProps[key] : "";
    const newId = typeof incomingProps[key] === "string" ? incomingProps[key] : "";
    if (!oldId || !newId || oldId === newId || known.has(newId)) {
      continue;
    }
    const wrapper = working.get(newId);
    if (wrapper && referencedChildIds(wrapper.component).includes(oldId)) {
      continue;
    }
    incomingProps[key] = oldId;
    changed = true;
  }
  return changed ? { [type]: incomingProps } : incoming;
}

function singleTypeProps(component: Record<string, unknown>): Record<string, unknown> | undefined {
  const types = Object.keys(component);
  if (types.length !== 1) {
    return undefined;
  }
  const props = component[types[0] ?? ""];
  return isRecord(props) ? props : undefined;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
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
      stack.push(...referencedChildIds(node.component));
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
  const types = Object.keys(component);
  const type = types[0];
  if (!type) {
    return component;
  }
  const props = isRecord(component[type]) ? { ...component[type] } : {};
  const children = isRecord(props.children) ? { ...props.children } : {};
  children.explicitList = list;
  props.children = children;
  return { [type]: props };
}

function referencedChildIds(component: Record<string, unknown>): string[] {
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

function mergeBegin(previous: A2UIMessage | undefined, next: A2UIMessage): A2UIMessage {
  if (!previous) {
    return next;
  }
  const current = isRecord(previous.beginRendering) ? previous.beginRendering : {};
  const incoming = isRecord(next.beginRendering) ? next.beginRendering : {};
  const currentStyles = isRecord(current.styles) ? current.styles : {};
  const incomingStyles = isRecord(incoming.styles) ? incoming.styles : {};
  return {
    beginRendering: {
      ...current,
      ...incoming,
      root: current.root ?? incoming.root,
      styles: { ...currentStyles, ...incomingStyles },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
