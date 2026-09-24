import { useState, type CSSProperties, type ReactNode } from "react";
import type { HostProps } from "../host.js";
import { useHost } from "../host.js";

const alignItems: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

export function List({
  children,
  direction = "vertical",
  alignment = "stretch",
  componentId,
  hasMounted,
}: HostProps & { children?: ReactNode; direction?: string; alignment?: string }) {
  const host = useHost("List", componentId, hasMounted);
  return (
    <div
      {...host.attrs}
      data-direction={direction}
      data-alignment={alignment}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{
        display: "flex",
        flexDirection: direction === "horizontal" ? "row" : "column",
        alignItems: (alignItems[alignment] ?? "stretch") as CSSProperties["alignItems"],
        minWidth: 0,
        overflow: "auto",
      }}
    >
      {children}
    </div>
  );
}

export function Card({
  children,
  componentId,
  hasMounted,
}: HostProps & { children?: ReactNode }) {
  const host = useHost("Card", componentId, hasMounted);
  return (
    <div
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{
        width: "100%",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

export function Divider({
  axis = "horizontal",
  componentId,
  hasMounted,
}: HostProps & { axis?: string }) {
  const host = useHost("Divider", componentId, hasMounted);
  const vertical = axis === "vertical";
  return (
    <div
      {...host.attrs}
      data-axis={axis}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      role="separator"
      style={
        vertical
          ? { width: 1, alignSelf: "stretch" }
          : { height: 1, width: "100%" }
      }
    />
  );
}

export function Tabs({
  tabItems,
  children,
  componentId,
  hasMounted,
}: HostProps & {
  tabItems?: Array<{ title?: string; childId?: string }>;
  children?: ReactNode;
}) {
  const host = useHost("Tabs", componentId, hasMounted);
  const [active, setActive] = useState(0);
  const panes = Array.isArray(children) ? children : children ? [children] : [];
  const titles = tabItems?.length
    ? tabItems.map((item) => item.title || "Tab")
    : panes.map((_, index) => `Tab ${index + 1}`);

  return (
    <div
      {...host.attrs}
      className={host.className}
      onAnimationEnd={host.onAnimationEnd}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div data-a2ui-slot="tablist">
        {titles.map((title, index) => (
          <button
            key={`${title}-${index}`}
            type="button"
            data-active={index === active}
            onClick={() => setActive(index)}
          >
            {title}
          </button>
        ))}
      </div>
      <div>{panes[active] ?? null}</div>
    </div>
  );
}

export function Modal({
  children,
  componentId,
  hasMounted,
}: HostProps & { children?: ReactNode }) {
  const host = useHost("Modal", componentId, hasMounted);
  const [open, setOpen] = useState(false);
  const panes = Array.isArray(children) ? children : children ? [children] : [];
  const entry = panes[0];
  const content = panes[1];

  return (
    <div {...host.attrs} className={host.className} onAnimationEnd={host.onAnimationEnd}>
      <div
        data-a2ui-slot="entryPoint"
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            setOpen(true);
          }
        }}
        role="button"
        tabIndex={0}
        style={{ display: "inline-block", cursor: "pointer" }}
      >
        {entry}
      </div>
      {open ? (
        <div
          data-a2ui-slot="backdrop"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(0 0 0 / 32%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
          }}
        >
          <div
            data-a2ui-slot="content"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
            style={{
              minWidth: 280,
              maxWidth: 400,
              padding: 24,
              borderRadius: 18,
              background: "#fff",
            }}
          >
            {content}
          </div>
        </div>
      ) : null}
    </div>
  );
}
