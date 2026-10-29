import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowReopen } from "../../src/runtime/flow-types";
import { stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, OWNER, tick, timerChat, type TimerChat } from "./timer-chat";
import { msk, promptText } from "./days-chat";

// 105: `flow.reopen` — брошенный разговор (`abandoned`) или законченный своей причиной приложения открывается снова: та же
// нода, история и память; касания с первого шага от открытия; дни и срок программы — от исходного старта.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const MIN = 60_000;

/** Касание через 3 ч тишины, «не завершил» — сутки тишины человека; программа `lengthDays` дней, без утреннего. */
const abandonsInADay = (lengthDays: number) => (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = {
    dayStart: "09:00",
    nightFrom: "21:00",
    lengthDays,
    firstMessages: { maxPerDay: 10, morning: false },
    nudges: { afterSilence: [{ amount: 3, unit: "h" }], giveUpAfter: { amount: 1, unit: "d" } },
  };
};

/** Ходы «пишет первым» по пути часов (шаг 5 минут). */
async function firstTurnsUntil(chat: TimerChat, id: string, until: number) {
  const turns = async () => (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer" && notice.wakeAgent);
  const seen: Array<{ at: number; reasons: unknown }> = [];
  let count = (await turns()).length;
  let at = Date.now();
  while (at < until) {
    at = Math.min(at + 5 * MIN, until);
    clockAt(at);
    await tick(chat, id);
    const now = await turns();
    for (const turn of now.slice(count)) seen.push({ at, reasons: (turn.data as { reasons: unknown }).reasons });
    count = now.length;
  }
  return seen;
}

/** Человек пришёл 13.10 в 10:00, получил касание в 13:00 и замолчал: 14.10 в 10:00 — «не завершил». */
async function abandoned(lengthDays = 5) {
  const reopens: FlowReopen[] = [];
  const chat = timerChat({ edit: abandonsInADay(lengthDays), onReopen: (event) => void reopens.push(event) });
  clockAt(msk(13, 10));
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  await firstTurnsUntil(chat, id, msk(14, 10, 30));
  expect((await chat.flow.readRun(OWNER, id))?.endReason).toBe("abandoned");
  return { chat, id, reopens };
}

describe("flow.reopen", () => {
  it("abandoned → открыт: та же нода, живой разговор, admit отвечает, событие и запись в пути; дни — от исходного старта", async () => {
    const { chat, id, reopens } = await abandoned();
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toMatchObject({ kind: "ended", reason: "abandoned" });

    clockAt(msk(15, 12));
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id, reason: "вернулся в канал" })).toEqual({ reopened: true });

    const run = (await chat.flow.readRun(OWNER, id))!;
    expect(run.endedAt).toBeUndefined();
    expect(run.endReason).toBeUndefined();
    expect(run.state).toBe("intro");
    expect(run.day?.day).toBe(3);
    expect(run.path.at(-1)).toMatchObject({ state: "intro", from: "intro", decidedBy: "reopen", at: msk(15, 12) });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
    expect(reopens).toHaveLength(1);
    expect(reopens[0]).toMatchObject({ ownerId: OWNER, chatId: id, flowId: "sales-review", state: "intro", endReason: "abandoned", reason: "вернулся в канал", day: 3 });
    expect(reopens[0]!.at.getTime()).toBe(msk(15, 12));
    expect(reopens[0]!.endedAt.getTime()).toBe(msk(14, 10));
  });

  it("после открытия касание с первого шага от момента открытия, «не завершил» не наступает сразу", async () => {
    const { chat, id } = await abandoned();
    clockAt(msk(15, 12));
    await chat.flow.reopen({ ownerId: OWNER, chatId: id });
    expect(await firstTurnsUntil(chat, id, msk(15, 16))).toEqual([{ at: msk(15, 15), reasons: [{ kind: "silence", step: 1 }] }]);
    expect((await chat.flow.readRun(OWNER, id))?.endedAt).toBeUndefined();
  });

  it("следующий ход — в той же ноде с прежней историей; потом ряд касаний от ответа агента", async () => {
    const { chat, id } = await abandoned();
    clockAt(msk(15, 12));
    await chat.flow.reopen({ ownerId: OWNER, chatId: id });
    clockAt(msk(15, 12, 5));
    await human(chat, id, "Я вернулся");
    const prompt = promptText(chat.model.doStreamCalls.at(-1)!);
    expect(prompt).toContain("Курс по акварели");
    expect(prompt).toContain("Я вернулся");
    const run = (await chat.flow.readRun(OWNER, id))!;
    expect(run.state).toBe("intro");
    expect(run.endedAt).toBeUndefined();
    expect(await firstTurnsUntil(chat, id, msk(15, 16))).toEqual([{ at: msk(15, 15, 5), reasons: [{ kind: "silence", step: 1 }] }]);
  });

  it("повтор — ничего не меняет; две копии разом — открывает одна", async () => {
    const { chat, id, reopens } = await abandoned();
    clockAt(msk(15, 12));
    const both = await Promise.all([chat.flow.reopen({ ownerId: OWNER, chatId: id }), chat.flow.reopen({ ownerId: OWNER, chatId: id })]);
    expect(both.filter((result) => result.reopened)).toHaveLength(1);
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: false, reason: "not_ended" });
    expect(reopens).toHaveLength(1);
  });

  it("final, deadline, blocked, не законченный и чужой чат — не открываются; своя причина приложения — открывается", async () => {
    for (const reason of ["final", "deadline", "blocked"]) {
      const chat = timerChat({ edit: abandonsInADay(5) });
      const { id } = await chat.service.createChat(OWNER);
      await human(chat, id, "Привет");
      await chat.store.endChat(id, { reason, at: new Date(msk(13, 11)).toISOString() });
      expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: false, reason });
      expect((await chat.store.getChat(id))?.endReason).toBe(reason);
    }
    const chat = timerChat({ edit: abandonsInADay(5) });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: false, reason: "not_ended" });
    expect(await chat.flow.reopen({ ownerId: "чужой", chatId: id })).toEqual({ reopened: false, reason: "not_flow" });
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: "нет-такого" })).toEqual({ reopened: false, reason: "not_flow" });
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: true });
  });

  it("срок программы вышел — deadline_passed, разговор остаётся законченным", async () => {
    const { chat, id } = await abandoned(2);
    clockAt(msk(15, 12));
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: false, reason: "deadline_passed" });
    expect((await chat.store.getChat(id))?.endReason).toBe("abandoned");
  });

  it("таймеры от входа в ноду — от открытия: «в ноде 20 мин» после паузы в 2 дня не срабатывает сразу, через 20 мин — да", async () => {
    const chat = timerChat({
      edit: (json) => {
        abandonsInADay(5)(json);
        stateOf(json, "intro").exits.push({ id: "intro_20min", when: { type: "timer", from: "in_state", amount: 20, unit: "min" }, to: "block" });
      },
    });
    clockAt(msk(13, 10));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели");
    clockAt(msk(13, 10, 5));
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    clockAt(msk(15, 12));
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id })).toEqual({ reopened: true });
    await firstTurnsUntil(chat, id, msk(15, 12, 15));
    expect((await chat.flow.readRun(OWNER, id))?.state).toBe("intro");
    await firstTurnsUntil(chat, id, msk(15, 12, 25));
    const run = (await chat.flow.readRun(OWNER, id))!;
    expect(run.state).toBe("block");
    expect(run.path.at(-1)).toMatchObject({ from: "intro", exitId: "intro_20min" });
    expect(run.day?.day).toBe(3);
  });

  it("endedAfter: закончился раньше — ended_too_long_ago", async () => {
    const { chat, id } = await abandoned();
    clockAt(msk(15, 12));
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id, endedAfter: new Date(msk(14, 11)) })).toEqual({ reopened: false, reason: "ended_too_long_ago" });
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id, endedAfter: new Date(msk(14, 9)) })).toEqual({ reopened: true });
  });
});

describe('explicit final reopening for application-owned previews', () => {
  it('requires allowFinal, preserves history/state and admits a real next turn', async () => {
    const chat=timerChat({edit:abandonsInADay(5)});
    const {id}=await chat.service.createChat(OWNER);
    await human(chat,id,'История тестового разговора');
    await chat.flow.end({ownerId:OWNER,chatId:id,reason:'final'});
    const before=await chat.flow.readRun(OWNER,id);
    expect(await chat.flow.reopen({ownerId:OWNER,chatId:id})).toEqual({reopened:false,reason:'final'});
    expect(await chat.flow.reopen({ownerId:'stranger',chatId:id,allowFinal:true})).toEqual({reopened:false,reason:'not_flow'});
    expect(await chat.flow.reopen({ownerId:OWNER,chatId:id,allowFinal:true,reason:'expert preview'})).toEqual({reopened:true});
    expect(await chat.flow.admit({ownerId:OWNER,chatId:id})).toEqual({kind:'answer'});
    expect((await chat.flow.readRun(OWNER,id))?.state).toBe(before?.state);
    await human(chat,id,'Продолжение после окончания');
    const prompt=promptText(chat.model.doStreamCalls.at(-1)!);
    expect(prompt).toContain('История тестового разговора');
    expect(prompt).toContain('Продолжение после окончания');
  });
  it('does not bypass blocked, deadline or elapsed program deadlines', async () => {
    for(const reason of ['blocked','deadline']) {
      const chat=timerChat({edit:abandonsInADay(5)});
      const {id}=await chat.service.createChat(OWNER); await human(chat,id,'Привет');
      await chat.flow.end({ownerId:OWNER,chatId:id,reason});
      expect(await chat.flow.reopen({ownerId:OWNER,chatId:id,allowFinal:true})).toEqual({reopened:false,reason});
    }
    const chat=timerChat({edit:abandonsInADay(1)});
    const {id}=await chat.service.createChat(OWNER);await human(chat,id,'Привет');
    await chat.flow.end({ownerId:OWNER,chatId:id,reason:'final'});
    clockAt(msk(16,12));
    expect(await chat.flow.reopen({ownerId:OWNER,chatId:id,allowFinal:true})).toEqual({reopened:false,reason:'deadline_passed'});
  });
});
