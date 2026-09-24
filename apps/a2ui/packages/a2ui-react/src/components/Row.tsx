import type { ReactNode } from "react";
import { useMountAnimation } from "../mount-animation.js";

interface RowProps {
  children?: ReactNode;
  distribution?: string;
  alignment?: string;
  componentId?: string;
  hasMounted?: boolean;
}

const justifyContent: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceAround: "space-around",
  spaceBetween: "space-between",
  spaceEvenly: "space-evenly",
};

const alignItems: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

/**
 * A2UI Row：横向 flex 容器。
 * distribution → justify-content，alignment → align-items。
 */
export function Row({
  children,
  distribution = "start",
  alignment = "center",
  componentId,
  hasMounted,
}: RowProps) {
  const mount = useMountAnimation(componentId, hasMounted);
  return (
    <div
      data-a2ui="Row"
      data-a2ui-id={componentId}
      data-distribution={distribution}
      data-alignment={alignment}
      className={mount.className}
      onAnimationEnd={mount.onAnimationEnd}
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: justifyContent[distribution] ?? "flex-start",
        alignItems: alignItems[alignment] ?? "center",
        flexWrap: "wrap",
        width: "100%",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
