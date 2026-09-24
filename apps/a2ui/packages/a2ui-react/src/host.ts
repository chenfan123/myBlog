import { useMountAnimation } from "./mount-animation.js";

export interface HostProps {
  componentId?: string;
  hasMounted?: boolean;
}

export function useHost(type: string, componentId: string | undefined, hasMounted?: boolean) {
  const mount = useMountAnimation(componentId, hasMounted);
  return {
    className: mount.className,
    onAnimationEnd: mount.onAnimationEnd,
    attrs: {
      "data-a2ui": type,
      "data-a2ui-id": componentId,
    },
  };
}
