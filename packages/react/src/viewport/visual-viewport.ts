/** Geometry only. Keyboard detection is a focus + contraction heuristic, never a UA sniff. */
export interface ViewportSnapshot { width: number; height: number; top: number; left: number; scale: number; keyboard: boolean; focused: Element | null }
export function isTextEntry(element: Element | null): boolean {
  const view = element?.ownerDocument.defaultView;
  if (!view || !(element instanceof view.HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof view.HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  return element instanceof view.HTMLInputElement && !element.disabled && !element.readOnly &&
    !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(element.type);
}
const stores = new WeakMap<Window, ReturnType<typeof createViewportStore>>();
export function viewportStore(win: Window) {
  let store = stores.get(win);
  if (!store) { store = createViewportStore(win); stores.set(win, store); }
  return store;
}
function createViewportStore(win: Window) {
  let baseline = win.visualViewport?.height ?? win.innerHeight;
  let width = win.innerWidth;
  let snapshot: ViewportSnapshot | null = null;
  let frame = 0;
  const listeners = new Set<() => void>();
  const read = (force = false) => {
    const viewport = win.visualViewport;
    const height = viewport?.height || win.innerHeight;
    const scale = viewport?.scale ?? 1;
    const editing = isTextEntry(win.document.activeElement);
    // Rotation is a new baseline; address-bar changes are much smaller than a keyboard.
    if (Math.abs(width - win.innerWidth) > 100) { baseline = win.innerHeight; width = win.innerWidth; }
    const unzoomed = Math.abs(scale - 1) < 0.02;
    if (unzoomed && !editing) baseline = height;
    baseline = unzoomed ? Math.max(baseline, height) : baseline;
    const contracted = baseline - height > 120;
    const layoutHeight = Math.max(win.innerHeight, win.document.documentElement.clientHeight, height);
    const layoutWidth = Math.max(win.innerWidth, win.document.documentElement.clientWidth);
    // Discard stale/elastic offsets beyond the layout viewport, including keyboard dismissal in WebKit.
    // pageTop/pageLeft describe the visible document origin. Some WebKit builds
    // report the same keyboard pan in both scrollY and offsetTop; adding those
    // values double-translates the shell. Prefer the document origin when present.
    const offsetTop = viewport && Number.isFinite(viewport.pageTop) ? viewport.pageTop - win.scrollY : viewport?.offsetTop ?? 0;
    const offsetLeft = viewport && Number.isFinite(viewport.pageLeft) ? viewport.pageLeft - win.scrollX : viewport?.offsetLeft ?? 0;
    const top = Math.max(0, Math.min(offsetTop, layoutHeight - height));
    const left = Math.max(0, Math.min(offsetLeft, layoutWidth - (viewport?.width || win.innerWidth)));
    const next = { width: viewport?.width || win.innerWidth, height, top,
      left, scale, focused: win.document.activeElement, keyboard: unzoomed && contracted && editing };
    if (!snapshot || Object.keys(next).some(key => next[key as keyof typeof next] !== snapshot![key as keyof ViewportSnapshot])) {
      snapshot = next;
      listeners.forEach(listener => listener());
    } else if (force) listeners.forEach(listener => listener());
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; read(true); }); };
  const events = ["resize", "scroll", "pageshow", "orientationchange"] as const;
  return {
    getSnapshot: () => { if (!snapshot) read(); return snapshot!; },
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        // A new mount must not inherit an old orientation/keyboard baseline.
        baseline = win.visualViewport?.height ?? win.innerHeight; width = win.innerWidth; snapshot = null;
        events.forEach(name => win.addEventListener(name, schedule, { passive: true }));
        win.visualViewport?.addEventListener("resize", schedule);
        win.visualViewport?.addEventListener("scroll", schedule);
        win.document.addEventListener("focusin", schedule);
        win.document.addEventListener("focusout", schedule);
        win.document.addEventListener("visibilitychange", schedule);
      }
      listeners.add(listener); read();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          events.forEach(name => win.removeEventListener(name, schedule));
          win.visualViewport?.removeEventListener("resize", schedule);
          win.visualViewport?.removeEventListener("scroll", schedule);
          win.document.removeEventListener("focusin", schedule);
          win.document.removeEventListener("focusout", schedule);
          win.document.removeEventListener("visibilitychange", schedule);
          win.cancelAnimationFrame(frame); frame = 0; snapshot = null;
        }
      };
    },
  };
}
