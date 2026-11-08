// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePageRequestLifetime } from "../../src/liveness/page-request-lifetime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("early abort is owned by active requests, does not request a prompt, and recovers a cancelled leave", async () => {
  const { result } = renderHook(usePageRequestLifetime);
  const page = result.current;
  const restored = vi.fn(); page.onRestore = restored;
  // No request: no early handler.
  act(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  expect(page.controller.signal.aborted).toBe(false);
  const release = page.acquireEarly();
  const event = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(page.controller.signal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(restored).toHaveBeenCalledTimes(1);
  expect(page.controller.signal.aborted).toBe(false);
  page.suspended = false; page.syncEarly?.();
  release(); release();
  expect(page.earlyRequests).toBe(0);
  act(() => window.dispatchEvent(new Event("beforeunload")));
  expect(page.controller.signal.aborted).toBe(false);
});

it("pagehide cancels pending recovery and only persisted pageshow reopens the lifetime", async () => {
  const { result, unmount } = renderHook(usePageRequestLifetime);
  const page = result.current;
  const restored = vi.fn(); page.onRestore = restored;
  page.acquireEarly();
  act(() => window.dispatchEvent(new Event("beforeunload")));
  act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(restored).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event("pointerdown")));
  expect(page.controller.signal.aborted).toBe(true);
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  expect(restored).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(restored).toHaveBeenCalledTimes(1);
  unmount();
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(restored).toHaveBeenCalledTimes(1);
});

it("first interaction restores a surviving document even when painting has not resumed", () => {
  const { result } = renderHook(usePageRequestLifetime);
  const restored = vi.fn(); result.current.onRestore = restored;
  result.current.acquireEarly();
  act(() => window.dispatchEvent(new Event("beforeunload")));
  act(() => window.dispatchEvent(new Event("keydown")));
  expect(restored).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  "Mozilla/5.0 Gecko/20100101 Firefox/140.0",
  "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
])("does not install the WebKit beforeunload workaround for %s", userAgent => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  const { result } = renderHook(usePageRequestLifetime);
  result.current.acquireEarly();
  act(() => window.dispatchEvent(new Event("beforeunload")));
  expect(result.current.controller.signal.aborted).toBe(false);
  act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  expect(result.current.controller.signal.aborted).toBe(true);
});
