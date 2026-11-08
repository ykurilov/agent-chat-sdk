import { useEffect, useRef } from "react";

interface PageRequestLifetime {
  controller: AbortController;
  suspended: boolean;
  restoring: boolean;
  acquireEarly: () => () => void;
  earlyRequests: number;
  syncEarly?: (() => void) | undefined;
  onHide?: () => void;
  onRestore?: (signal: AbortSignal) => void;
}

/** Abort before WebKit tears down fetch itself; a cached document gets a fresh lifetime on return. */
export function usePageRequestLifetime(): PageRequestLifetime {
  const ref = useRef<PageRequestLifetime | null>(null);
  if (!ref.current) {
    const page: PageRequestLifetime = {
      controller: new AbortController(), suspended: false, restoring: false, earlyRequests: 0,
      acquireEarly: () => {
        page.earlyRequests++;
        page.syncEarly?.();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          page.earlyRequests--;
          page.syncEarly?.();
        };
      },
    };
    ref.current = page;
  }
  useEffect(() => {
    const page = ref.current!;
    // React StrictMode rehearses cleanup/setup without creating a new component instance.
    if (page.controller.signal.aborted) page.controller = new AbortController();
    page.suspended = false;
    page.restoring = false;
    let hidden = false;
    let restoreFrame: number | undefined;
    const cancelRestore = () => { if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame); restoreFrame = undefined; };
    const removeRecovery = () => {
      cancelRestore();
      window.removeEventListener("pointerdown", recoverAfterInteraction, true);
      window.removeEventListener("keydown", recoverAfterInteraction, true);
      window.removeEventListener("focus", recoverAfterInteraction, true);
      document.removeEventListener("visibilitychange", recoverWhenVisible);
    };
    function recoverAfterInteraction() { if (!hidden) restore(); }
    function recoverWhenVisible() { if (document.visibilityState === "visible") recoverAfterInteraction(); }
    const hide = () => {
      if (page.controller.signal.aborted) return;
      page.suspended = true;
      page.restoring = false;
      page.syncEarly?.();
      page.controller.abort();
      page.onHide?.();
    };
    const restore = () => {
      removeRecovery();
      if (!page.controller.signal.aborted) return;
      page.controller = new AbortController();
      page.restoring = true;
      page.onRestore?.(page.controller.signal);
    };
    const show = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      hidden = false;
      removeRecovery();
      restore();
    };
    const pageHide = () => {
      hidden = true;
      removeRecovery();
      hide();
    };
    const beforeUnload = () => {
      hide();
      removeRecovery();
      window.addEventListener("pointerdown", recoverAfterInteraction, true);
      window.addEventListener("keydown", recoverAfterInteraction, true);
      window.addEventListener("focus", recoverAfterInteraction, true);
      document.addEventListener("visibilitychange", recoverWhenVisible);
      // A cancelled leave prompt keeps this document alive and does not send pageshow.
      // A departing document stops painting. A cancelled prompt continues rendering it.
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = requestAnimationFrame(() => { if (!hidden) restore(); });
      });
    };
    // WebKit stops pending fetches before pagehide. Other engines need no earlier handler;
    // in particular, avoid disabling Firefox's page cache with a beforeunload listener.
    const early = /AppleWebKit/.test(navigator.userAgent) && !/(?:Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
    let listening = false;
    page.syncEarly = () => {
      const needed = early && page.earlyRequests > 0 && !page.suspended;
      if (needed === listening) return;
      listening = needed;
      if (needed) window.addEventListener("beforeunload", beforeUnload);
      else window.removeEventListener("beforeunload", beforeUnload);
    };
    page.syncEarly();
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", show);
    return () => {
      page.syncEarly = undefined;
      window.removeEventListener("beforeunload", beforeUnload);
      removeRecovery();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", show);
      page.suspended = true;
      page.restoring = false;
      page.controller.abort();
    };
  }, []);
  return ref.current;
}
