import type { ReactNode } from "react";
import { useMountAnimation } from "../mount-animation.js";

interface ColumnProps {
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
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
};

const alignItems: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

/**
 * A2UI Column：竖向 flex 容器。
 * distribution → justify-content，alignment → align-items。
 */
export function Column({
  children,
  distribution = "start",
  alignment = "stretch",
  componentId,
  hasMounted,
}: ColumnProps) {
  const mount = useMountAnimation(componentId, hasMounted);
  return (
    <div
      data-a2ui="Column"
      data-a2ui-id={componentId}
      data-distribution={distribution}
      data-alignment={alignment}
      className={mount.className}
      onAnimationEnd={mount.onAnimationEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: justifyContent[distribution] ?? "flex-start",
        alignItems: alignItems[alignment] ?? "stretch",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
