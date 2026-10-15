import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flowTestChatData } from "../../src/runtime";
import type { FlowChatCandidate } from "../../src/runtime/flow-types";
import { flowChat, newChat, OWNER, say } from "./flow-chat";
import { miniV1, miniV2 } from "./migrate-flows";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

/**
 * Пять чатов на v1 в «Работе»: два боевых, один закончен (`flow.end`), один тестовый чат редактора, один боевой
 * с пометкой приложения «проверка» в данных чата.
 */
async function mixedChats() {
  const chat = flowChat({ flowJson: miniV1() });
  const live = await newChat(chat.service);
  const second = await newChat(chat.service);
  const ended = await newChat(chat.service);
  const test = await chat.service.createChat(OWNER, { data: flowTestChatData() });
  const check = await chat.service.createChat(OWNER, { data: { leadMagnet: { check: true } } });
  for (const { id } of [live, second, ended, test, check]) await say(chat.service, id, "раз");
  await chat.flow.settled();
  await chat.flow.end({ ownerId: OWNER, chatId: ended.id, reason: "deadline" });
  return { chat, ids: { live: live.id, second: second.id, ended: ended.id, test: test.id, check: check.id } };
}

const toV2 = { flowId: "mini", toVersionId: "v2", map: { parked: "waiting" }, flow: miniV2() };

describe("083 отбор чатов при переводе", () => {
  it("по умолчанию закончившиеся разговоры и тестовые чаты редактора не считаются и не переводятся", async () => {
    const { chat, ids } = await mixedChats();
    expect(await chat.flow.chatsByState("mini", { exceptVersionId: "v2" })).toEqual([{ versionId: "v1", stateId: "work", chats: 3 }]);
    expect(await chat.flow.migrateChats(toV2)).toEqual({ moved: 3 });
    for (const id of [ids.live, ids.second, ids.check]) expect((await chat.store.getChat(id))?.versionId).toBe("v2");
    for (const id of [ids.ended, ids.test]) expect((await chat.store.getChat(id))?.versionId).toBe("v1");
  });

  it("`includeEnded` и `includeTestChats` возвращают их в счёт и перевод", async () => {
    const { chat, ids } = await mixedChats();
    const all = { includeEnded: true, includeTestChats: true };
    expect(await chat.flow.chatsByState("mini", { exceptVersionId: "v2", ...all })).toEqual([{ versionId: "v1", stateId: "work", chats: 5 }]);
    expect(await chat.flow.migrateChats({ ...toV2, ...all })).toEqual({ moved: 5 });
    for (const id of Object.values(ids)) expect((await chat.store.getChat(id))?.versionId).toBe("v2");
  });

  it("`filter` видит запись прогона и данные чата; что посчитали — то и перевели", async () => {
    const { chat, ids } = await mixedChats();
    const seen: FlowChatCandidate[] = [];
    const filter = async (candidate: FlowChatCandidate) => {
      seen.push(candidate);
      return !(candidate.data.leadMagnet as { check?: boolean } | undefined)?.check;
    };
    const counted = await chat.flow.chatsByState("mini", { exceptVersionId: "v2", filter, includeEnded: true, includeTestChats: true });
    expect(counted).toEqual([{ versionId: "v1", stateId: "work", chats: 4 }]);
    expect(seen.find((candidate) => candidate.chatId === ids.check)).toEqual({
      chatId: ids.check,
      ownerId: OWNER,
      flowId: "mini",
      versionId: "v1",
      stateId: "work",
      ended: false,
      endReason: null,
      test: false,
      data: { leadMagnet: { check: true } },
    });
    expect(seen.find((candidate) => candidate.chatId === ids.ended)).toMatchObject({ ended: true, endReason: "deadline" });
    expect(seen.find((candidate) => candidate.chatId === ids.test)).toMatchObject({ test: true });

    const result = await chat.flow.migrateChats({ ...toV2, filter, includeEnded: true, includeTestChats: true });
    expect(result.moved).toBe(counted[0]!.chats);
    expect((await chat.store.getChat(ids.check))?.versionId).toBe("v1");
  });

  it("`chatIds` ограничивает выбор; закончившиеся и тестовые среди них по умолчанию тоже пропускаются", async () => {
    const { chat, ids } = await mixedChats();
    const chatIds = [ids.live, ids.ended, ids.test];
    expect(await chat.flow.chatsByState("mini", { chatIds })).toEqual([{ versionId: "v1", stateId: "work", chats: 1 }]);
    expect(await chat.flow.migrateChats({ ...toV2, chatIds })).toEqual({ moved: 1 });
    expect((await chat.store.getChat(ids.live))?.versionId).toBe("v2");
    expect((await chat.store.getChat(ids.second))?.versionId).toBe("v1");
    expect(await chat.flow.migrateChats({ ...toV2, chatIds: [] })).toEqual({ moved: 0 });
  });

  it("цель для удалённой ноды нужна только если в ней есть отобранные чаты", async () => {
    const chat = flowChat({ flowJson: miniV1() });
    const parked = await newChat(chat.service);
    const working = await newChat(chat.service);
    await say(chat.service, parked.id, "раз");
    await say(chat.service, parked.id, "два");
    await say(chat.service, working.id, "раз");
    await chat.flow.settled();
    const only = { flowId: "mini", toVersionId: "v2", map: {}, flow: miniV2() };
    await expect(chat.flow.migrateChats(only)).rejects.toThrow(/parked/);
    await expect(chat.flow.migrateChats({ ...only, chatIds: [working.id] })).resolves.toEqual({ moved: 1 });
    expect((await chat.store.getChat(parked.id))?.versionId).toBe("v1");
  });

  it("чат, которого уже нет в службе чата, не мешает: считается боевым", async () => {
    const chat = flowChat({ flowJson: miniV1() });
    await chat.flow.settled();
    await chat.store.pinChat({ chatId: "gone", ownerId: OWNER, flowId: "mini", versionId: "v1", stateId: "work", timeZone: "UTC", at: new Date().toISOString() });
    expect(await chat.flow.chatsByState("mini")).toEqual([{ versionId: "v1", stateId: "work", chats: 1 }]);
    expect(await chat.flow.migrateChats(toV2)).toEqual({ moved: 1 });
  });
});
