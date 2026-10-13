// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatListEntry } from "../../src/chat-list/chat-list-client";
import { useWorkspaceListSync } from "../../src/chat-list/use-workspace-list-sync";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const entry = (id: string, title: string | null): ChatListEntry => ({ id, title, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

function renderSync(initial: { busy: boolean; items: ChatListEntry[]; activeChatId: string | null }) {
  const refresh = vi.fn(async () => {});
  const hook = renderHook((props: typeof initial) => useWorkspaceListSync({ items: props.items, activeChatId: props.activeChatId, refresh }, props.busy), {
    initialProps: initial,
  });
  return { refresh, rerender: hook.rerender };
}

describe("useWorkspaceListSync: тихое обновление списка вокруг открытого чата", () => {
  it("смена занятости (начался и закончился ответ) — по одному обновлению; первое значение — без обновления", () => {
    const items = [entry("c1", "Первый")];
    const { refresh, rerender } = renderSync({ busy: false, items, activeChatId: "c1" });
    expect(refresh).not.toHaveBeenCalled();
    rerender({ busy: true, items, activeChatId: "c1" });
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ busy: true, items, activeChatId: "c1" });
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ busy: false, items, activeChatId: "c1" });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("пока идёт ответ и у открытого чата нет названия — опрос раз в секунду; название появилось — опрос стоп", () => {
    const { refresh, rerender } = renderSync({ busy: true, items: [entry("c1", null)], activeChatId: "c1" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(refresh).toHaveBeenCalledTimes(3);
    rerender({ busy: true, items: [entry("c1", "Про Грецию")], activeChatId: "c1" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("у открытого чата есть название или ответа нет — опроса нет", () => {
    const named = renderSync({ busy: true, items: [entry("c1", "Первый")], activeChatId: "c1" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(named.refresh).not.toHaveBeenCalled();
    cleanup();
    const idle = renderSync({ busy: false, items: [entry("c1", null)], activeChatId: "c1" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(idle.refresh).not.toHaveBeenCalled();
  });
});
