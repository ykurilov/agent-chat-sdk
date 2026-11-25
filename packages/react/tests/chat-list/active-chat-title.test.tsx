// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { activeChatTitle, useReportedChatTitle } from "../../src/chat-list/active-chat-title";
import { russianLabels } from "../../src/labels";

describe("название открытого чата для шапки", () => {
  it("поздний отчёт прежнего чата не затирает название открытого", () => {
    const { result } = renderHook(() => useReportedChatTitle());
    act(() => result.current[1]({ chatId: "lesson-2", title: "Урок 2" }));
    act(() => result.current[1]({ chatId: "lesson-1", title: "Урок 1" }));
    expect(activeChatTitle({ items: [], activeChatId: "lesson-2" }, russianLabels, result.current[0])).toBe("Урок 2");
  });

  it("чат из списка без названия берёт название из своей истории; название в списке главнее", () => {
    const { result } = renderHook(() => useReportedChatTitle());
    act(() => result.current[1]({ chatId: "c1", title: "Из истории" }));
    const items = [{ id: "c1", title: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }];
    expect(activeChatTitle({ items, activeChatId: "c1" }, russianLabels, result.current[0])).toBe("Из истории");
    expect(activeChatTitle({ items: [{ ...items[0]!, title: "Переименован" }], activeChatId: "c1" }, russianLabels, result.current[0])).toBe("Переименован");
    expect(activeChatTitle({ items, activeChatId: "c2" }, russianLabels, result.current[0])).toBe(russianLabels.chatListUntitled);
  });
});
