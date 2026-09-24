/**
 * 检查 A2UI 组件树是否闭环：被引用的 id 都必须有对应 surfaceUpdate。
 */

export interface ComponentGraphReport {
  definedIds: string[];
  referencedIds: string[];
  missingIds: string[];
}

export function inspectComponentGraph(messages: readonly unknown[]): ComponentGraphReport {
  const defined = new Set<string>();
  const referenced = new Set<string>();

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    const begin = message.beginRendering;
    if (isRecord(begin) && typeof begin.root === "string" && begin.root) {
      referenced.add(begin.root);
    }
    const update = message.surfaceUpdate;
    if (!isRecord(update) || !Array.isArray(update.components)) {
      continue;
    }
    for (const item of update.components) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) {
        continue;
      }
      defined.add(item.id);
      if (isRecord(item.component)) {
        for (const id of referencedChildIds(item.component)) {
          referenced.add(id);
        }
      }
    }
  }

  return {
    definedIds: [...defined].sort(),
    referencedIds: [...referenced].sort(),
    missingIds: [...referenced].filter((id) => !defined.has(id)).sort(),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
