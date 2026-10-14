import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFlow, parseFlow } from "../src/format";
import type { FlowDeliveryOutcome, FlowOutgoing } from "../src/runtime/flow-types";
import { agentTexts, appNotices, clockAt, human, OWNER, stateOfChat, tick, timerChat } from "./runtime/timer-chat";
import { iso, msk, promptText, systemOf } from "./runtime/days-chat";

// SC-101 сквозным тестом: образец «первый результат за 3 дня» (demo/three-day-program.json) на модели-заглушке,
// поддельном судье и подменённых часах. Приложение доставляет сообщения «первым» своим каналом и получает исходы.
// Всё ожидание — через `settled()` (помощники `human` и `tick`), без реальных пауз.

const PROGRAM = new URL("../demo/three-day-program.json", import.meta.url);
const programJson = () => JSON.parse(readFileSync(PROGRAM, "utf8")) as Record<string, any>;

const SOFT = "сворачиваться до завтра";

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

/** Чат на образце с каналом приложения: исходы по очереди, дальше — `delivered`. */
function programChat(outcomes: FlowDeliveryOutcome[] = []) {
  const chat = timerChat({ flowJson: programJson() });
  const sent: FlowOutgoing[] = [];
  chat.flow.attach({
    portFor: () => chat.service,
    deliver: async (message) => {
      sent.push(message);
      return outcomes.shift() ?? { status: "delivered" };
    },
  });
  return { ...chat, sent };
}

type ProgramChat = ReturnType<typeof programChat>;

const timerReasons = async (chat: ProgramChat, id: string) =>
  (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer").map((notice) => (notice.data as { reasons: unknown[] }).reasons);

/** Среда 14.10, 15:00 по Москве: человек пришёл, агент ответил. */
async function arrived(chat: ProgramChat) {
  clockAt(msk(14, 15));
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Хочу сделать первый результат");
  return id;
}

describe("образец «первый результат за 3 дня»", () => {
  it("сценарий версии 2 разбирается и проходит проверку графа без ошибок", () => {
    const parsed = parseFlow(programJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const errors = checkFlow(parsed.flow, { tools: [], events: [], widgets: [] }).filter((issue) => issue.level === "error");
    expect(errors).toEqual([]);
  });
});

describe("SC-101: три дня, ночь, одно утреннее, рамки, «срок вышел», доставка приложения", () => {
  it("проходит программу от среды до субботы", async () => {
    const chat = programChat();
    const id = await arrived(chat);
    expect(await stateOfChat(chat.service, id)).toBe("build");
    const rules = systemOf(chat.model.doStreamCalls[0]!);
    expect(promptText(chat.model.doStreamCalls[0]!)).toContain("День 1 из 3");
    // Ближайший срок — касание «Сборки» через 15 минут тишины.
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 15, 15)), dueExitId: "@first" });

    // Касание: нода та же, сообщение уходит каналом приложения и засчитывается.
    clockAt(msk(14, 15, 15));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("build");
    expect(chat.sent).toEqual([expect.objectContaining({ chatId: id, reasons: [{ kind: "silence", step: 1 }], attempt: 1 })]);
    expect(chat.sent[0]!.text).toBe((await agentTexts(chat.service, id)).at(-1));
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-14")).toBe(1);

    // Вечер: человек разговорился. С 12-го сообщения — «сворачиваться» в хвосте, на 15-м — готовая фраза без модели.
    clockAt(msk(14, 19));
    for (let no = 2; no <= 11; no += 1) await human(chat, id, `вопрос ${no}`);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain(SOFT);
    for (let no = 12; no <= 14; no += 1) await human(chat, id, `вопрос ${no}`);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain(SOFT);
    const eveningCalls = chat.model.doStreamCalls.length;
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id, text: "вопрос 15" })).toEqual({ kind: "reply", text: "Утром отвечу!" });
    await human(chat, id, "вопрос 15");
    expect((await agentTexts(chat.service, id)).at(-1)).toBe("Утром отвечу!");

    // Ночью сообщения записываются, агент молчит; тик ночью ничего не шлёт.
    clockAt(msk(14, 23, 30));
    await human(chat, id, "ночной вопрос 1");
    await human(chat, id, "ночной вопрос 2");
    clockAt(msk(15, 3));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(eveningCalls);
    expect(chat.sent).toHaveLength(1);

    // Четверг 9:00: выход «Сборки» по сроку, утреннее и ответ на ночное — один ход, одно сообщение.
    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(eveningCalls + 1);
    expect(chat.sent).toHaveLength(2);
    expect(await stateOfChat(chat.service, id)).toBe("polish");
    expect((await timerReasons(chat, id)).at(-1)).toEqual(
      expect.arrayContaining([{ kind: "transition", stateId: "polish" }, { kind: "morning" }, { kind: "night_messages", count: 2 }]),
    );
    const thursday = chat.model.doStreamCalls.at(-1)!;
    expect(promptText(thursday)).toContain("День 2 из 3");
    expect(promptText(thursday)).not.toContain(SOFT);

    // Пятница 9:00: «Доработка» длится день — переход в «Продажу», последний день.
    clockAt(msk(16, 9));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("offer");
    expect(chat.sent).toHaveLength(3);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain("сегодня последний день");

    // Постоянная инструкция одна все три дня: день и рамки — только в хвосте (кэш цел).
    for (const call of chat.model.doStreamCalls) expect(systemOf(call)).toBe(rules);

    // Суббота 9:00: срок вышел — конец «deadline» в ноде «Срок вышел», без хода модели и без сообщения.
    const fridayCalls = chat.model.doStreamCalls.length;
    clockAt(msk(17, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(fridayCalls);
    expect(chat.sent).toHaveLength(3);
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "wrap", endReason: "deadline", endedAt: iso(msk(17, 9)), dueAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ chatId: id, reason: "deadline", day: 3, state: "wrap" })]);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "ended", reason: "deadline", afterEnd: "reply" });

    // После конца (reply): человек пишет — агент отвечает по инструкции «после конца», новых сроков нет.
    clockAt(msk(18, 12));
    await human(chat, id, "А можно ещё вопрос?");
    expect(systemOf(chat.model.doStreamCalls.at(-1)!)).toContain("Программа закончилась");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: null });
    expect(chat.finished).toHaveLength(1);
  });

  it("исходы доставки: retry — тот же текст без нового хода; blocked — конец «заблокировал», до срока не доходит", async () => {
    // Касание в среду — retry, потом доставлено; утро четверга — заблокировал.
    const chat = programChat([{ status: "retry" }, { status: "delivered" }, { status: "blocked" }]);
    const id = await arrived(chat);

    clockAt(msk(14, 15, 15));
    await tick(chat, id);
    const calls = chat.model.doStreamCalls.length;
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 15, 16)), delivery: { attempt: 2 } });
    clockAt(msk(14, 15, 16));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(chat.sent.map((message) => message.attempt)).toEqual([1, 2]);
    expect(chat.sent[1]).toMatchObject({ messageId: chat.sent[0]!.messageId, text: chat.sent[0]!.text });
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-14")).toBe(1);

    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "blocked", dueAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ chatId: id, reason: "blocked" })]);
    const undelivered = (await chat.service.peekHistory(OWNER, id)).messages.filter((message) => message.metadata?.undelivered === true);
    expect(undelivered.map((message) => message.role)).toContain("assistant");

    // Срок программы больше ничего не делает: разговор уже закончен.
    clockAt(msk(17, 9));
    await tick(chat, id);
    expect(chat.finished).toHaveLength(1);
  });
});
