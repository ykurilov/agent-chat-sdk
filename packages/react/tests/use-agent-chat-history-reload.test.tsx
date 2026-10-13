// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAgentChat } from "../src/use-agent-chat";
import type { UseAgentChatOptions } from "../src/use-agent-chat";
import { useModelChoice } from "../src/use-model-choice";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

const pause = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

type Props = { reloadKey: number; generation: number };

/**
 * Приложение перерисовывается и передаёт новые функции (`fetch`, обработчики): новое поколение — новые функции.
 * `loadedSeen` — все значения `loaded`, что видел экран.
 */
function renderWithFreshCallbacks(server: ReturnType<typeof fakeChatServer>) {
  const loadedSeen: boolean[] = [];
  const view = renderHook(
    ({ reloadKey, generation }: Props) => {
      const callbacks = useMemo(
        () => ({
          fetch: ((input, init) => server.fetch(input, init)) satisfies typeof globalThis.fetch,
          onTurnRefused: () => undefined,
          onAppEvent: () => undefined,
          onExpectLiveAppEvents: () => undefined,
        }),
        [generation],
      );
      const chat = useAgentChat({ api: "/api/chat", chatId: "c1", ...callbacks, reloadKey } satisfies UseAgentChatOptions);
      loadedSeen.push(chat.loaded);
      return chat;
    },
    { initialProps: { reloadKey: 0, generation: 0 } as Props },
  );
  return { ...view, loadedSeen };
}

describe("useAgentChat: история не перезагружается от новых функций приложения", () => {
  it("новые функции при перерисовке не шлют повторный GET истории и не сбрасывают loaded", async () => {
    const server = fakeChatServer({ history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }] });
    const { result, rerender, loadedSeen } = renderWithFreshCallbacks(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const reads = server.requestsTo("history").length;
    loadedSeen.length = 0;

    rerender({ reloadKey: 0, generation: 1 });
    rerender({ reloadKey: 0, generation: 2 });
    await pause();

    expect(server.requestsTo("history")).toHaveLength(reads);
    expect(loadedSeen.every(Boolean)).toBe(true);
  });

  it("история того же чата перечитана: поле не пропадает, набранный текст на месте", async () => {
    const server = fakeChatServer({ history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }] });
    const { result, rerender, loadedSeen } = renderWithFreshCallbacks(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Мой черновик"));
    const reads = server.requestsTo("history").length;
    loadedSeen.length = 0;

    rerender({ reloadKey: 1, generation: 1 });
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(reads + 1));
    await pause();

    expect(loadedSeen.every(Boolean)).toBe(true);
    expect(result.current.value).toBe("Мой черновик");
    expect(result.current.canSubmit).toBe(true);
  });
});

describe("useModelChoice: меню не перечитывается от нового fetch", () => {
  it("новый fetch при перерисовке не шлёт повторный запрос меню и не возвращает «загрузку»", async () => {
    const server = fakeChatServer();
    const { result, rerender } = renderHook(({ generation }: { generation: number }) => {
      const fetch = useMemo<typeof globalThis.fetch>(() => (input, init) => server.fetch(input, init), [generation]);
      return useModelChoice({ api: "/api/chat", chatId: "c1", fetch });
    }, { initialProps: { generation: 0 } });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    rerender({ generation: 1 });
    rerender({ generation: 2 });
    await pause();

    expect(server.requestsTo("models")).toHaveLength(1);
    expect(result.current.providers).not.toEqual([]);
  });
});
