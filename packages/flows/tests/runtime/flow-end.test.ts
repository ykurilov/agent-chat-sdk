import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockAt, human, MSK, OWNER, tick } from "./timer-chat";
import { daysChat, iso, msk, systemOf, threeDays } from "./days-chat";

// 0.50, конец разговора по решению приложения (`flow.end`): человека перевели на другой продукт — «switched».

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

async function started(chat = daysChat()) {
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели", MSK);
  return { chat, id };
}

describe("flow.end: конец с причиной приложения", () => {
  it("событие конца как у остальных концов, сроки сняты, место — в той же ноде", async () => {
    const { chat, id } = await started();
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 9)) });
    clockAt(msk(13, 16));
    expect(await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched", outcome: "перешёл на курс масла" })).toEqual({ ended: true });
    await chat.flow.settled();
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "switched", endedAt: iso(msk(13, 16)), dueAt: null });
    expect(chat.finished).toEqual([
      expect.objectContaining({ ownerId: OWNER, chatId: id, reason: "switched", outcome: "перешёл на курс масла", day: 1, state: "intro", at: new Date(msk(13, 16)) }),
    ]);
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "intro", endReason: "switched", endedAt: msk(13, 16) });
    // Таймер дня больше не ведёт чат.
    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "intro" });
  });

  it("после конца — как настроено: reply — ответ по инструкции «после конца»; второй конец не случается", async () => {
    const { chat, id } = await started();
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "ended", reason: "switched", afterEnd: "reply" });
    await human(chat, id, "А можно ещё вопрос?", MSK);
    expect(systemOf(chat.model.doStreamCalls.at(-1)!)).toContain("Программа закончилась");
    expect(await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "other" })).toEqual({ ended: false });
    expect(chat.finished).toHaveLength(1);
    expect(chat.finished[0]).not.toHaveProperty("outcome");
  });

  it("silent: после конца агент молчит", async () => {
    const { chat, id } = await started(daysChat({ edit: (json) => (threeDays(json), (json.afterEnd = "silent")) }));
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "ended", reason: "switched", afterEnd: "silent" });
  });

  it("чат не по сценарию — ended: false; пустая причина — исключение", async () => {
    const chat = daysChat();
    expect(await chat.flow.end({ ownerId: OWNER, chatId: "нет-такого", reason: "switched" })).toEqual({ ended: false });
    const { id } = await started(chat);
    await expect(chat.flow.end({ ownerId: OWNER, chatId: id, reason: " " })).rejects.toThrow("reason");
  });
});
