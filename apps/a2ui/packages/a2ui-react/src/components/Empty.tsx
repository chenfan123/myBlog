import type { HostProps } from "../host.js";
import { useHost } from "../host.js";

/** 空状态：列表无数据或显式 Empty 组件。 */
export function Empty({
  description = "暂无内容",
  componentId,
  hasMounted,
}: HostProps & { description?: string }) {
  const host = useHost("Empty", componentId, hasMounted);
  return (
    <div
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 88,
        padding: "16px 12px",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      {description}
    </div>
  );
}
