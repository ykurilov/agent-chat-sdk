import { tool } from "ai";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { TurnRefusedError } from "../../src/index";
import type { BeforeTurnHandler, TurnAction, TurnNotStartedHandler } from "../../src/index";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { AGENT_NOTICE_PART_TYPE } from "../../src/notices/agent-notice";
import { defineWidget } from "../../src/widgets/define-widget";
import { finishPart, readAll, streamStart } from "./support/mock-model";
import { callTool, doneNotice, noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

const CLOSED = { code: "lesson_closed", message: "Урок закрыт" };

/** Проверка приложения, которую ведёт тест: пока `closed`, отказывает; каждое обращение — в `calls`. */
function gate() {
  const state = { closed: false };
  const calls: Array<Parameters<BeforeTurnHandler>[0]> = [];
  const beforeTurn: BeforeTurnHandler = (input) => {
    calls.push(input);
    return state.closed ? CLOSED : undefined;
  };
  return { state, calls, beforeTurn };
}

const removeTool = (execute = vi.fn(async () => "удалено")) =>
  tool({ description: "Удалить", inputSchema: z.object({}), needsApproval: true, execute });

const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
  answerSchema: z.object({ slot: z.string() }),
});

function setup(extra: Parameters<typeof noticeService>[1] = {}, scripts: Parameters<typeof scriptedModel>[0] = []) {
  const model = scriptedModel(scripts);
  const { service, storage } = noticeService(model, extra);
  return { model, service, storage };
}

async function answered(service: ReturnType<typeof setup>["service"], chatId: string, id = "u1", text = "Привет") {
  await readAll(await service.sendMessage("anna", chatId, userMessage(id, text)));
}

describe("служба чата: проверка перед ходом (beforeTurn)", () => {
  it("«Стоп», пока идёт проверка перед ходом: ход не продолжается, ответ остановлен, модель не отвечает до конца", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const beforeTurn = vi.fn<BeforeTurnHandler>(() => held.then(() => undefined));
    const { service, storage, model } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    const sending = service.sendMessage("anna", chat.id, userMessage("u1", "Привет"));
    await vi.waitFor(() => expect(beforeTurn).toHaveBeenCalledTimes(1));
    expect(await service.stop("anna", chat.id)).toBe(true);
    release();
    await readAll(await sending);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant");
    expect(answer?.status).toBe("stopped");
    expect(model.doStreamCalls.length).toBeLessThanOrEqual(1);
    // Остановка не переходит на следующий ход.
    await answered(service, chat.id, "u2", "Ещё раз");
    expect((await storage.listMessages(chat.id)).at(-1)).toMatchObject({ role: "assistant", status: "complete" });
  });

  it("«Стоп», пока проверка перед ходом отказывает: остановка не цепляется к следующему ходу", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const beforeTurn = vi.fn<BeforeTurnHandler>(() => held.then(() => CLOSED));
    const { service, storage } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    const sending = service.sendMessage("anna", chat.id, userMessage("u1", "Привет")).catch((error: unknown) => error);
    await vi.waitFor(() => expect(beforeTurn).toHaveBeenCalledTimes(1));
    await service.stop("anna", chat.id);
    release();
    expect(await sending).toBeInstanceOf(TurnRefusedError);
    beforeTurn.mockImplementation(() => undefined);
    await answered(service, chat.id, "u2", "Ещё раз");
    expect((await storage.listMessages(chat.id)).at(-1)).toMatchObject({ role: "assistant", status: "complete" });
  });

  it("send: отказ — TurnRefusedError с кодом и текстом; модель не вызвана, ничего не записано, чат свободен", async () => {
    const { state, beforeTurn } = gate();
    const { service, model, storage } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    state.closed = true;
    const failure = await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TurnRefusedError);
    expect(failure).toMatchObject(CLOSED);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await storage.listMessages(chat.id)).toEqual([]);
    expect((await service.getHistory("anna", chat.id)).running).toBe(false);
    expect((await service.listChats("anna"))[0]!.title).toBeNull();
  });

  it("send: проверка получает человека, чат, действие и склейку текстовых частей; поля staff во входе нет", async () => {
    const { calls, beforeTurn } = gate();
    const { service } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    await readAll(
      await service.sendMessage("anna", chat.id, {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "раз " },
          { type: "text", text: "два" },
        ],
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userId: "anna", chat: { id: chat.id, ownerId: "anna" }, action: "send", text: "раз два" });
    expect(calls[0]).not.toHaveProperty("staff");
    expectTypeOf<Parameters<BeforeTurnHandler>[0]>().not.toHaveProperty("staff");
  });

  it("не отказала — ход идёт как обычно", async () => {
    const { beforeTurn } = gate();
    const { service, model } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await service.getHistory("anna", chat.id)).messages).toHaveLength(2);
  });

  it("повтор, переделка и правка: те же отказ и пустая запись; в проверку идут действия retry, regenerate, edit", async () => {
    const { state, calls, beforeTurn } = gate();
    const { service, model, storage } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answerId = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
    const before = (await storage.listMessages(chat.id)).length;
    const callsBefore = model.doStreamCalls.length;
    calls.length = 0;
    state.closed = true;
    await expect(service.retry("anna", chat.id)).rejects.toBeInstanceOf(TurnRefusedError);
    await expect(service.regenerate("anna", chat.id, answerId)).rejects.toBeInstanceOf(TurnRefusedError);
    await expect(service.editMessage("anna", chat.id, "u1", userMessage("u2", "Правка"))).rejects.toBeInstanceOf(TurnRefusedError);
    expect(calls.map((call) => call.action)).toEqual<TurnAction[]>(["retry", "regenerate", "edit"]);
    expect(calls[2]!.text).toBe("Правка");
    expect(calls[0]!.text).toBeUndefined();
    expect((await storage.listMessages(chat.id)).length).toBe(before);
    expect(model.doStreamCalls).toHaveLength(callsBefore);
  });

  it("подтверждение: отказ — запрос остаётся ждать, инструмент не выполнен; позже проверка пускает", async () => {
    const { state, calls, beforeTurn } = gate();
    const execute = vi.fn(async () => "удалено");
    const { service, storage } = setup({ beforeTurn, agent: { tools: { remove: removeTool(execute) } } }, [callTool("remove", "c1")]);
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    const approvalId = (answer.parts.find((part) => part.type === "tool-remove") as { approval: { id: string } }).approval.id;
    calls.length = 0;
    state.closed = true;
    await expect(service.answerApproval("anna", chat.id, approvalId, "allow")).rejects.toMatchObject(CLOSED);
    expect(calls.map((call) => call.action)).toEqual(["approval"]);
    expect(execute).not.toHaveBeenCalled();
    expect((await storage.listMessages(chat.id)).find((message) => message.status === "awaiting_approval")).toBeDefined();
    state.closed = false;
    await service.answerApproval("anna", chat.id, approvalId, "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("виджет: отказ — виджет остаётся ждать ответа; позже проверка пускает", async () => {
    const { state, calls, beforeTurn } = gate();
    const { service, storage } = setup(
      { beforeTurn, agent: { widgets: { custom: [pickSlot] } } },
      [callTool("pick_slot", "w1", { slots: ["10:00", "11:00"] })],
    );
    const chat = await service.createChat("anna");
    await answered(service, chat.id);
    calls.length = 0;
    state.closed = true;
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { slot: "10:00" } })).rejects.toMatchObject(CLOSED);
    expect(calls.map((call) => call.action)).toEqual(["widget"]);
    expect((await storage.listMessages(chat.id)).find((message) => message.status === "awaiting_approval")).toBeDefined();
    state.closed = false;
    const result = await service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { slot: "10:00" } });
    expect(result).toEqual({ resumed: true });
    await readAll((await service.subscribe("anna", chat.id))!);
  });

  it("порядок: сначала проверка приложения, потом лимит — при двух отказах побеждает отказ приложения, лимит не спрошен", async () => {
    const { beforeTurn } = gate();
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      }),
      status: vi.fn(async () => ({ state: "exhausted" as const, scope: "user" as const, period: "month" as const, share: 1, resetsAt: null })),
    };
    const { service } = setup({ beforeTurn: () => CLOSED, limits });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "Привет"))).rejects.toBeInstanceOf(TurnRefusedError);
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
    // Без отказа приложения лимит работает как прежде.
    const open = setup({ beforeTurn, limits });
    const other = await open.service.createChat("anna");
    await expect(open.service.sendMessage("anna", other.id, userMessage("u1", "Привет"))).rejects.toBeInstanceOf(SpendingLimitReachedError);
  });

  it("порядок в send: пустое сообщение — InvalidMessageError, проверка приложения не зовётся", async () => {
    const { calls, beforeTurn } = gate();
    const { service } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "   "))).rejects.toMatchObject({ name: "InvalidMessageError" });
    expect(calls).toHaveLength(0);
  });

  it("чужой чат: «не найден», проверка приложения не зовётся", async () => {
    const { calls, beforeTurn } = gate();
    const { service } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("boris", chat.id, userMessage("u1", "Привет"))).rejects.toMatchObject({ name: "ChatNotFoundError" });
    expect(calls).toHaveLength(0);
  });

  it("исключение из проверки: ход не начат, исключение наружу, ничего не записано", async () => {
    const { service, model, storage } = setup({
      beforeTurn: () => {
        throw new Error("база урока недоступна");
      },
    });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "Привет"))).rejects.toThrow("база урока недоступна");
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await storage.listMessages(chat.id)).toEqual([]);
  });

  it("неверный код отказа — ошибка приложения: ход не начат, TypeError, строка в журнал", async () => {
    const logError = vi.fn();
    const { service, model, storage } = setup({ beforeTurn: () => ({ code: "Урок Закрыт", message: "x" }), logError });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "Привет"))).rejects.toBeInstanceOf(TypeError);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("beforeTurn"));
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await storage.listMessages(chat.id)).toEqual([]);
  });

  it("длинный текст отказа обрезается до 300 знаков", async () => {
    const { service } = setup({ beforeTurn: () => ({ code: "lesson_closed", message: "я".repeat(400) }) });
    const chat = await service.createChat("anna");
    const failure = (await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")).catch((error: unknown) => error)) as TurnRefusedError;
    expect(failure.message).toHaveLength(300);
  });

  it("асинхронная проверка тоже ждётся", async () => {
    const { service, model } = setup({ beforeTurn: async () => CLOSED });
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "Привет"))).rejects.toMatchObject(CLOSED);
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("служба чата: beforeTurn и служебные сообщения (deliverNotices)", () => {
  const deliver = (chatId: string, key = "k1", wakeAgent = true) => ({
    ownerId: "anna",
    chatId,
    notices: [doneNotice("Отчёт", "готово", key)],
    wakeAgent,
    deliveryKey: key,
  });

  async function chatWithAnswer(extra: Parameters<typeof noticeService>[1]) {
    const model = scriptedModel([saying("первый")]);
    const { service } = noticeService(model, extra);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    return { service, model, chat };
  }

  it("отказ — сообщение записано, хода нет; проверка получила действие notice без текста", async () => {
    const { state, calls, beforeTurn } = gate();
    const { service, model, chat } = await chatWithAnswer({ beforeTurn });
    calls.length = 0;
    state.closed = true;
    const result = await service.deliverNotices(deliver(chat.id));
    expect(result).toMatchObject({ status: "delivered", turnStarted: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userId: "anna", action: "notice", chat: { id: chat.id, ownerId: "anna" } });
    expect(calls[0]!.text).toBeUndefined();
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages).toHaveLength(3);
    expect(messages[2]!.parts.some((part) => part.type === AGENT_NOTICE_PART_TYPE)).toBe(true);
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await service.getHistory("anna", chat.id)).running).toBe(false);
  });

  it("не отказала — ход начат", async () => {
    const { beforeTurn } = gate();
    const { service, chat } = await chatWithAnswer({ beforeTurn });
    expect(await service.deliverNotices(deliver(chat.id))).toMatchObject({ status: "delivered", turnStarted: true });
  });

  it("без хода (wakeAgent: false) проверка не зовётся", async () => {
    const { calls, beforeTurn } = gate();
    const { service, chat } = await chatWithAnswer({ beforeTurn });
    calls.length = 0;
    await service.deliverNotices(deliver(chat.id, "k1", false));
    expect(calls).toHaveLength(0);
  });

  it("исключение из проверки уходит наружу, сообщение не записано", async () => {
    const state = { broken: false };
    const { service, chat } = await chatWithAnswer({
      beforeTurn: () => {
        if (state.broken) throw new Error("база урока недоступна");
      },
    });
    state.broken = true;
    await expect(service.deliverNotices(deliver(chat.id))).rejects.toThrow("база урока недоступна");
    expect((await service.getHistory("anna", chat.id)).messages).toHaveLength(2);
  });
});

describe("служба чата: assertTurnAllowed — проверка до работы, которая стоит денег", () => {
  it("отказ приложения — TurnRefusedError; хук получает человека, чат, действие и текст, если он известен", async () => {
    const { state, calls, beforeTurn } = gate();
    const { service } = setup({ beforeTurn });
    const chat = await service.createChat("anna");
    await service.assertTurnAllowed("anna", chat.id, "send");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userId: "anna", action: "send", chat: { id: chat.id } });
    expect(calls[0]!.text).toBeUndefined();
    state.closed = true;
    await expect(service.assertTurnAllowed("anna", chat.id, "approval")).rejects.toMatchObject({ name: "TurnRefusedError", ...CLOSED });
    expect(calls.at(-1)).toMatchObject({ action: "approval" });
  });

  it("без beforeTurn ничего не делает; чужой чат — ChatNotFoundError до хука", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await expect(service.assertTurnAllowed("anna", chat.id, "send")).resolves.toBeUndefined();
    const { calls, beforeTurn } = gate();
    const guarded = setup({ beforeTurn }).service;
    const own = await guarded.createChat("anna");
    await expect(guarded.assertTurnAllowed("boris", own.id, "send")).rejects.toMatchObject({ name: "ChatNotFoundError" });
    expect(calls).toHaveLength(0);
  });

  describe("ответы, которые уходят с ветки (abandonedAnswerIds, previousAnswerId)", () => {
    /** Три вопроса и три ответа на одной ветке. */
    async function threeTurns() {
      const { calls, beforeTurn } = gate();
      const turnNotStarted = vi.fn<TurnNotStartedHandler>();
      const { service, storage } = setup({ beforeTurn, turnNotStarted });
      const chat = await service.createChat("anna");
      await answered(service, chat.id, "u1", "Раз");
      await answered(service, chat.id, "u2", "Два");
      await answered(service, chat.id, "u3", "Три");
      const answers = (await service.getHistory("anna", chat.id)).messages.filter((message) => message.role === "assistant").map((message) => message.id);
      calls.length = 0;
      return { service, storage, chat, answers, calls, turnNotStarted };
    }

    it("regenerate: переделываемый ответ и все ответы ниже по ветке", async () => {
      const { service, chat, answers, calls } = await threeTurns();
      await readAll(await service.regenerate("anna", chat.id, answers[1]!));
      expect(calls[0]).toMatchObject({ action: "regenerate", previousAnswerId: answers[1], abandonedAnswerIds: [answers[1], answers[2]] });
    });

    it("edit: ответы ниже правленого вопроса; прежний — ответ на этот вопрос", async () => {
      const { service, chat, answers, calls } = await threeTurns();
      await readAll(await service.editMessage("anna", chat.id, "u2", userMessage("u2b", "Два, но иначе")));
      expect(calls[0]).toMatchObject({ action: "edit", messageId: "u2b", previousAnswerId: answers[1], abandonedAnswerIds: [answers[1], answers[2]] });
    });

    it("вложенные ветки: ответы соседней ветки не считаются", async () => {
      const { service, chat, answers, calls } = await threeTurns();
      // «Переделать» второй ответ: новая ветка без u3 и третьего ответа.
      await readAll(await service.regenerate("anna", chat.id, answers[1]!));
      const regenerated = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
      await readAll(await service.editMessage("anna", chat.id, "u2", userMessage("u2b", "Два, но иначе")));
      expect(calls[1]).toMatchObject({ action: "edit", previousAnswerId: regenerated, abandonedAnswerIds: [regenerated] });
      // Правка первого вопроса на новой ветке: уходят только ответы этой ветки.
      const current = (await service.getHistory("anna", chat.id)).messages.filter((message) => message.role === "assistant").map((message) => message.id);
      await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1b", "Раз, но иначе")));
      expect(calls[2]).toMatchObject({ action: "edit", previousAnswerId: answers[0], abandonedAnswerIds: current });
      expect(calls[2]!.abandonedAnswerIds).not.toContain(answers[2]);
    });

    it("send: полей нет", async () => {
      const { service, chat, calls } = await threeTurns();
      await answered(service, chat.id, "u4", "Четыре");
      expect(calls[0]).not.toHaveProperty("abandonedAnswerIds");
      expect(calls[0]).not.toHaveProperty("previousAnswerId");
    });

    it("retry: прежний — оборванный ответ, который заменит сосед; turnNotStarted получает те же поля", async () => {
      const { calls, beforeTurn } = gate();
      const turnNotStarted = vi.fn<TurnNotStartedHandler>();
      // Второй ответ пустой — его можно повторить.
      const { service } = setup({ beforeTurn, turnNotStarted }, [saying("Раз"), [streamStart, finishPart()]]);
      const chat = await service.createChat("anna");
      await answered(service, chat.id, "u1", "Раз");
      await answered(service, chat.id, "u2", "Два");
      const broken = (await service.getHistory("anna", chat.id)).messages.at(-1)!.id;
      calls.length = 0;
      await readAll(await service.retry("anna", chat.id));
      expect(calls[0]).toMatchObject({ action: "retry", previousAnswerId: broken, abandonedAnswerIds: [broken] });

      // Повторить нечего — ход не начался, полей нет.
      await expect(service.retry("anna", chat.id)).rejects.toThrow();
      expect(calls[1]).not.toHaveProperty("previousAnswerId");
      expect(turnNotStarted).toHaveBeenLastCalledWith(expect.not.objectContaining({ previousAnswerId: expect.anything() }));
    });

    it("сообщения нет на ветке — полей нет, ход не начался (invalid)", async () => {
      const { service, chat, calls, turnNotStarted } = await threeTurns();
      await expect(service.regenerate("anna", chat.id, "нет-такого")).rejects.toThrow();
      expect(calls[0]).not.toHaveProperty("abandonedAnswerIds");
      expect(turnNotStarted).toHaveBeenCalledWith(expect.objectContaining({ action: "regenerate", reason: "invalid" }));
    });

    it("ход не начался — turnNotStarted получает те же id, ветка прежняя", async () => {
      const { service, storage, chat, answers, turnNotStarted } = await threeTurns();
      // Занятый чат: идёт ответ — переделка не начнётся.
      const running = await service.sendMessage("anna", chat.id, userMessage("u4", "Четыре"));
      const branchBefore = (await service.getHistory("anna", chat.id)).messages.map((message) => message.id);
      await expect(service.regenerate("anna", chat.id, answers[2]!)).rejects.toThrow();
      await readAll(running);
      // Ушли бы переделываемый ответ и идущий ответ ниже него.
      const running4 = (await storage.listMessages(chat.id)).at(-1)!.id;
      expect(turnNotStarted).toHaveBeenCalledWith(
        expect.objectContaining({ action: "regenerate", reason: "busy", previousAnswerId: answers[2], abandonedAnswerIds: [answers[2], running4] }),
      );
      expect(branchBefore.slice(0, 6)).toEqual((await storage.listMessages(chat.id)).slice(0, 6).map((message) => message.id));
    });
  });
});
