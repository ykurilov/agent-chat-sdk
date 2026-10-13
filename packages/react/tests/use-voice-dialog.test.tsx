// @vitest-environment jsdom
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentChat } from "../src/use-agent-chat";
import { useVoiceDialog } from "../src/use-voice-dialog";
import type { AnswerEnd, AssistantActivity, AssistantTextDelta, DialogChatBridge, VoiceDialogEngine, VoiceDialogView } from "../src/voice-dialog";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

/** Движок-заглушка: запоминает мост и дальше делает то, что скажет тест. */
function fakeEngine() {
  const opened: Array<{ chatId: string; chat: DialogChatBridge; onView: (view: VoiceDialogView) => void }> = [];
  const engine: VoiceDialogEngine = {
    open: (options) => void opened.push(options),
    close: vi.fn(),
    selectVoice: vi.fn(async () => {}),
    loadVoices: async () => ({ voices: [], current: "", persisted: false }),
  };
  const listening = (): VoiceDialogView => ({ state: "listening", speechAvailable: true, onToggle: () => {} });
  return { engine, opened, bridge: () => opened.at(-1)!.chat, listening };
}

/** Записывает всё, что мост сообщает движку. */
function listen(bridge: DialogChatBridge) {
  const deltas: AssistantTextDelta[] = [];
  const ends: AnswerEnd[] = [];
  bridge.subscribeAssistantText((delta) => deltas.push(delta));
  bridge.subscribeAnswerEnd((end) => ends.push(end));
  return { deltas, ends };
}

const textOf = (deltas: AssistantTextDelta[], partIndex: number) =>
  deltas
    .filter((delta) => delta.partIndex === partIndex)
    .map((delta) => delta.text)
    .join("");

async function openDialog(server: ReturnType<typeof fakeChatServer>) {
  const fake = fakeEngine();
  renderAgentChat(server, { voiceDialog: fake.engine });
  const button = await screen.findByLabelText("голосовой режим");
  fireEvent.click(button);
  await waitFor(() => expect(fake.opened).toHaveLength(1));
  return { ...fake, button };
}

describe("кнопка голосового режима в чате", () => {
  it("без параметра voiceDialog кнопки нет, а диктовка работает как раньше", async () => {
    const server = fakeChatServer();
    renderAgentChat(server, {
      voice: { start: async () => ({ stop: async () => {}, cancel: () => {} }) } as never,
    });
    await screen.findByLabelText("поле");
    expect(screen.queryByLabelText("голосовой режим")).toBeNull();
  });

  it("с параметром кнопка есть: режим выключен, нажатие открывает движок с чатом и мостом", async () => {
    const server = fakeChatServer();
    const fake = fakeEngine();
    renderAgentChat(server, { voiceDialog: fake.engine });
    const button = await screen.findByLabelText("голосовой режим");
    expect(button.getAttribute("data-state")).toBe("off");
    expect(fake.opened).toHaveLength(0);

    fireEvent.click(button);

    expect(fake.opened).toHaveLength(1);
    expect(fake.opened[0]?.chatId).toBe("c1");
    expect(typeof fake.bridge().send).toBe("function");
  });

  it("вид от движка доходит до скина, а onToggle у него от чата", async () => {
    const server = fakeChatServer();
    const { opened, button, listening } = await openDialog(server);

    act(() => opened[0]!.onView({ ...listening(), state: "speaking" }));
    expect(button.getAttribute("data-state")).toBe("speaking");

    act(() => opened[0]!.onView({ ...listening(), state: "error", error: "network" }));
    expect(button.getAttribute("data-state")).toBe("error");
    expect(button.getAttribute("data-error")).toBe("network");
  });

  it("нажатие в работающем режиме закрывает движок и возвращает вид «выключен»", async () => {
    const server = fakeChatServer();
    const { engine, opened, button, listening } = await openDialog(server);
    act(() => opened[0]!.onView(listening()));

    fireEvent.click(button);

    expect(engine.close).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("data-state")).toBe("off");
  });

  it("после ошибки нажатие («Выйти» на панели) закрывает режим: причина остаётся на экране, а следующее нажатие открывает заново", async () => {
    const server = fakeChatServer();
    const { engine, opened, button } = await openDialog(server);
    act(() => opened[0]!.onView({ state: "error", error: "microphone_denied", speechAvailable: true, onToggle: () => {} }));

    fireEvent.click(button);

    expect(engine.close).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(1);
    expect(button.getAttribute("data-state")).toBe("off");
    expect(button.getAttribute("data-error")).toBe("microphone_denied");

    fireEvent.click(button);

    expect(opened).toHaveLength(2);
    expect(button.getAttribute("data-state")).toBe("connecting");
    expect(button.getAttribute("data-error") || null).toBeNull();
  });

  it("уход со страницы чата закрывает режим", async () => {
    const server = fakeChatServer();
    const fake = fakeEngine();
    const view = renderAgentChat(server, { voiceDialog: fake.engine });
    fireEvent.click(await screen.findByLabelText("голосовой режим"));
    expect(fake.opened).toHaveLength(1);

    view.unmount();

    expect(fake.engine.close).toHaveBeenCalled();
  });
});

describe("мост: отправка слов", () => {
  it("send из режима уходит на …/messages с voiceMode: true", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);

    act(() => bridge().send("Расскажи про погоду"));

    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(server.requestsTo("messages")[0]?.body).toEqual({
      message: { id: expect.any(String), role: "user", parts: [{ type: "text", text: "Расскажи про погоду" }] },
      voiceMode: true,
      timeZone: expect.any(String),
    });
    server.streams[0]?.end();
  });

  it("из поля ввода сообщение уходит без признака", async () => {
    const server = fakeChatServer();
    await openDialog(server);

    submitQuestion("Напечатанный вопрос");

    await waitFor(() => expect(server.streams).toHaveLength(1));
    const body = server.requestsTo("messages")[0]?.body as Record<string, unknown>;
    expect(body).toEqual({ message: expect.objectContaining({ role: "user" }), timeZone: expect.any(String) });
    expect("voiceMode" in body).toBe(false);
    server.streams[0]?.end();
  });

  it("после голосового сообщения обычное тоже уходит без признака", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());
    act(() => bridge().send("Голосом"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => server.streams[0]!.answer("Ответ.", "a1"));
    await waitFor(() => expect(ends).toHaveLength(1));

    submitQuestion("Печатью");

    await waitFor(() => expect(server.streams).toHaveLength(2));
    expect(server.requestsTo("messages")[1]?.body).not.toHaveProperty("voiceMode");
    server.streams[1]?.end();
  });

  it("пустые слова не уходят и сообщаются как ошибка ответа", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());

    act(() => bridge().send("   "));

    await waitFor(() => expect(ends).toEqual([{ messageId: "", status: "error" }]));
    expect(server.requestsTo("messages")).toHaveLength(0);
  });

  it("слова, пока идёт ответ, не уходят: движок узнаёт об отказе как об ошибке ответа", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());
    act(() => bridge().send("Первое"));
    await waitFor(() => expect(server.streams).toHaveLength(1));

    act(() => bridge().send("Второе"));

    await waitFor(() => expect(ends).toEqual([{ messageId: "", status: "error" }]));
    expect(server.requestsTo("messages")).toHaveLength(1);
    server.streams[0]?.end();
  });
});

describe("мост: склейка фразы (replaceLastMessage)", () => {
  it("пока модель размышляет, слова заменяют прежнее голосовое сообщение: POST …/edit с voiceMode и склеенным текстом, второго сообщения нет", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    act(() => bridge().send("Так."));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push({ type: "reasoning-start", id: "r" });
    });
    await waitFor(() => expect(screen.queryAllByText("Так.").length).toBeGreaterThan(0));

    const outcome = await act(() => bridge().replaceLastMessage!("Так. Дай-ка подумать."));

    expect(outcome).toBe(true);
    expect(server.requestsTo("stop")).toHaveLength(1);
    expect(server.requestsTo("edit")[0]?.body).toEqual({
      editedMessageId: expect.any(String),
      message: { id: expect.any(String), role: "user", parts: [{ type: "text", text: "Так. Дай-ка подумать." }] },
      voiceMode: true,
      timeZone: expect.any(String),
    });
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("нечего склеивать (в чате ещё нет голосового сообщения): false, на сервер ничего не уходит", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);

    const outcome = await act(() => bridge().replaceLastMessage!("Так. Дай-ка подумать."));

    expect(outcome).toBe(false);
    expect(server.requestsTo("stop")).toHaveLength(0);
    expect(server.requestsTo("edit")).toHaveLength(0);
  });
});

describe("мост: подтверждение действий голосом не принимается", () => {
  it("ответ ждёт решения: слова не уходят (иначе они бы отклонили действие), движок узнаёт об отказе", async () => {
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Удали заметки" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "tool-delete_notes",
              toolCallId: "call-1",
              state: "approval-requested",
              input: { folder: "старое" },
              approval: { id: "ap1", requestReason: "always-offered" },
            },
          ],
          metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
        },
      ],
    });
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());

    act(() => bridge().send("да, удаляй"));

    await waitFor(() => expect(ends).toEqual([{ messageId: "", status: "error" }]));
    expect(server.requestsTo("messages")).toHaveLength(0);
  });
});

describe("мост: текст и конец ответа", () => {
  it("приращения текста идут по частям с номером части и id сообщения, потом конец со статусом", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { deltas, ends } = listen(bridge());
    act(() => bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "text-start", id: "t" });
      stream.push({ type: "text-delta", id: "t", delta: "Привет, " });
    });
    await waitFor(() => expect(textOf(deltas, 0)).toBe("Привет, "));
    act(() => stream.push({ type: "text-delta", id: "t", delta: "мир." }));
    await waitFor(() => expect(textOf(deltas, 0)).toBe("Привет, мир."));

    expect(deltas.every((delta) => delta.messageId === "a1")).toBe(true);
    expect(ends).toEqual([]);

    act(() => stream.finish());
    await waitFor(() => expect(ends).toEqual([{ messageId: "a1", status: "complete" }]));
  });

  it("вторая текстовая часть приходит с её номером в parts, рассуждения не озвучиваются", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { deltas } = listen(bridge());
    act(() => bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "reasoning-start", id: "r" });
      stream.push({ type: "reasoning-delta", id: "r", delta: "думаю" });
      stream.push({ type: "reasoning-end", id: "r" });
      stream.push({ type: "text-start", id: "t1" });
      stream.push({ type: "text-delta", id: "t1", delta: "Первая часть." });
      stream.push({ type: "text-end", id: "t1" });
      stream.push({ type: "text-start", id: "t2" });
      stream.push({ type: "text-delta", id: "t2", delta: "Вторая часть." });
    });

    await waitFor(() => expect(textOf(deltas, 2)).toBe("Вторая часть."));
    expect(textOf(deltas, 1)).toBe("Первая часть.");
    expect(deltas.map((delta) => delta.text).join("")).not.toContain("думаю");
    stream.end();
  });

  it("старый ответ, что был в ленте до открытия режима, не звучит", async () => {
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Раньше" }] },
        { id: "a0", role: "assistant", parts: [{ type: "text", text: "Старый ответ." }], metadata: { status: "complete" } },
      ],
    });
    const { bridge } = await openDialog(server);
    const { deltas, ends } = listen(bridge());

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(deltas).toEqual([]);
    expect(ends).toEqual([]);
  });

  it("остановленный ответ кончается со статусом «остановлен»", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());
    act(() => bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push({ type: "text-start", id: "t" });
      server.streams[0]!.push({ type: "text-delta", id: "t", delta: "Начало" });
    });

    await act(async () => {
      await bridge().stop();
    });

    await waitFor(() => expect(ends).toEqual([{ messageId: "a1", status: "stopped" }]));
    expect(server.requestsTo("stop")).toHaveLength(1);
  });

  it("ответ, оборванный ошибкой сервера, кончается со статусом «ошибка»", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());
    act(() => bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push({ type: "error", errorText: "сбой" });
      server.streams[0]!.push({ type: "message-metadata", messageMetadata: { status: "error", error: { kind: "other" } } });
      server.streams[0]!.push({ type: "finish" });
      server.streams[0]!.end();
    });

    await waitFor(() => expect(ends).toHaveLength(1));
    expect(ends[0]?.status).toBe("error");
  });

  it("отписка работает: после неё слушатель ничего не получает", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const deltas: AssistantTextDelta[] = [];
    const unsubscribe = bridge().subscribeAssistantText((delta) => deltas.push(delta));
    unsubscribe();
    act(() => bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));

    act(() => server.streams[0]!.answer("Ответ.", "a1"));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deltas).toEqual([]);
  });
});

describe("мост: размышление и вызовы инструментов", () => {
  const activityOf = (bridge: DialogChatBridge) => {
    const events: AssistantActivity[] = [];
    bridge.subscribeAssistantActivity?.((activity) => events.push(activity));
    return events;
  };
  const compact = (events: AssistantActivity[]) => events.map((event) => `${event.phase}:${event.kind}${event.toolName ? `:${event.toolName}` : ""}:${event.partIndex}`);

  async function asking(server: ReturnType<typeof fakeChatServer>) {
    const opened = await openDialog(server);
    const events = activityOf(opened.bridge());
    act(() => opened.bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    return { ...opened, events, stream: server.streams[0]! };
  }

  it("размышление: начало, когда часть reasoning пошла, конец, когда она закрылась", async () => {
    const server = fakeChatServer();
    const { events, stream } = await asking(server);

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "reasoning-start", id: "r" });
      stream.push({ type: "reasoning-delta", id: "r", delta: "думаю" });
    });
    await waitFor(() => expect(compact(events)).toEqual(["start:reasoning:0"]));
    expect(events[0]?.messageId).toBe("a1");

    act(() => stream.push({ type: "reasoning-end", id: "r" }));
    await waitFor(() => expect(compact(events)).toEqual(["start:reasoning:0", "end:reasoning:0"]));
    stream.end();
  });

  it("вызов инструмента: начало с именем, конец, когда пришёл результат", async () => {
    const server = fakeChatServer();
    const { events, stream } = await asking(server);

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" });
      stream.push({ type: "tool-input-available", toolCallId: "call-1", toolName: "web_search", input: { query: "погода" } });
    });
    await waitFor(() => expect(compact(events)).toEqual(["start:tool:web_search:0"]));

    act(() => stream.push({ type: "tool-output-available", toolCallId: "call-1", output: "солнечно" }));
    await waitFor(() => expect(compact(events)).toEqual(["start:tool:web_search:0", "end:tool:web_search:0"]));
    stream.end();
  });

  it("ошибка инструмента тоже конец", async () => {
    const server = fakeChatServer();
    const { events, stream } = await asking(server);

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-available", toolCallId: "call-1", toolName: "read_page", input: { url: "x" } });
      stream.push({ type: "tool-output-error", toolCallId: "call-1", errorText: "не открылось" });
    });

    await waitFor(() => expect(compact(events)).toEqual(["start:tool:read_page:0", "end:tool:read_page:0"]));
    stream.end();
  });

  it("каждое начало приходит один раз, сколько бы раз ни менялась лента", async () => {
    const server = fakeChatServer();
    const { events, stream } = await asking(server);

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" });
      stream.push({ type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '{"query":' });
    });
    await waitFor(() => expect(events).toHaveLength(1));
    act(() => stream.push({ type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '"погода"}' }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(compact(events)).toEqual(["start:tool:web_search:0"]);
    stream.end();
  });

  it("ответ закончился, а часть застряла «идёт»: приходит конец, чтобы режим не ждал вечно", async () => {
    const server = fakeChatServer();
    const { events, stream } = await asking(server);
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-available", toolCallId: "call-1", toolName: "web_search", input: {} });
    });
    await waitFor(() => expect(events).toHaveLength(1));

    act(() => stream.finish());

    await waitFor(() => expect(compact(events)).toEqual(["start:tool:web_search:0", "end:tool:web_search:0"]));
  });

  it("то, что шло уже при включении режима, не объявляется заново; текст ответа и старые части событий не дают", async () => {
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Раньше" }] },
        { id: "a0", role: "assistant", parts: [{ type: "reasoning", text: "было", state: "done" }, { type: "text", text: "Старый ответ." }], metadata: { status: "complete" } },
      ],
    });
    const { bridge } = await openDialog(server);
    const events = activityOf(bridge());

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(events).toEqual([]);
  });

  it("отписка работает", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const events: AssistantActivity[] = [];
    const unsubscribe = bridge().subscribeAssistantActivity!((activity) => events.push(activity));
    unsubscribe();
    act(() => bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));

    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push({ type: "reasoning-start", id: "r" });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);
    server.streams[0]!.end();
  });
});

describe("мост: ждущий виджет озвучивается", () => {
  async function asking(server: ReturnType<typeof fakeChatServer>) {
    const opened = await openDialog(server);
    const heard = listen(opened.bridge());
    act(() => opened.bridge().send("Вопрос"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    return { ...opened, ...heard, stream: server.streams[0]! };
  }
  const askWidget = (stream: { push: (chunk: Record<string, unknown>) => void }, toolName: string, input: unknown, toolCallId = "w1") =>
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-available", toolCallId, toolName, input });
      stream.push({ type: "message-metadata", messageMetadata: { status: "awaiting_approval" } });
    });

  it("выбор: к озвучке добавляется вопрос и варианты", async () => {
    const server = fakeChatServer();
    const { deltas, stream } = await asking(server);

    askWidget(stream, "ask_choice", { question: "Какой тариф?", options: ["Базовый", "Про"] });

    await waitFor(() => expect(textOf(deltas, 0)).toContain("Какой тариф?"));
    expect(textOf(deltas, 0)).toContain("Базовый");
    expect(textOf(deltas, 0)).toContain("Про");
    stream.end();
  });

  it("форма и свой виджет: фраза «ответьте на экране или голосом»", async () => {
    const server = fakeChatServer();
    const { deltas, stream } = await asking(server);

    askWidget(stream, "ask_form", { title: "Контакты", fields: [{ name: "email", label: "Почта", kind: "text" }] });

    await waitFor(() => expect(textOf(deltas, 0)).toContain("Ответьте на экране или голосом"));
    stream.end();
  });

  it("фраза звучит один раз, сколько бы раз ни менялась лента", async () => {
    const server = fakeChatServer();
    const { deltas, stream } = await asking(server);

    askWidget(stream, "ask_choice", { question: "Какой тариф?", options: ["Базовый", "Про"] });
    await waitFor(() => expect(deltas.length).toBeGreaterThan(0));
    const count = deltas.length;
    act(() => stream.push({ type: "message-metadata", messageMetadata: { status: "awaiting_approval", reasoningDurationsMs: {} } }));
    stream.end();

    await waitFor(() => expect(deltas).toHaveLength(count));
  });

  it("подсказки не озвучиваются", async () => {
    const server = fakeChatServer();
    const { deltas, stream } = await asking(server);

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-available", toolCallId: "s1", toolName: "suggest_replies", input: { replies: ["Да", "Нет"] } });
      stream.push({ type: "tool-output-available", toolCallId: "s1", output: "показано" });
    });
    stream.end();

    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(deltas).toEqual([]);
  });

  it("виджет, что ждал уже при включении режима, не озвучивается", async () => {
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Куда?" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            { type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: { question: "Куда?", options: ["Море", "Горы"] } },
          ],
          metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
        },
      ],
    });
    const { bridge } = await openDialog(server);
    const { deltas } = listen(bridge());

    await act(async () => {});
    expect(deltas).toEqual([]);
  });
});

describe("отметка обрыва на экране", () => {
  it("showCut ставит у ответа voiceInterrupted сразу, не дожидаясь сервера", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { ends } = listen(bridge());
    act(() => bridge().send("Расскажи"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => server.streams[0]!.answer("Длинный ответ про погоду.", "a1"));
    await waitFor(() => expect(ends).toHaveLength(1));
    expect(document.querySelector("[data-kind='agent']")?.hasAttribute("data-voice-interrupted")).toBe(false);

    act(() => bridge().showCut("a1", { partIndex: 0, charOffset: 7, spokenTail: "Длинный" }));

    await waitFor(() =>
      expect(document.querySelector("[data-kind='agent']")?.getAttribute("data-voice-interrupted")).toBe("Длинный"),
    );
  });

  it("showCut для сообщения, которого нет, ничего не ломает", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);

    expect(() => act(() => bridge().showCut("нет-такого", { partIndex: 0, charOffset: 1, spokenTail: "х" }))).not.toThrow();
  });
});

describe("useVoiceDialog как хук", () => {
  it("без движка вида нет", async () => {
    const server = fakeChatServer();
    const { result } = renderHook(() => {
      const chat = useAgentChat({ api: "/api/chat", chatId: "c1", fetch: server.fetch });
      return useVoiceDialog({ engine: undefined, chatId: "c1", chat });
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeUndefined();
  });
});

describe("мост: картинки агента не озвучиваются (FR-043, T048)", () => {
  it("вызов generate_images — только «работа инструмента» для заполнителя; описание и итог в речь не идут, текст после — идёт", async () => {
    const server = fakeChatServer();
    const { bridge } = await openDialog(server);
    const { deltas } = listen(bridge());
    const activity: AssistantActivity[] = [];
    bridge().subscribeAssistantActivity?.((event) => activity.push(event));
    act(() => bridge().send("Нарисуй маяк"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;

    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-start", toolCallId: "g1", toolName: "generate_images" });
      stream.push({ type: "tool-input-available", toolCallId: "g1", toolName: "generate_images", input: { prompt: "Маяк на рассвете", count: 2, aspectRatio: "16:9" } });
    });
    await waitFor(() => expect(activity.map((event) => `${event.phase}:${event.toolName}`)).toEqual(["start:generate_images"]));
    act(() => {
      stream.push({
        type: "tool-output-available",
        toolCallId: "g1",
        output: { создано: 2, заказано: 2, картинки: [{ номер: 1, id: "img-1", ширина: 1088, высота: 608 }, { номер: 2, id: "img-2", ширина: 1088, высота: 608 }] },
      });
      stream.push({ type: "text-start", id: "t" });
      stream.push({ type: "text-delta", id: "t", delta: "Готово, две картинки." });
    });
    await waitFor(() => expect(deltas.map((delta) => delta.text).join("")).toBe("Готово, две картинки."));

    const spoken = deltas.map((delta) => delta.text).join("");
    expect(spoken).not.toContain("Маяк на рассвете");
    expect(spoken).not.toContain("img-1");
    expect(spoken).not.toContain("создано");
    expect(activity.map((event) => `${event.phase}:${event.toolName}`)).toEqual(["start:generate_images", "end:generate_images"]);
    stream.end();
  });
});
