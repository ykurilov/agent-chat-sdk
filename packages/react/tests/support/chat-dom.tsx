import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { AgentChat } from "../../src/agent-chat";
import type { AgentChatProps } from "../../src/agent-chat";
import { ChatLabelsProvider } from "../../src/labels";
import type { ChatLabels } from "../../src/labels";
import { useAgentChat } from "../../src/use-agent-chat";
import type { UseAgentChatOptions } from "../../src/use-agent-chat";
import type { fakeChatServer } from "./fake-chat-server";
import { installFakeLayout, SCROLL_TO_END_SETTLE_MS } from "./fake-layout";
import { stubSkin } from "./stub-skin";

type Server = ReturnType<typeof fakeChatServer>;

/** Замеры для окна ленты на время каждого теста файла и полная уборка после него (автоуборки RTL в vitest нет). */
export function setupChatDom() {
  let layout: ReturnType<typeof installFakeLayout>;
  beforeEach(() => {
    layout = installFakeLayout();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    layout.uninstall();
  });
}

/** Подменяет `fetch` сервером и рисует чат со скином-заглушкой; `labels` — свой словарь надписей. */
export function renderAgentChat(
  server: Server,
  { labels, ...props }: Partial<AgentChatProps> & { labels?: ChatLabels } = {},
) {
  vi.stubGlobal("fetch", server.fetch);
  const chat = <AgentChat api="/api/chat" chatId="c1" skin={stubSkin} {...props} />;
  return render(labels ? <ChatLabelsProvider labels={labels}>{chat}</ChatLabelsProvider> : chat);
}

/** Хук чата c1 на подменённом сервере; `rerender({ chatId })` меняет чат. */
export function renderChatHook(server: Server, options: Partial<UseAgentChatOptions> = {}) {
  return renderHook(
    ({ chatId }: { chatId: string }) => useAgentChat({ api: "/api/chat", chatId, fetch: server.fetch, ...options }),
    { initialProps: { chatId: "c1" } },
  );
}

/** Набирает вопрос в поле и отправляет форму. */
export function submitQuestion(text: string) {
  const field = screen.getByLabelText("поле");
  fireEvent.change(field, { target: { value: text } });
  fireEvent.submit(field.closest("form")!);
}

/** Отправляет вопрос и ждёт, пока сервер откроет поток ответа. */
export async function sendQuestion(server: Server, text: string) {
  await screen.findByLabelText("поле");
  submitQuestion(text);
  await waitFor(() => expect(server.streams).toHaveLength(1));
  return server.streams[0]!;
}

/** Виды компонентов скина-заглушки на странице, в порядке документа. */
export function kinds(container: ParentNode = document): string[] {
  return [...container.querySelectorAll("[data-kind]")].map((element) => element.getAttribute("data-kind") ?? "");
}

/** Даёт окну ленты замеры и обновления после действия. */
export async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Ждёт, пока лента при первом показе встанет на низ. */
export async function waitForFeedPositioned() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SCROLL_TO_END_SETTLE_MS));
  });
}
