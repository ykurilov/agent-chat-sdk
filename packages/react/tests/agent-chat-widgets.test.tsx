// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CustomWidgetProps, ChatSkin, WidgetView } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, settle, setupChatDom, submitQuestion } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

/** Пробный скин v13: виджет и подсказки видны в data-атрибутах, варианты — кнопками. */
const ProbeWidget = (view: WidgetView) => (
  <div
    data-kind="widget"
    data-widget={view.kind}
    data-active={String(view.active)}
    data-pending={String(view.pending)}
    data-failure={view.failure ?? ""}
    data-by-message={String(view.answeredByMessage)}
    data-chosen={view.kind === "choice" ? (view.chosen ?? "") : ""}
  >
    {view.kind === "choice" &&
      view.options.map((option) => (
        <button key={option} type="button" disabled={!view.onChoose || view.pending} onClick={() => view.onChoose?.(option)}>
          {option}
        </button>
      ))}
    {view.kind === "custom" && (view.content ?? <span data-kind="custom-fallback">{view.question}</span>)}
  </div>
);
const probeSkin: ChatSkin = {
  ...stubSkin,
  Widget: ProbeWidget,
  SuggestedReplies: ({ replies, onPick, disabled }) => (
    <div data-kind="suggested">
      {replies.map((reply) => (
        <button key={reply} type="button" data-reply={reply} disabled={disabled} onClick={() => onPick(reply)}>
          {reply}
        </button>
      ))}
    </div>
  ),
};

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Куда поедем?" }] };
const choicePart = (overrides: Record<string, unknown> = {}) => ({
  type: "tool-ask_choice",
  toolCallId: "w1",
  state: "input-available",
  input: { question: "Куда?", options: ["Море", "Горы"] },
  ...overrides,
});
const waiting = (part: Record<string, unknown> = choicePart(), status = "awaiting_approval"): HistoryMessage[] => [
  question,
  { id: "a1", role: "assistant", parts: [{ type: "step-start" }, part], metadata: { status, reasoningDurationsMs: {} } },
];

const widget = () => document.querySelector('[data-kind="widget"]') as HTMLElement;
const agentStatus = () => document.querySelector('[data-kind="agent"]')?.getAttribute("data-status");
const announcement = () => screen.getByTestId("announcement").textContent;

/** Продолжение хода после ответа: тот же id сообщения, текст, итог. Результат вызова сервер в поток не шлёт. */
function continueAnswer(stream: { push: (chunk: Record<string, unknown>) => void; end: () => void }) {
  stream.push({ type: "start", messageId: "a1" });
  stream.push({ type: "start-step" });
  stream.push({ type: "text-start", id: "t" });
  stream.push({ type: "text-delta", id: "t", delta: "Едем на море" });
  stream.push({ type: "text-end", id: "t" });
  stream.push({ type: "message-metadata", messageMetadata: { status: "complete" } });
  stream.push({ type: "finish" });
  stream.end();
}

describe("AgentChat: виджеты в ленте", () => {
  it("ждущий вопрос из истории: виджет вместо строки инструмента, активен, поле ввода доступно", async () => {
    renderAgentChat(fakeChatServer({ history: waiting() }), { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    expect(widget().getAttribute("data-active")).toBe("true");
    expect(document.querySelector('[data-kind="tool"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "своими словами" } });
    expect((document.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("одно нажатие: ответ уходит на сервер, продолжение дописывает то же сообщение, выбор виден и больше не нажимается", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(server.requestsTo("widget")).toHaveLength(1));
    const sent = server.requestsTo("widget")[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toMatch(/\/api\/chat\/c1\/widgets\/w1$/);
    expect(sent.body).toMatchObject({ answer: { "выбрано": "Море" } });
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    expect(widget().getAttribute("data-chosen")).toBe("Море");
    expect(widget().getAttribute("data-active")).toBe("false");
    expect(announcement()).toBe("Ответ отправлен");
    act(() => continueAnswer(server.resumed[0]!));
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Едем на море"));
    expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(1);
    await waitFor(() => expect(agentStatus()).toBe("complete"));
    expect(widget().getAttribute("data-chosen")).toBe("Море");
    expect((screen.getByText("Горы") as HTMLButtonElement).disabled).toBe(true);
  });

  it("пока ответ летит, виджет занят", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.hang.add("widget");
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(widget().getAttribute("data-pending")).toBe("true"));
  });

  it("сервер принял, но ещё ждёт другого ответа (resumed: false): выбор отмечен, продолжения нет", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.widget = { status: 200, body: { resumed: false } };
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Горы"));
    await waitFor(() => expect(widget().getAttribute("data-chosen")).toBe("Горы"));
    expect(server.resumed).toHaveLength(0);
    expect(agentStatus()).toBe("awaiting_approval");
  });

  it.each([
    ["нет связи", { fail: true }, "Ответ не отправился, попробуйте ещё раз"],
    ["лимит расходов", { status: 429, body: { error: { kind: "spending_limit_reached", limit: 1 } } }, null],
    ["чат занят", { status: 409, body: { error: { kind: "busy" } } }, null],
    ["ответ не прошёл проверку", { status: 400, body: { error: { kind: "invalid_answer" } } }, "Такой ответ не подходит, ответьте сообщением"],
  ])("сбой (%s): виджет снова активен, причина словами", async (_name, refusal, text) => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    if ("fail" in refusal) server.state.fail.add("widget");
    else server.state.widget = refusal;
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(widget().getAttribute("data-failure")).not.toBe(""));
    if (text) expect(widget().getAttribute("data-failure")).toBe(text);
    expect(widget().getAttribute("data-active")).toBe("true");
    expect(widget().getAttribute("data-pending")).toBe("false");
    expect(server.resumed).toHaveLength(0);
  });

  it("проверка ответа отказала (409 widget_answer_refused): слова приложения под виджетом, виджет активен, поле ввода и отказ хода не затронуты", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.widget = {
      status: 409,
      body: { error: { kind: "widget_answer_refused", code: "widget_answer_refused", message: "Это время уже заняли. Выберите другое." } },
    };
    const onTurnRefused = vi.fn();
    renderAgentChat(server, { skin: probeSkin, onTurnRefused });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(widget().getAttribute("data-failure")).toBe("Это время уже заняли. Выберите другое."));
    expect(widget().getAttribute("data-active")).toBe("true");
    expect(widget().getAttribute("data-pending")).toBe("false");
    expect(onTurnRefused).not.toHaveBeenCalled();
    expect(server.resumed).toHaveLength(0);
    expect((screen.getByLabelText("поле") as HTMLTextAreaElement).value).toBe("");
  });

  it("проверка не успела в срок (504 widget_check_timeout): понятный текст под виджетом, виджет открыт, отказ хода не затронут", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.widget = {
      status: 504,
      body: { error: { kind: "widget_check_timeout", code: "widget_check_timeout", message: "Проверка ответа на виджет не уложилась в срок 5000 мс" } },
    };
    const onTurnRefused = vi.fn();
    renderAgentChat(server, { skin: probeSkin, onTurnRefused });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(widget().getAttribute("data-failure")).toBe("Не удалось проверить ответ, попробуйте ещё раз"));
    expect(widget().getAttribute("data-active")).toBe("true");
    expect(widget().getAttribute("data-pending")).toBe("false");
    expect(onTurnRefused).not.toHaveBeenCalled();
    expect(server.resumed).toHaveLength(0);
    expect((screen.getByText("Горы") as HTMLButtonElement).disabled).toBe(false);
  });

  it("«Стоп» во время проверки (409 widget_answer_cancelled): тихо — виджет открыт, ошибки нет, надпись и отказ хода не затронуты", async () => {
    const server = fakeChatServer({ history: waiting(), resumable: true });
    server.state.widget = {
      status: 409,
      body: { error: { kind: "widget_answer_cancelled", code: "widget_answer_cancelled", message: "Проверка ответа остановлена" } },
    };
    const onTurnRefused = vi.fn();
    renderAgentChat(server, { skin: probeSkin, onTurnRefused });
    await waitFor(() => expect(widget()).toBeTruthy());
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(server.requestsTo("widget")).toHaveLength(1));
    await waitFor(() => expect(widget().getAttribute("data-pending")).toBe("false"));
    expect(widget().getAttribute("data-failure")).toBe("");
    expect(widget().getAttribute("data-active")).toBe("true");
    expect(onTurnRefused).not.toHaveBeenCalled();
    expect(server.resumed).toHaveLength(0);
    // Не «уже отвечено»: историю заново не просили, и повторное нажатие уходит снова.
    expect((screen.getByText("Горы") as HTMLButtonElement).disabled).toBe(false);
  });

  it("409 widget_not_pending: история перечитывается и показывается как есть", async () => {
    const server = fakeChatServer({ history: waiting() });
    server.state.widget = { status: 409, body: { error: { kind: "widget_not_pending" } } };
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    server.state.history = waiting(choicePart({ state: "output-available", output: { "ответ": "сообщением" } }), "complete");
    fireEvent.click(screen.getByText("Море"));
    await waitFor(() => expect(widget().getAttribute("data-by-message")).toBe("true"));
    expect(widget().getAttribute("data-active")).toBe("false");
  });

  it("сообщение вместо ответа: виджет сразу помечен «ответ дан сообщением»", async () => {
    const server = fakeChatServer({ history: waiting() });
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(widget()).toBeTruthy());
    submitQuestion("Давай в лес");
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(widget().getAttribute("data-by-message")).toBe("true");
    expect(widget().getAttribute("data-active")).toBe("false");
  });

  it("живой ход кончается вопросом: диктор слышит «Агент задал вопрос» и сам вопрос", async () => {
    const server = fakeChatServer();
    renderAgentChat(server, { skin: probeSkin });
    await screen.findByLabelText("поле");
    submitQuestion("Куда поедем?");
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "tool-input-available", toolCallId: "w1", toolName: "ask_choice", input: { question: "Куда?", options: ["Море", "Горы"] } });
    stream.push({ type: "finish-step" });
    stream.push({ type: "message-metadata", messageMetadata: { status: "awaiting_approval" } });
    stream.push({ type: "finish" });
    act(() => stream.end());
    await waitFor(() => expect(widget()?.getAttribute("data-active")).toBe("true"));
    await waitFor(() => expect(announcement()).toBe("Агент задал вопрос: Куда?"));
  });

  it("перезагрузка посреди продолжения: ответ дописывается в то же сообщение", async () => {
    const answered = choicePart({ state: "output-available", output: { "выбрано": "Море" } });
    const server = fakeChatServer({ history: waiting(answered, "streaming"), running: true, resumable: true });
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    act(() => continueAnswer(server.resumed[0]!));
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("Едем на море"));
    expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(1);
    expect(widget().getAttribute("data-chosen")).toBe("Море");
  });

  it("скин без виджета (v10): строка инструмента с вопросом и пометкой «ответьте сообщением»", async () => {
    renderAgentChat(fakeChatServer({ history: waiting() }));
    await waitFor(() => expect(document.querySelector('[data-kind="tool"]')).toBeTruthy());
    expect(document.querySelector('[data-kind="tool"]')?.getAttribute("data-title")).toBe("Куда? — Ответьте сообщением");
  });

  it("лишний вопрос шага и негодный вход не показываются", async () => {
    const history = waiting(choicePart({ state: "output-error", errorText: "Задавай один вопрос за раз", input: { question: "Ещё?", options: ["А", "Б"] } }), "complete");
    history[1]!.parts.push(choicePart({ toolCallId: "w2", state: "output-error", errorText: "bad", input: { question: "" } }));
    history[1]!.parts.push({ type: "text", text: "Ок", state: "done" });
    renderAgentChat(fakeChatServer({ history }), { skin: probeSkin });
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')).toBeTruthy());
    expect(widget()).toBeNull();
    expect(document.querySelector('[data-kind="tool"]')).toBeNull();
  });
});

describe("AgentChat: свой виджет страницы", () => {
  const PickSlot = ({ input, state, onAnswer, pending, failure }: CustomWidgetProps<{ slots: string[] }, { slot: string }>) => (
    <div data-kind="pick-slot" data-state={state} data-pending={String(pending)} data-failure={failure ?? ""}>
      {input.slots.map((slot) => (
        <button key={slot} type="button" disabled={!onAnswer} onClick={() => onAnswer?.({ slot })}>
          {slot}
        </button>
      ))}
    </div>
  );
  const pickPart = { type: "tool-pick_slot", toolCallId: "w9", state: "input-available", input: { slots: ["10:00", "12:00"] } };

  it("компонент получает вход и onAnswer; ответ уходит на сервер как есть", async () => {
    const server = fakeChatServer({ history: waiting(pickPart), resumable: true });
    renderAgentChat(server, { skin: probeSkin, widgets: { pick_slot: PickSlot } });
    await waitFor(() => expect(document.querySelector('[data-kind="pick-slot"]')).toBeTruthy());
    expect(document.querySelector('[data-kind="pick-slot"]')?.getAttribute("data-state")).toBe("pending");
    fireEvent.click(screen.getByText("12:00"));
    await waitFor(() => expect(server.requestsTo("widget")).toHaveLength(1));
    expect(server.requestsTo("widget")[0]!.url).toMatch(/\/widgets\/w9$/);
    expect(server.requestsTo("widget")[0]!.body).toMatchObject({ answer: { slot: "12:00" } });
    await waitFor(() => expect(document.querySelector('[data-kind="pick-slot"]')?.getAttribute("data-state")).toBe("answered"));
  });

  it("компонент получает chatId и toolCallId: сам загрузит свои данные", async () => {
    const seen: Array<{ chatId?: string; toolCallId?: string }> = [];
    const Probe = ({ chatId, toolCallId }: CustomWidgetProps) => {
      seen.push({ chatId, toolCallId });
      return <div data-kind="probe" />;
    };
    renderAgentChat(fakeChatServer({ history: waiting(pickPart) }), { skin: probeSkin, widgets: { pick_slot: Probe } });
    await waitFor(() => expect(document.querySelector('[data-kind="probe"]')).toBeTruthy());
    expect(seen.at(-1)).toEqual({ chatId: "c1", toolCallId: "w9" });
  });

  it("ответ принят без продолжения (resumed: false), а проверка положила событие: вкладка перечитывает историю, onAppEvent — live", async () => {
    const event = { type: "slot_booked", data: { slot: "12:00" } };
    const server = fakeChatServer({ history: waiting(pickPart), resumable: true });
    server.state.watch = true;
    const answeredPart = { ...pickPart, state: "output-available", output: { slot: "12:00" } };
    server.state.widget = {
      status: 200,
      body: { resumed: false },
      // Сервер пишет ответ с событием и шлёт его в канал наблюдения, пока запрос ответа ещё идёт.
      beforeReply: () => {
        server.state.history = waiting(answeredPart).map((message) =>
          message.role === "assistant" ? { ...message, parts: [...message.parts, { type: "data-app-event", data: event }] } : message,
        );
        server.emit({ type: "app-event", chatId: "c1", messageId: "a1", event });
      },
    };
    const onAppEvent = vi.fn();
    renderAgentChat(server, { skin: probeSkin, widgets: { pick_slot: PickSlot }, onAppEvent });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    fireEvent.click(screen.getByText("12:00"));
    await waitFor(() => expect(onAppEvent).toHaveBeenCalledWith(event, { live: true, messageId: "a1" }));
    expect(onAppEvent).toHaveBeenCalledTimes(1);
  });

  it("resumed: false без канала наблюдения: вкладка сама перечитывает историю, событие проверки — live один раз", async () => {
    const event = { type: "slot_booked", data: { slot: "12:00" } };
    const server = fakeChatServer({ history: waiting(pickPart), resumable: true });
    const answeredPart = { ...pickPart, state: "output-available", output: { slot: "12:00" } };
    server.state.widget = {
      status: 200,
      body: { resumed: false },
      beforeReply: () => {
        server.state.history = waiting(answeredPart).map((message) =>
          message.role === "assistant" ? { ...message, parts: [...message.parts, { type: "data-app-event", data: event }] } : message,
        );
      },
    };
    const onAppEvent = vi.fn();
    renderAgentChat(server, { skin: probeSkin, widgets: { pick_slot: PickSlot }, onAppEvent });
    await waitFor(() => expect(document.querySelector('[data-kind="pick-slot"]')).toBeTruthy());
    fireEvent.click(screen.getByText("12:00"));
    await waitFor(() => expect(onAppEvent).toHaveBeenCalledWith(event, { live: true, messageId: "a1" }));
    await settle();
    expect(onAppEvent).toHaveBeenCalledTimes(1);
  });

  it("resumed: false, канал наблюдения донёс событие уже после ответа POST: второго срабатывания нет", async () => {
    const event = { type: "slot_booked", data: { slot: "12:00" } };
    const server = fakeChatServer({ history: waiting(pickPart), resumable: true });
    server.state.watch = true;
    const answeredPart = { ...pickPart, state: "output-available", output: { slot: "12:00" } };
    server.state.widget = {
      status: 200,
      body: { resumed: false },
      beforeReply: () => {
        server.state.history = waiting(answeredPart).map((message) =>
          message.role === "assistant" ? { ...message, parts: [...message.parts, { type: "data-app-event", data: event }] } : message,
        );
      },
    };
    const onAppEvent = vi.fn();
    renderAgentChat(server, { skin: probeSkin, widgets: { pick_slot: PickSlot }, onAppEvent });
    await waitFor(() => expect(server.watches).toHaveLength(1));
    fireEvent.click(screen.getByText("12:00"));
    await waitFor(() => expect(onAppEvent).toHaveBeenCalledWith(event, { live: true, messageId: "a1" }));
    await settle();
    server.emit({ type: "app-event", chatId: "c1", messageId: "a1", event });
    await settle();
    expect(onAppEvent).toHaveBeenCalledTimes(1);
  });

  it("проверка ответа отказала у своего виджета (409 widget_answer_refused): слова приложения в failure компонента, виджет активен", async () => {
    const server = fakeChatServer({ history: waiting(pickPart), resumable: true });
    server.state.widget = {
      status: 409,
      body: { error: { kind: "widget_answer_refused", code: "widget_answer_refused", message: "Это время уже заняли. Выберите другое." } },
    };
    const onTurnRefused = vi.fn();
    renderAgentChat(server, { skin: probeSkin, widgets: { pick_slot: PickSlot }, onTurnRefused });
    await waitFor(() => expect(document.querySelector('[data-kind="pick-slot"]')).toBeTruthy());
    fireEvent.click(screen.getByText("12:00"));
    const slot = () => document.querySelector('[data-kind="pick-slot"]');
    await waitFor(() => expect(slot()?.getAttribute("data-failure")).toBe("Это время уже заняли. Выберите другое."));
    expect(slot()?.getAttribute("data-state")).toBe("pending");
    expect(slot()?.getAttribute("data-pending")).toBe("false");
    expect((screen.getByText("10:00") as HTMLButtonElement).disabled).toBe(false);
    expect(onTurnRefused).not.toHaveBeenCalled();
    expect(server.resumed).toHaveLength(0);
  });

  it("вход негодный и компонент падает: лента цела, виджет в запасном виде скина", async () => {
    const broken = { ...pickPart, state: "output-error", input: { question: "Когда удобно?" }, errorText: "Invalid input for tool pick_slot" };
    const history: HistoryMessage[] = [
      question,
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "step-start" }, broken, { type: "text", text: "Не вышло спросить", state: "done" }],
        metadata: { status: "complete", reasoningDurationsMs: {} },
      },
    ];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderAgentChat(fakeChatServer({ history }), { skin: probeSkin, widgets: { pick_slot: PickSlot } });
      await waitFor(() => expect(document.querySelector('[data-kind="custom-fallback"]')?.textContent).toBe("Когда удобно?"));
      expect(document.querySelector('[data-kind="text"]')?.textContent).toContain("Не вышло спросить");
      expect(document.querySelector('[data-kind="pick-slot"]')).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it("компонента нет: запасной вид с вопросом", async () => {
    const part = { ...pickPart, input: { question: "Когда удобно?", slots: [] } };
    renderAgentChat(fakeChatServer({ history: waiting(part) }), { skin: probeSkin });
    await waitFor(() => expect(document.querySelector('[data-kind="custom-fallback"]')?.textContent).toBe("Когда удобно?"));
  });
});

describe("AgentChat: подсказки ответа", () => {
  const suggesting: HistoryMessage[] = [
    question,
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Могу подобрать отель", state: "done" },
        { type: "tool-suggest_replies", toolCallId: "s1", state: "output-available", input: { replies: ["Да", "Не надо"] }, output: "показано" },
      ],
      metadata: { status: "complete", reasoningDurationsMs: {} },
    },
  ];

  it("кнопки под последним ответом; нажатие — обычная отправка текста, пока идёт ход кнопок нет", async () => {
    const server = fakeChatServer({ history: suggesting });
    renderAgentChat(server, { skin: probeSkin });
    await waitFor(() => expect(document.querySelector('[data-kind="suggested"]')).toBeTruthy());
    expect(document.querySelector('[data-kind="tool"]')).toBeNull();
    fireEvent.click(screen.getByText("Не надо"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const sent = server.requestsTo("messages")[0]!.body as { message: { parts: Array<{ type: string; text?: string }> } };
    expect(sent.message.parts.find((part) => part.type === "text")?.text).toBe("Не надо");
    await waitFor(() => expect(document.querySelector('[data-kind="suggested"]')).toBeNull());
  });

  it("скин без подсказок — их нет, ответ показан как обычно", async () => {
    renderAgentChat(fakeChatServer({ history: suggesting }));
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')).toBeTruthy());
    expect(document.querySelector('[data-kind="suggested"]')).toBeNull();
    expect(document.querySelector('[data-kind="tool"]')).toBeNull();
  });
});
