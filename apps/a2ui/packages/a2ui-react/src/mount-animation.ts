import type { AnimationEvent } from "react";
import { markHydrateNodeMounted } from "a2ui-core";
import "./mount-animation.css";

/**
 * 未挂载节点播 0.3s 淡入；动画结束调用 markHydrateNodeMounted，清掉 hasMounted=false 标记。
 */
export function useMountAnimation(componentId: string | undefined, hasMounted?: boolean) {
  function handleAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (!componentId || hasMounted) {
      return;
    }
    markHydrateNodeMounted(componentId);
  }

  return {
    className: hasMounted ? undefined : "a2ui-mounting",
    onAnimationEnd: handleAnimationEnd,
  };
}
