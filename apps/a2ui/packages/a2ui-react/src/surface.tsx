import { getA2UIStore, stylesToCssVars, type Surface } from "a2ui-core";
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

function subscribe(onStoreChange: () => void) {
  return getA2UIStore().subscribe(onStoreChange);
}

function activeSurface(): Surface | undefined {
  return Object.values(getA2UIStore().getState().surfaceMap).find((surface) => surface.beginRender);
}

/**
 * 把 beginRendering.styles 转成 CSS 变量挂到 surface 根上。
 * 缺字段不写变量，由 theme.css 兜底。
 */
export function A2uiSurface({ children }: { children: ReactNode }) {
  const surface = useSyncExternalStore(subscribe, activeSurface, activeSurface);
  return (
    <div
      data-a2ui-surface={surface?.surfaceId}
      data-a2ui-form-factor={surface?.styles?.formFactor ?? "mobile"}
      style={stylesToCssVars(surface?.styles) as CSSProperties}
    >
      {children}
    </div>
  );
}
