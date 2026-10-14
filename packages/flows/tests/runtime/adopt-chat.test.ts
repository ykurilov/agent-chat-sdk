import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryFlowStore } from "../../src/store/memory";
import { withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, MSK, OWNER, stateOfChat, tick, timerChat, type TimerChatSetup } from "./timer-chat";
import { daysChat, iso, msk } from "./days-chat";

// 0.50, перенос идущего чата целиком: молчащий человек получает оставшиеся касания без нового хода, в своё время и
// не больше дневного потолка. Перенос переживает перезапуск сервера.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 11)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const NUDGES = {
  afterSilence: [
    { amount: 15, unit: "min" },
    { amount: 1, unit: "h" },
  ],
  dailyAt: ["19:00"],
  giveUpAfter: { amount: 3, unit: "d" },
};

/** Однодневный продукт: касания в «Днях и времени», ночь 21:00–09:00, потолок приложения — 3 в сутки. */
const product = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: NUDGES, dayFrame: { hardAt: 5, hardText: "Утром отвечу!" } };
};

/** Чат из старой системы: человек писал в 10:00, агент ответил и в 10:16 коснулся (первое касание ряда), сегодня это 2-е сообщение первым. */
const moved = {
  flowId: "sales-review",
  versionId: "v1",
  stateId: "block",
  startedAt: new Date(msk(13, 10)),
  enteredAt: new Date(msk(14, 9, 30)),
  lastHumanAt: new Date(msk(14, 10)),
  lastAgentAt: new Date(msk(14, 10, 16)),
  nudgeStep: 1,
  today: { firstMessages: 2, humanMessages: 4 },
  timeZone: MSK,
};

function chatOf(setup: TimerChatSetup = {}) {
  return timerChat({ edit: product, ...setup });
}

async function adopted(chat = chatOf(), extra: Record<string, unknown> = {}) {
  const { id } = await chat.service.createChat(OWNER);
  const result = await chat.flow.adopt({ ownerId: OWNER, chatId: id, ...moved, flow: chat.json, ...extra });
  return { chat, id, result };
}

const timerNotices = async (chat: ReturnType<typeof chatOf>, id: string) => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer");

describe("перенос идущего чата целиком (flow.adopt)", () => {
  it("закрепляет чат сразу, без хода: срок следующего касания — от последних слов агента и по шагу ряда", async () => {
    const { chat, id, result } = await adopted();
    expect(result).toEqual({ adopted: true });
    expect(chat.model.doStreamCalls).toHaveLength(0);
    // Шаг 1 уже был: следующий — «через час» от касания 10:16.
    expect(await chat.store.getChat(id)).toMatchObject({ stateId: "block", dueAt: iso(msk(14, 11, 16)), dueExitId: "@first" });
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({
      state: "block",
      lastHumanAt: msk(14, 10),
      lastAgentAt: msk(14, 10, 16),
      nudgeStep: 1,
    });
  });

  it("молчащий человек получает оставшиеся касания в своё время и не больше потолка за день", async () => {
    const { chat, id } = await adopted();
    clockAt(msk(14, 11, 16));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect((await timerNotices(chat, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 2 }], nudgeStep: 2 } });
    expect(await stateOfChat(chat.service, id)).toBe("block");
    // После ряда — касание в 19:00.
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 19)) });

    // Сегодня уже 3 сообщения первым (2 в старой системе + 1 сейчас): вечернее касание — завтра после ночи.
    clockAt(msk(14, 19));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)) });
  });

  it("без счёта старой системы вечернее касание ушло бы сегодня: потолок считается с перенесённым числом", async () => {
    const { chat, id } = await adopted(chatOf(), { today: { firstMessages: 0 } });
    clockAt(msk(14, 11, 16));
    await tick(chat, id);
    clockAt(msk(14, 19));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
  });

  it("переживает перезапуск сервера: новый процесс с тем же хранилищем пишет касание в срок", async () => {
    const store = memoryFlowStore();
    const before = chatOf({ store });
    const { id } = await adopted(before);
    const after = chatOf({ store, storage: before.storage });
    clockAt(msk(14, 11, 16));
    await tick(after, id);
    expect(after.model.doStreamCalls).toHaveLength(1);
    expect((await timerNotices(after, id)).at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 2 }] } });
    // Ход положил перенесённое место в состояние чата и снял запись переноса.
    expect((await store.getChat(id))?.placement).toBeNull();
    expect(await after.flow.readRun(OWNER, id)).toMatchObject({ state: "block", nudgeStep: 2, startedAt: msk(13, 10) });
  });

  it("сообщения человека за день идут в рамку дня: 5-е за сегодня — готовая фраза, дальше — молчание", async () => {
    const { chat, id } = await adopted();
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "reply", text: "Утром отвечу!" });
  });

  it("закрытый день: сегодня первым не пишет, касание — в начале следующего дня", async () => {
    const { chat, id } = await adopted(chatOf(), { today: { dayClosed: true } });
    expect(await chat.store.getChat(id)).toMatchObject({ dayClosedOn: "2026-10-14" });
    clockAt(msk(14, 11, 16));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(0);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)) });
  });

  it("человек молчит дольше giveUpAfter — «не завершил» от его последней реплики, а не от переноса", async () => {
    const { chat, id } = await adopted(chatOf(), { lastHumanAt: new Date(msk(11, 10)), lastAgentAt: new Date(msk(13, 19)), nudgeStep: 2 });
    // 3 дня тишины от 11.10 10:00 уже прошли: разговор кончается на первом обходе, без сообщения.
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(0);
    expect(chat.finished).toMatchObject([{ chatId: id, reason: "abandoned" }]);
  });

  it("уже закреплённый чат не переносится второй раз; счёт за день не удваивается", async () => {
    const { chat, id } = await adopted();
    expect(await chat.flow.adopt({ ownerId: OWNER, chatId: id, ...moved, flow: chat.json })).toEqual({ adopted: false });
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-14")).toBe(2);
  });

  it("ошибки переноса — исключением: нет состояния в сценарии", async () => {
    const chat = chatOf();
    const { id } = await chat.service.createChat(OWNER);
    await expect(chat.flow.adopt({ ownerId: OWNER, chatId: id, ...moved, stateId: "nope", flow: chat.json })).rejects.toThrow("nope");
    expect(await chat.store.getChat(id)).toBeNull();
  });

  it("те же поля из loadFlow: чат закрепляется первым ходом человека, счёт дня продолжается", async () => {
    const chat = daysChat({ edit: product, loadFlow: (json) => async () => ({ ...moved, flow: json, today: { humanMessages: 2 } }) });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "вернулся", MSK);
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "block", dayCounts: { "2026-10-14": 3 }, nudgeStep: 0, lastHumanAt: msk(14, 11) });
  });
});
