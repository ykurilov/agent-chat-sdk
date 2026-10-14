import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userTexts, systemOf } from "./flow-chat";
import { flowChat, newChat, OWNER, runOf, say } from "./flow-chat";
import { memoryFlowStore } from "../../src/store/memory";
import { miniV1, miniV2 } from "./migrate-flows";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

/** Три чата на v1: два в «Работе», один в «Отложено» (его в v2 нет). */
async function threeChats() {
  const chat = flowChat({ flowJson: miniV1() });
  const first = await newChat(chat.service);
  const second = await newChat(chat.service);
  const parked = await newChat(chat.service);
  await say(chat.service, first.id, "раз");
  await say(chat.service, second.id, "раз");
  await say(chat.service, parked.id, "раз");
  await say(chat.service, parked.id, "два");
  await chat.flow.settled();
  return { chat, ids: { first: first.id, second: second.id, parked: parked.id } };
}

describe("T091 flow.chatsByState", () => {
  it("считает чаты по версиям и состояниям; можно не показывать уже переведённые", async () => {
    const { chat } = await threeChats();
    const rows = await chat.flow.chatsByState("mini");
    expect(rows).toEqual([
      { versionId: "v1", stateId: "parked", chats: 1 },
      { versionId: "v1", stateId: "work", chats: 2 },
    ]);
    expect(await chat.flow.chatsByState("mini", { exceptVersionId: "v1" })).toEqual([]);
    expect(await chat.flow.chatsByState("нет такого")).toEqual([]);
  });
});

describe("T091 flow.migrateChats", () => {
  it("удалённое состояние с чатами без цели — отказ, ничего не тронуто", async () => {
    const { chat } = await threeChats();
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: {}, flow: miniV2() })).rejects.toThrow(/parked|Отложено/);
    expect(await chat.flow.chatsByState("mini")).toEqual([
      { versionId: "v1", stateId: "parked", chats: 1 },
      { versionId: "v1", stateId: "work", chats: 2 },
    ]);
    expect(await chat.store.getVersion("mini", "v2")).toBeNull();
  });

  it("цель, которой нет в новой версии, — отказ", async () => {
    const { chat } = await threeChats();
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "nowhere" }, flow: miniV2() })).rejects.toThrow(/nowhere/);
    expect((await chat.flow.chatsByState("mini")).every((row) => row.versionId === "v1")).toBe(true);
  });

  it("удалённое состояние без чатов цели не требует", async () => {
    const chat = flowChat({ flowJson: miniV1() });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "раз");
    await chat.flow.settled();
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: {}, flow: miniV2() })).resolves.toEqual({ moved: 1 });
  });

  it("новой версии нет ни в хранилище, ни в запросе — отказ с понятным текстом", async () => {
    const { chat } = await threeChats();
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" } })).rejects.toThrow(/v2/);
  });

  it("сценарий с ошибками или другой под тем же номером — отказ", async () => {
    const { chat } = await threeChats();
    const broken = { ...miniV2(), start: null };
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: broken })).rejects.toThrow();
    expect(await chat.store.getVersion("mini", "v2")).toBeNull();
    await chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() });
    const other = { ...miniV2(), name: "Другой сценарий" };
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: other })).rejects.toThrow(/v2/);
  });

  it("SC-007: три чата на старой версии, один в удалённом состоянии — после перевода все идут по новой", async () => {
    const { chat, ids } = await threeChats();
    const result = await chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() });
    expect(result).toEqual({ moved: 3 });

    // Версия и подсчёт меняются сразу, до первого хода чата.
    expect(await chat.flow.chatsByState("mini")).toEqual([
      { versionId: "v2", stateId: "waiting", chats: 1 },
      { versionId: "v2", stateId: "work", chats: 2 },
    ]);
    expect(await chat.store.getVersion("mini", "v2")).toMatchObject({ flow: { name: "Мини v2" } });
    expect((await runOf(chat.service, ids.parked))?.state).toBe("parked");

    // В начале следующего хода чат переходит: «Отложено» → «Ожидание», потом сообщение двигает его дальше; «Общее» — новой версии.
    await say(chat.service, ids.parked, "что там?");
    await chat.flow.settled();
    const calls = chat.model.doStreamCalls;
    const last = calls[calls.length - 1]!;
    expect(systemOf(last)).toContain("Версия 2");
    expect(userTexts(last)).toContain("Готово");
    const run = await runOf(chat.service, ids.parked);
    expect(run?.path.map((entry) => `${entry.state}:${entry.decidedBy}`)).toEqual(["intro:start", "work:event", "waiting:event", "waiting:migrate", "done:event"]);

    await say(chat.service, ids.first, "ещё");
    await chat.flow.settled();
    expect((await runOf(chat.service, ids.first))?.path.map((entry) => entry.state)).toEqual(["intro", "work", "waiting"]);
    expect((await chat.store.getChat(ids.first))?.versionId).toBe("v2");
    expect((await chat.store.getChat(ids.first))?.pending).toEqual([]);
  });

  it("таймеры пересчитаны сразу: по новой версии и с новым местом чата", async () => {
    const { chat, ids } = await threeChats();
    chat.timers.reschedule.mockClear();
    await chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() });
    const rescheduled = new Map(chat.timers.reschedule.mock.calls.map(([call]) => [call.chatId, call.run.state]));
    expect(rescheduled).toEqual(new Map([[ids.first, "work"], [ids.second, "work"], [ids.parked, "waiting"]]));
    for (const [call] of chat.timers.reschedule.mock.calls) expect(call.ownerId).toBe(OWNER);
  });

  it("не удалось пересчитать таймер одного чата — остальные переведены, строка в журнал", async () => {
    const { chat, ids } = await threeChats();
    chat.timers.reschedule.mockRejectedValueOnce(new Error("сбой"));
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() })).resolves.toEqual({ moved: 3 });
    expect(chat.logError).toHaveBeenCalledWith(expect.stringContaining("таймер не пересчитан"));
    expect((await chat.store.getChat(ids.parked))?.versionId).toBe("v2");
  });

  it("карта для состояния, которое в новой версии есть, не меняет место чата", async () => {
    const { chat, ids } = await threeChats();
    await chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting", work: "done" }, flow: miniV2() });
    expect((await chat.store.getChat(ids.first))?.stateId).toBe("work");
    await say(chat.service, ids.first, "ещё");
    expect((await runOf(chat.service, ids.first))?.state).toBe("waiting");
  });

  it("пачками: все чаты переведены, хранилище зовётся несколько раз", async () => {
    const store = memoryFlowStore();
    const chat = flowChat({ flowJson: miniV1(), store });
    await chat.flow.settled();
    for (let index = 0; index < 250; index += 1) {
      await store.pinChat({ chatId: `bulk-${index}`, ownerId: OWNER, flowId: "mini", versionId: "v1", stateId: "work", timeZone: "UTC", at: new Date().toISOString() });
    }
    const spy = vi.spyOn(store, "migrateBatch");
    const result = await chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() });
    expect(result).toEqual({ moved: 250 });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(await store.countChatsByState({ flowId: "mini" })).toEqual([{ versionId: "v2", stateId: "work", chats: 250 }]);
  });

  it("повторный перевод на ту же версию ничего не делает", async () => {
    const { chat } = await threeChats();
    const input = { flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() };
    await chat.flow.migrateChats(input);
    await expect(chat.flow.migrateChats(input)).resolves.toEqual({ moved: 0 });
  });
});
