// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";
import type { CompactionRecord } from "./support/fake-chat-server";

const record: CompactionRecord = {
  id: "c1",
  fromMessageId: "u1",
  throughMessageId: "a1",
  summary: "## Цель\nПереезд",
  summaryTokens: 40,
  createdAt: "2026-03-01T10:09:00.000Z",
};
const history = [
  { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Привет" }] },
  { id: "a1", role: "assistant" as const, parts: [{ type: "text", text: "Здравствуйте", state: "done" }], metadata: { status: "complete" } },
];

afterEach(cleanup);

describe("useAgentChat: записи сжатия", () => {
  it("берёт записи из истории; пока сжатие не идёт, лёгкий адрес не спрашивает", async () => {
    const server = fakeChatServer({ history });
    server.state.compactions = [record];
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.compactions).toEqual([record]);
    expect(server.requestsTo("compactions")).toHaveLength(0);
  });

  it("без сжатий — пустой список", async () => {
    const { result } = renderChatHook(fakeChatServer({ history }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.compactions).toEqual([]);
  });

  describe("опрос", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** С поддельными часами `waitFor` не тикает: время двигаем сами, пока условие не выполнится. */
    async function until(condition: () => boolean) {
      for (let step = 0; step < 100 && !condition(); step++) await act(() => vi.advanceTimersByTimeAsync(20));
      expect(condition()).toBe(true);
    }

    async function loaded(server: ReturnType<typeof fakeChatServer>) {
      const rendered = renderChatHook(server);
      await until(() => rendered.result.current.loaded);
      return rendered;
    }

    it("история пришла с идущим сжатием: спрашивает /compactions, пока идёт, и показывает запись, когда она готова", async () => {
      const server = fakeChatServer({ history });
      server.state.compacting = true;
      const { result } = await loaded(server);
      expect(result.current.compactions).toEqual([]);

      await act(() => vi.advanceTimersByTimeAsync(1_600));
      expect(server.requestsTo("compactions").length).toBeGreaterThanOrEqual(1);
      expect(result.current.compactions).toEqual([]);

      server.state.compactions = [record];
      server.state.compacting = false;
      await act(() => vi.advanceTimersByTimeAsync(1_600));
      expect(result.current.compactions).toEqual([record]);

      const asked = server.requestsTo("compactions").length;
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(server.requestsTo("compactions")).toHaveLength(asked);
    });

    it("после законченного ответа проверяет /compactions один раз и показывает новую запись", async () => {
      const server = fakeChatServer({ history });
      const { result } = await loaded(server);
      act(() => result.current.setValue("Ещё вопрос"));
      act(() => result.current.submit());
      await until(() => server.streams.length === 1);
      server.streams[0]!.answer("Готово", "a2");
      await until(() => !result.current.busy);
      expect(server.requestsTo("compactions")).toHaveLength(0);

      server.state.compactions = [record];
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(server.requestsTo("compactions")).toHaveLength(1);
      expect(result.current.compactions).toEqual([record]);

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(server.requestsTo("compactions")).toHaveLength(1);
    });

    it("сжатие тянется дольше двух минут — опрос продолжается и показывает запись, когда она готова", async () => {
      const server = fakeChatServer({ history });
      server.state.compacting = true;
      const { result } = await loaded(server);
      await act(() => vi.advanceTimersByTimeAsync(300_000));
      const asked = server.requestsTo("compactions").length;
      expect(asked).toBeGreaterThan(100);
      await act(() => vi.advanceTimersByTimeAsync(3_000));
      expect(server.requestsTo("compactions").length).toBeGreaterThan(asked);

      server.state.compactions = [record];
      server.state.compacting = false;
      await act(() => vi.advanceTimersByTimeAsync(1_600));
      expect(result.current.compactions).toEqual([record]);
    });

    it("сжатие не кончается дольше, чем оно вообще может идти (10 минут на сервере) — опрос сдаётся", async () => {
      const server = fakeChatServer({ history });
      server.state.compacting = true;
      const { result } = await loaded(server);
      await act(() => vi.advanceTimersByTimeAsync(13 * 60_000));
      const asked = server.requestsTo("compactions").length;
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(server.requestsTo("compactions")).toHaveLength(asked);
      expect(result.current.compactions).toEqual([]);
    });

    it("сбой лёгкого запроса не ломает чат: опрос продолжается", async () => {
      const server = fakeChatServer({ history });
      server.state.compacting = true;
      const { result } = await loaded(server);
      server.state.fail.add("compactions");
      await act(() => vi.advanceTimersByTimeAsync(3_200));
      expect(result.current.loadFailed).toBe(false);
      expect(result.current.connection).toBe("online");
      server.state.fail.delete("compactions");
      server.state.compactions = [record];
      server.state.compacting = false;
      await act(() => vi.advanceTimersByTimeAsync(1_600));
      expect(result.current.compactions).toEqual([record]);
    });

    it("уход со страницы останавливает опрос", async () => {
      const server = fakeChatServer({ history });
      server.state.compacting = true;
      const { unmount } = await loaded(server);
      await act(() => vi.advanceTimersByTimeAsync(1_600));
      unmount();
      const asked = server.requestsTo("compactions").length;
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(server.requestsTo("compactions")).toHaveLength(asked);
    });
  });
});
