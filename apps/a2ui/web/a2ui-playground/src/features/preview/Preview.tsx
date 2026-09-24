import { isValidElement, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { A2uiSurface } from "a2ui-react";

/**
 * 预览宿主：只负责提供 DOM 和 createRoot。
 * 组件树何时 render 由 SDK 在 parse 结束后调用 init({ renderTree })。
 * 宿主挂载完成后把 render 交给 App，用来接上 SDK，并补画当前已有的树。
 */
export function Preview({
  onHostReady,
  onPickComponentId,
}: {
  onHostReady: (render: (tree: unknown) => void) => void;
  onPickComponentId?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Root | null>(null);
  const onHostReadyRef = useRef(onHostReady);
  const onPickComponentIdRef = useRef(onPickComponentId);
  onHostReadyRef.current = onHostReady;
  onPickComponentIdRef.current = onPickComponentId;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const root = createRoot(host);
    rootRef.current = root;
    onHostReadyRef.current((tree) => {
      root.render(isValidElement(tree) ? <A2uiSurface>{tree}</A2uiSurface> : null);
    });

    const onClick = (event: MouseEvent) => {
      const pick = onPickComponentIdRef.current;
      if (!pick) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const node = target.closest("[data-a2ui-id]");
      if (!(node instanceof HTMLElement) || !host.contains(node)) {
        return;
      }
      const id = node.getAttribute("data-a2ui-id")?.trim();
      if (!id) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      host.querySelectorAll("[data-a2ui-picked]").forEach((item) => item.removeAttribute("data-a2ui-picked"));
      node.setAttribute("data-a2ui-picked", "");
      window.setTimeout(() => node.removeAttribute("data-a2ui-picked"), 700);
      pick(id);
    };
    host.addEventListener("click", onClick, true);

    return () => {
      host.removeEventListener("click", onClick, true);
      root.unmount();
      rootRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="preview-host preview-host-pick" />;
}
