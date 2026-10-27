import { useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { isTextEntry, viewportStore } from "./visual-viewport";
import { lockDocument } from "./document-lock";

const safeArea = "--agent-chat-safe-area-bottom";
/** Full-screen application shell. Keeps its header and content in the actual visible viewport. */
export interface ChatAppViewportProps extends HTMLAttributes<HTMLDivElement> { header?: ReactNode }
export function ChatAppViewport({ header, children, style, ...props }: ChatAppViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const win = root.ownerDocument.defaultView!;
    const release = lockDocument(root.ownerDocument);
    const store = viewportStore(win);
    const update = () => {
      const view = store.getSnapshot();
      // Pinch zoom keeps the layout intact; do not turn zoom into a keyboard or cancel it.
      if (Math.abs(view.scale - 1) >= 0.02) return;
      root.style.height = `${view.height}px`; root.style.width = `${view.width}px`;
      const pageTop = win.scrollY + view.top, pageLeft = win.scrollX + view.left;
      root.style.top = `${pageTop}px`; root.style.left = `${pageLeft}px`;
      root.style.setProperty(safeArea, view.keyboard ? "0px" : "env(safe-area-inset-bottom, 0px)");
      // Absolute boxes use document coordinates. A fixed box may already follow
      // WebKit's visual viewport, so adding offsetTop to it can pan the page twice.
      // Compensate an offset containing block without scrolling the document.
      const bounds = root.getBoundingClientRect();
      if (Math.abs(bounds.top - view.top) > 0.5) root.style.top = `${pageTop + view.top - bounds.top}px`;
      if (Math.abs(bounds.left - view.left) > 0.5) root.style.left = `${pageLeft + view.left - bounds.left}px`;
    };
    const unsubscribe = store.subscribe(update); update();
    return () => { unsubscribe(); release(); };
  }, []);
  return <div data-agent-chat-app-host="" style={{ position: "relative", height: "100dvh", minHeight: 0, minWidth: 0 }}>
    <div {...props} ref={ref} data-agent-chat-app-viewport="" style={{ ...style, position: "absolute", inset: "0 auto auto 0", width: "100%", height: "100dvh", minHeight: 0,
      display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box",
      paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      {header != null && <div data-agent-chat-app-header="" style={{ flex: "0 0 auto", minWidth: 0 }}>{header}</div>}
      <div data-agent-chat-app-content="" style={{ flex: "1 1 0%", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>{children}</div>
    </div></div>;
}

/** Built-in skins use this automatically; custom skins can attach it to their flex-column root. */
export function useChatViewport(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const win = root.ownerDocument.defaultView!;
    const store = viewportStore(win);
    const oldHeight = root.style.getPropertyValue("max-height");
    const heightPriority = root.style.getPropertyPriority("max-height");
    const heightCap = win.getComputedStyle(root).maxHeight;
    const maxHeight = heightCap.endsWith("px") ? Number.parseFloat(heightCap) : NaN;
    const oldSafeArea = root.style.getPropertyValue(safeArea);
    const safePriority = root.style.getPropertyPriority(safeArea);
    let fitted = false;
    const reset = () => {
      if (oldHeight) root.style.setProperty("max-height", oldHeight, heightPriority); else root.style.removeProperty("max-height");
      if (oldSafeArea) root.style.setProperty(safeArea, oldSafeArea, safePriority); else root.style.removeProperty(safeArea);
      fitted = false;
    };
    const update = () => {
      const view = store.getSnapshot();
      const focused = root.contains(root.ownerDocument.activeElement) && isTextEntry(root.ownerDocument.activeElement);
      if (view.keyboard && (focused || fitted)) {
        const available = Math.max(0, view.top + view.height - root.getBoundingClientRect().top);
        const value = Number.isFinite(maxHeight) ? `${Math.min(maxHeight, available)}px`
          : heightCap.includes("%") || /^(calc|min|max|clamp)\(/.test(heightCap)
            ? `min(${heightCap}, ${available}px)` : `${available}px`;
        if (root.style.maxHeight !== value) root.style.setProperty("max-height", value, heightPriority);
        root.style.setProperty(safeArea, "0px"); fitted = true;
      } else if (fitted) reset();
    };
    const unsubscribe = store.subscribe(update); update();
    let resizeFrame = 0;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (!resizeFrame) resizeFrame = win.requestAnimationFrame(() => { resizeFrame = 0; update(); });
    });
    if (root.parentElement) observer?.observe(root.parentElement);
    return () => { observer?.disconnect(); win.cancelAnimationFrame(resizeFrame); unsubscribe(); reset(); };
  }, [ref]);
}
