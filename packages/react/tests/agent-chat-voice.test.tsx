// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DictatedText, VoiceErrorKind, VoiceInput, VoiceListener } from "../src/voice-input";
import { russianLabels } from "../src/labels";
import { steeringStubSkin } from "./support/stub-skin";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, settle, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

/** Голосовой ввод под управлением теста: слушатель каждой диктовки доступен, остановки и отмены записаны. */
function fakeVoice() {
  const dictations: Array<{ listener: VoiceListener; stopped: boolean; cancelled: boolean }> = [];
  const voice: VoiceInput = {
    start(listener) {
      const dictation = { listener, stopped: false, cancelled: false };
      dictations.push(dictation);
      return {
        stop: () => void (dictation.stopped = true),
        cancel: () => void (dictation.cancelled = true),
      };
    },
  };
  const current = () => dictations.at(-1)!;
  return {
    voice,
    dictations,
    current,
    connect: () => act(() => current().listener.onConnected()),
    say: (text: DictatedText) => act(() => current().listener.onText(text)),
    fail: (kind: VoiceErrorKind) =>
      act(() => {
        current().listener.onError(kind);
        current().listener.onEnd();
      }),
    end: () => act(() => current().listener.onEnd()),
    polishing: () => act(() => current().listener.onPolishing?.()),
    polished: (text: string) => act(() => current().listener.onPolished?.(text)),
  };
}

const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const micButton = () => document.querySelector("[data-voice]") as HTMLButtonElement | null;
const micState = () => micButton()?.getAttribute("data-state");
const polishingShown = () => micButton()?.getAttribute("data-polishing") === "true";
const pressMic = () => fireEvent.click(micButton()!);

async function renderWithVoice(extra: Partial<Parameters<typeof renderAgentChat>[1]> = {}) {
  const voice = fakeVoice();
  const server = fakeChatServer();
  const view = renderAgentChat(server, { voice: voice.voice, ...extra });
  await screen.findByLabelText("поле");
  return { ...voice, server, view };
}

describe("AgentChat: голосовой ввод", () => {
  it("без голоса кнопки микрофона нет", async () => {
    renderAgentChat(fakeChatServer());
    await screen.findByLabelText("поле");

    expect(micButton()).toBeNull();
  });

  it("с голосом кнопка есть, в покое подписана «Диктовать»", async () => {
    await renderWithVoice();

    expect(micButton()).not.toBeNull();
    expect(micState()).toBe("idle");
    expect(micButton()!.getAttribute("aria-label")).toBe(russianLabels.voiceStart);
  });

  it("нажатие начинает диктовку: подключение, затем запись", async () => {
    const voice = await renderWithVoice();

    pressMic();
    expect(voice.dictations).toHaveLength(1);
    expect(micState()).toBe("connecting");
    expect(micButton()!.getAttribute("aria-label")).toBe(russianLabels.voiceConnecting);

    await voice.connect();
    expect(micState()).toBe("listening");
    expect(micButton()!.getAttribute("aria-label")).toBe(russianLabels.voiceStop);
  });

  it("слова появляются в поле по ходу речи, промежуточные заменяются", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();

    await voice.say({ finalText: "", interimText: "При" });
    expect(field().value).toBe("При");
    await voice.say({ finalText: "Привет", interimText: " ми" });
    expect(field().value).toBe("Привет ми");
    await voice.say({ finalText: "Привет мир", interimText: "" });
    expect(field().value).toBe("Привет мир");
  });

  it("диктовка дописывается к уже набранному", async () => {
    const voice = await renderWithVoice();
    fireEvent.change(field(), { target: { value: "Слушай," } });

    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Привет", interimText: "" });

    expect(field().value).toBe("Слушай, Привет");
  });

  it("ручная правка во время диктовки остаётся, сказанное раньше не дублируется", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Привет", interimText: "" });

    fireEvent.change(field(), { target: { value: "Привет," } });
    await voice.say({ finalText: "Привет мир", interimText: "" });

    expect(field().value).toBe("Привет, мир");
  });

  it("повторное нажатие — стоп: запись закончена, остаток речи дописывается, затем покой", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Привет", interimText: " ми" });

    pressMic();
    expect(voice.current().stopped).toBe(true);
    expect(micState()).toBe("stopping");

    await voice.say({ finalText: "Привет мир", interimText: "" });
    await voice.end();

    expect(micState()).toBe("idle");
    expect(field().value).toBe("Привет мир");
  });

  it("нажатие во время подключения отменяет запуск, поздние события игнорируются", async () => {
    const voice = await renderWithVoice();
    pressMic();
    const first = voice.current();

    pressMic();

    expect(first.cancelled).toBe(true);
    expect(micState()).toBe("idle");
    await act(async () => {
      first.listener.onConnected();
      first.listener.onText({ finalText: "поздно", interimText: "" });
    });
    expect(micState()).toBe("idle");
    expect(field().value).toBe("");
  });

  it("можно диктовать несколько раз подряд: текст копится", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Раз", interimText: "" });
    pressMic();
    await voice.end();

    pressMic();
    await voice.connect();
    await voice.say({ finalText: "два", interimText: "" });

    expect(voice.dictations).toHaveLength(2);
    expect(field().value).toBe("Раз два");
  });

  it("голос сам ничего не отправляет; отправка — обычная, с тем, что стоит в поле", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Привет", interimText: "" });
    await settle();
    expect(voice.server.streams).toHaveLength(0);

    pressMic();
    await voice.end();
    fireEvent.change(field(), { target: { value: "Привет, мир" } });
    submitQuestion("Привет, мир");

    await waitFor(() => expect(voice.server.streams).toHaveLength(1));
  });

  it("во время ответа агента диктовка работает: текст копится, отправка ждёт", async () => {
    const voice = await renderWithVoice();
    await sendQuestion(voice.server, "Первый вопрос");

    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Второй", interimText: "" });

    expect(field().value).toBe("Второй");
    expect((screen.getByText("послать") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AgentChat: отправка во время диктовки", () => {
  it("отправка останавливает диктовку: запись брошена, поздние слова не начинают новое сообщение", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Привет", interimText: "" });
    const dictation = voice.current();

    submitQuestion("Привет");

    await waitFor(() => expect(voice.server.streams).toHaveLength(1));
    expect(dictation.cancelled).toBe(true);
    expect(micState()).toBe("idle");
    await act(async () => dictation.listener.onText({ finalText: "Привет мир", interimText: "" }));
    expect(field().value).toBe("");
  });

  it("отправка, которая не состоится (идёт ответ), диктовку не трогает", async () => {
    const voice = await renderWithVoice();
    await sendQuestion(voice.server, "Первый вопрос");
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Второй", interimText: "" });

    submitQuestion("Второй");

    expect(voice.current().cancelled).toBe(false);
    expect(micState()).toBe("listening");
  });

  it("поправка во время ответа (скин рисует поправки), как отправка, останавливает диктовку", async () => {
    const voice = await renderWithVoice({ skin: steeringStubSkin });
    await sendQuestion(voice.server, "Первый вопрос");
    voice.server.streams[0]!.push({ type: "start", messageId: "a1" });
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Второй", interimText: "" });

    submitQuestion("Второй");

    await waitFor(() => expect(voice.server.requestsTo("steer")).toHaveLength(1));
    expect(voice.current().cancelled).toBe(true);
  });
});

describe("AgentChat: ошибки голоса", () => {
  it.each<[VoiceErrorKind, string]>([
    ["permission_denied", russianLabels.voiceErrors.permission_denied],
    ["no_microphone", russianLabels.voiceErrors.no_microphone],
    ["network", russianLabels.voiceErrors.network],
    ["rate_limited", russianLabels.voiceErrors.rate_limited],
    ["time_limit", "Запись остановлена: предел 5 минут"],
  ])("%s: понятное сообщение из словаря, кнопка в покое", async (kind, message) => {
    const voice = await renderWithVoice();
    pressMic();

    await voice.fail(kind);

    expect(screen.getByText(message)).toBeTruthy();
    expect(micState()).toBe("idle");
  });

  it("распознанное до ошибки остаётся в поле, сообщение не стирается собственной записью", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "Привет", interimText: "" });

    await act(async () => {
      voice.current().listener.onText({ finalText: "Привет мир", interimText: "" });
      voice.current().listener.onError("network");
      voice.current().listener.onEnd();
    });

    expect(field().value).toBe("Привет мир");
    expect(screen.getByText(russianLabels.voiceErrors.network)).toBeTruthy();
  });

  it("чат работает дальше: печать и отправка не заблокированы ошибкой", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.fail("service_unavailable");
    expect(screen.getByText(russianLabels.voiceErrors.service_unavailable)).toBeTruthy();

    fireEvent.change(field(), { target: { value: "Печатаю" } });
    submitQuestion("Печатаю");

    await waitFor(() => expect(voice.server.streams).toHaveLength(1));
  });

  it("сообщение исчезает: при новой диктовке", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.fail("no_microphone");

    pressMic();

    expect(screen.queryByText(russianLabels.voiceErrors.no_microphone)).toBeNull();
  });

  it("сообщение исчезает: при правке текста руками", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.fail("no_microphone");

    fireEvent.change(field(), { target: { value: "а" } });

    expect(screen.queryByText(russianLabels.voiceErrors.no_microphone)).toBeNull();
  });

  it("сообщение исчезает: при отправке", async () => {
    const voice = await renderWithVoice();
    fireEvent.change(field(), { target: { value: "Вопрос" } });
    pressMic();
    await voice.fail("network");
    expect(screen.getByText(russianLabels.voiceErrors.network)).toBeTruthy();

    submitQuestion("Вопрос");

    await waitFor(() => expect(screen.queryByText(russianLabels.voiceErrors.network)).toBeNull());
  });
});

describe("AgentChat: конец экрана и смена чата", () => {
  it("закрытие экрана во время диктовки отменяет её", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();

    voice.view.unmount();

    expect(voice.current().cancelled).toBe(true);
  });

  it("смена чата отменяет диктовку, кнопка возвращается в покой", async () => {
    const voice = await renderWithVoice();
    pressMic();
    await voice.connect();

    voice.view.rerender(<VoiceChatOf chatId="c2" voice={voice.voice} />);
    await screen.findByLabelText("поле");

    expect(voice.current().cancelled).toBe(true);
    await waitFor(() => expect(micState()).toBe("idle"));
  });

  it("без диктовки ничего не отменяется при закрытии экрана", async () => {
    const start = vi.fn();
    const view = renderAgentChat(fakeChatServer(), { voice: { start } });
    await screen.findByLabelText("поле");

    view.unmount();

    expect(start).not.toHaveBeenCalled();
  });
});

import { AgentChat } from "../src/agent-chat";
import { stubSkin } from "./support/stub-skin";

function VoiceChatOf({ chatId, voice }: { chatId: string; voice: VoiceInput }) {
  return <AgentChat api="/api/chat" chatId={chatId} skin={stubSkin} voice={voice} />;
}

describe("AgentChat: чистка надиктованного текста", () => {
  /** Диктовка доведена до «стоп» и метки <fin>: текст закреплён, сервер чистит. */
  async function stoppedAndPolishing(startText = "") {
    const voice = await renderWithVoice();
    if (startText) {
      fireEvent.change(field(), { target: { value: startText } });
    }
    pressMic();
    await voice.connect();
    await voice.say({ finalText: "ну э-э привет", interimText: "" });
    pressMic();
    await voice.say({ finalText: "ну э-э привет", interimText: "" });
    await voice.polishing();
    return voice;
  }

  it("пока идёт чистка, слушатель это показывает: тихий признак у кнопки, текст в поле не меняется", async () => {
    await stoppedAndPolishing();

    expect(polishingShown()).toBe(true);
    expect(micState()).toBe("stopping");
    expect(field().value).toBe("ну э-э привет");
  });

  it("чистка пришла — в поле исправленный текст, признак снят после конца", async () => {
    const voice = await stoppedAndPolishing();

    await voice.polished("Привет.");
    await voice.end();

    expect(field().value).toBe("Привет.");
    expect(polishingShown()).toBe(false);
    expect(micState()).toBe("idle");
  });

  it("набранное до диктовки остаётся, заменяется только надиктованное", async () => {
    const voice = await stoppedAndPolishing("Слушай,");

    await voice.polished("Привет.");
    await voice.end();

    expect(field().value).toBe("Слушай, Привет.");
  });

  it("человек дописал в поле во время чистки — правка не затёрта, чистка встаёт на место надиктованного", async () => {
    const voice = await stoppedAndPolishing();

    fireEvent.change(field(), { target: { value: "ну э-э привет и всё" } });
    await voice.polished("Привет.");
    await voice.end();

    expect(field().value).toBe("Привет. и всё");
  });

  it("поздний текст от Soniox во время чистки не стирает то, что человек дописал", async () => {
    const voice = await stoppedAndPolishing();

    fireEvent.change(field(), { target: { value: "ну э-э привет и всё" } });
    await voice.say({ finalText: "ну э-э привет", interimText: "" });
    await voice.polished("Привет.");
    await voice.end();

    expect(field().value).toBe("Привет. и всё");
  });

  it("человек поправил само надиктованное во время чистки — его правка остаётся как есть, чистка отброшена", async () => {
    const voice = await stoppedAndPolishing();

    fireEvent.change(field(), { target: { value: "ну эээ привет" } });
    await voice.polished("Привет.");
    await voice.end();

    expect(field().value).toBe("ну эээ привет");
  });

  it("чистка не пришла (сбой, тишина) — остаётся текст Soniox, без ошибки", async () => {
    const voice = await stoppedAndPolishing();

    await voice.end();

    expect(field().value).toBe("ну э-э привет");
    expect(screen.queryByRole("status")).toBeNull();
    expect(micState()).toBe("idle");
  });

  it("отправка во время чистки бросает диктовку: исправленный текст не начинает новое сообщение", async () => {
    const voice = await stoppedAndPolishing();
    const dictation = voice.current();

    submitQuestion("ну э-э привет");
    await waitFor(() => expect(voice.server.streams).toHaveLength(1));
    await act(async () => dictation.listener.onPolished?.("Привет."));

    expect(field().value).toBe("");
    expect(polishingShown()).toBe(false);
  });
});
