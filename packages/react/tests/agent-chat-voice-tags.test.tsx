// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, settle, setupChatDom } from "./support/chat-dom";

setupChatDom();

const answer = (text: string, state: "done" | "streaming" = "done"): HistoryMessage => ({
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text, state }],
  metadata: { status: "complete" },
});

const question: HistoryMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Расскажи [laughs] анекдот" }, { type: "data-voice-mode", data: true }],
};
const textQuestion: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Расскажи анекдот" }] };

async function shown(history: HistoryMessage[]) {
  const view = renderAgentChat(fakeChatServer({ history }));
  await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
  await settle();
  return view;
}

const agentText = () => [...document.querySelectorAll('[data-kind="text"]')].map((node) => node.textContent);

describe("AgentChat: теги голоса на экране", () => {
  it("в тексте ответа тегов нет, слова и законные скобки остаются", async () => {
    await shown([question, answer("[laughs] Ну вот [sighs] как-то так [1]. [sic] Да.")]);
    expect(agentText()).toEqual(["Ну вот как-то так [1]. [sic] Да."]);
  });

  it("недописанный тег в потоке ответа не мелькает", async () => {
    await shown([question, answer("Привет, [whisp", "streaming")]);
    expect(agentText()).toEqual(["Привет,"]);
  });

  it("недописанная скобка в завершённом ответе остаётся: это не тег", async () => {
    await shown([question, answer("Привет, [whisp", "done")]);
    expect(agentText()).toEqual(["Привет, [whisp"]);
  });

  it("слова самого человека не правятся: «[laughs]» в его сообщении остаётся", async () => {
    const view = await shown([question, answer("Хорошо.")]);
    expect(view.container.textContent).toContain("Расскажи [laughs] анекдот");
  });

  it("копирование ответа даёт текст без тегов", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await shown([question, answer("[laughs] Ну вот [sighs] как-то так [1].")]);

    fireEvent.click(document.querySelector('[data-action="copy"]')!);

    expect(writeText).toHaveBeenCalledWith("Ну вот как-то так [1].");
  });

  it("ответ из одних тегов на экране выглядит пустым", async () => {
    await shown([question, answer("[sighs]")]);
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-empty")).toBe("true");
  });

  it("ответ из одних тегов не предлагает «повторить»: сервер считает такой ответ непустым, признак один с обеих сторон", async () => {
    await shown([question, answer("[sighs]")]);
    expect(document.querySelector('[data-kind="answer-retry"]')).toBeNull();
  });

  it("совсем пустой ответ по-прежнему предлагает «повторить»", async () => {
    await shown([question, answer("")]);
    expect(document.querySelector('[data-kind="answer-retry"]')).not.toBeNull();
  });

  it("в текстовом режиме скобки остаются: «[docs]», «[error]», «[done]» и даже «[laughs]» — обычный текст", async () => {
    await shown([textQuestion, answer("Смотри [docs]: [error] упал, [done] потом [laughs] ещё.")]);
    expect(agentText()).toEqual(["Смотри [docs]: [error] упал, [done] потом [laughs] ещё."]);
  });

  it("копирование ответа текстового режима отдаёт скобки как есть", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await shown([textQuestion, answer("См. [docs] и [config].")]);

    fireEvent.click(document.querySelector('[data-action="copy"]')!);

    expect(writeText).toHaveBeenCalledWith("См. [docs] и [config].");
  });

  it("ответ из одних тегов в тексте не рисуется пустым: в текстовом режиме это обычные скобки", async () => {
    await shown([textQuestion, answer("[sighs]")]);
    expect(agentText()).toEqual(["[sighs]"]);
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-empty")).not.toBe("true");
  });

  it("ответ после перезагрузки: отметка на вопросе приходит с историей, теги по-прежнему скрыты", async () => {
    await shown([question, answer("[whispers] Тише [docs]")]);
    expect(agentText()).toEqual(["Тише"]);
  });
});
