// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { englishLabels, russianLabels } from "../src/labels";
import type { ChatLabels } from "../src/labels";
import type { VoiceErrorDetails, VoiceErrorKind, VoiceInput, VoiceListener, VoiceStartContext } from "../src/voice-input";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";

setupChatDom();

function fakeVoice() {
  const starts: Array<{ listener: VoiceListener; context: VoiceStartContext | undefined }> = [];
  const voice: VoiceInput = {
    start(listener, context) {
      starts.push({ listener, context });
      return { stop: () => undefined, cancel: () => undefined };
    },
  };
  const fail = (kind: VoiceErrorKind, details?: VoiceErrorDetails) =>
    act(() => {
      starts.at(-1)!.listener.onError(kind, details);
      starts.at(-1)!.listener.onEnd();
    });
  return { voice, starts, fail };
}

async function renderWithVoice(labels?: ChatLabels) {
  const voice = fakeVoice();
  renderAgentChat(fakeChatServer(), { voice: voice.voice, ...(labels && { labels }) });
  await screen.findByLabelText("поле");
  fireEvent.click(document.querySelector("[data-voice]")!);
  return voice;
}

describe("AgentChat: чат и язык каждой диктовки", () => {
  it("диктовка начинается с чатом и языком экрана", async () => {
    const voice = await renderWithVoice();
    expect(voice.starts[0]!.context).toEqual({ chatId: "c1", language: "ru" });
  });

  it("английский словарь — английский язык диктовки", async () => {
    const voice = await renderWithVoice(englishLabels);
    expect(voice.starts[0]!.context).toEqual({ chatId: "c1", language: "en" });
  });
});

describe("AgentChat: причина отказа голоса — своя подпись", () => {
  it.each([
    ["limit", "Лимит расходов исчерпан, диктовка недоступна"],
    ["forbidden", "Нет доступа к диктовке"],
    ["too_long", "Запись слишком длинная"],
  ] as const)("%s", async (kind, text) => {
    const voice = await renderWithVoice();
    await voice.fail(kind);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("свой словарь без новых подписей — подписи по умолчанию на языке словаря", async () => {
    const { limit: _limit, ...withoutLimit } = englishLabels.voiceErrors;
    const voice = await renderWithVoice({ ...englishLabels, voiceErrors: withoutLimit });
    await voice.fail("limit");
    expect(screen.getByText(englishLabels.voiceErrors.limit!)).toBeTruthy();
  });
});

describe("AgentChat: предел записи — из настройки сервера", () => {
  it.each([
    [180, "Запись остановлена: предел 3 минуты"],
    [300, "Запись остановлена: предел 5 минут"],
    [60, "Запись остановлена: предел 1 минута"],
    [90, "Запись остановлена: предел 90 секунд"],
  ])("%s с", async (seconds, text) => {
    const voice = await renderWithVoice();
    await voice.fail("time_limit", { maxSessionSeconds: seconds });
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("английский словарь", async () => {
    const voice = await renderWithVoice(englishLabels);
    await voice.fail("time_limit", { maxSessionSeconds: 120 });
    expect(screen.getByText("Recording stopped: the limit is 2 minutes")).toBeTruthy();
  });

  it("старая строка в своём словаре по-прежнему работает", async () => {
    const voice = await renderWithVoice({ ...russianLabels, voiceErrors: { ...russianLabels.voiceErrors, time_limit: "Стоп по времени" } });
    await voice.fail("time_limit", { maxSessionSeconds: 180 });
    expect(screen.getByText("Стоп по времени")).toBeTruthy();
  });
});
