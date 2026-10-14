import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAll } from "../../../core/tests/unit/support/mock-model";
import { userMessage } from "../../../core/tests/unit/support/notice-chat";
import { agentTexts, human, MSK, OWNER } from "./timer-chat";
import { daysChat, msk, promptText, threeDays } from "./days-chat";
import { FLOW_HELD_HUMAN_KEY } from "../../src/runtime/held-messages";

// Пачка сообщений человека (`sendBurstMessage`) в чате со сценарием: рамки дня считают каждое сообщение пачки,
// готовая фраза — одна на пачку, пауза сотрудника — пачка записана, агент молчит.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const SOFT = "сворачиваться до завтра";

function framed(frame: Record<string, unknown>) {
  return daysChat({ edit: (json) => threeDays(json, { dayFrame: frame }) });
}

type Chat = ReturnType<typeof framed>;

let burstNo = 0;
/** Пачка сообщений подряд (по секунде между ними); ждём тишину и ход. */
async function burst(chat: Chat, chatId: string, texts: string[]) {
  const sent = [];
  for (const text of texts) {
    burstNo += 1;
    sent.push(await chat.service.sendBurstMessage(OWNER, chatId, userMessage(`b${burstNo}`, text), { page: { timeZone: MSK } }));
    await vi.advanceTimersByTimeAsync(1000);
  }
  await vi.advanceTimersByTimeAsync(3000);
  for (const { turn } of sent) {
    const stream = await turn;
    if (stream) await readAll(stream);
  }
  await chat.flow.settled();
}

async function started(chat: Chat) {
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return id;
}

describe("пачка сообщений и рамки дня", () => {
  it("каждое сообщение пачки — в счёт дня: два после первого — уже третье, строка «сворачиваться»", async () => {
    const chat = framed({ softFrom: 3, hardAt: 10 });
    const id = await started(chat);
    await burst(chat, id, ["второе", "третье"]);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain(SOFT);
    const run = await chat.flow.readRun(OWNER, id);
    expect(run?.humanMessages).toBe(3);
    expect(Object.values(run?.dayCounts ?? {})).toEqual([3]);
  });

  it("пачка переходит жёсткую рамку — готовая фраза один раз на всю пачку, дальше молчание", async () => {
    const chat = framed({ hardAt: 3, hardText: "Утром отвечу!" });
    const id = await started(chat);
    const calls = chat.model.doStreamCalls.length;
    await burst(chat, id, ["2", "3", "4"]);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(await agentTexts(chat.service, id)).toEqual([expect.any(String), "Утром отвечу!"]);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toMatchObject({ kind: "hold" });
  });

  it("пачка после жёсткой рамки — отложена до утра, как одиночное сообщение: время в данных чата, срок — утро", async () => {
    const chat = framed({ hardAt: 2, hardText: "Утром отвечу!" });
    const id = await started(chat);
    await burst(chat, id, ["2", "3"]);
    const calls = chat.model.doStreamCalls.length;
    await burst(chat, id, ["4", "5"]);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(await agentTexts(chat.service, id)).toEqual([expect.any(String), "Утром отвечу!"]);
    expect((await chat.storage.getChat(id))?.data?.[FLOW_HELD_HUMAN_KEY]).toMatchObject({ at: expect.any(Number) });
    expect(Date.parse((await chat.store.getChat(id))!.dueAt!)).toBeLessThanOrEqual(msk(14, 9));
  });

  it("admit с числом сообщений: начало пачки уже за рамкой — молчать", async () => {
    const chat = framed({ hardAt: 3 });
    const id = await started(chat);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id, messages: 2 })).toMatchObject({ kind: "reply" });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id, messages: 1 })).toEqual({ kind: "answer" });
    await human(chat, id, "2");
    await human(chat, id, "3");
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id, messages: 2 })).toMatchObject({ kind: "hold" });
  });
});

describe("пачка сообщений и пауза сотрудника", () => {
  it("пауза: пачка записана, агент молчит; счёт дня не растёт", async () => {
    const chat = framed({ softFrom: 3, hardAt: 10 });
    const id = await started(chat);
    await chat.flow.pause({ ownerId: OWNER, chatId: id });
    await burst(chat, id, ["вопрос", "ещё"]);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    const { messages } = await chat.service.getHistory(OWNER, id);
    expect(messages.filter((message) => message.role === "user").map((message) => message.parts.find((part) => part.type === "text"))).toHaveLength(3);
    expect((await chat.flow.readRun(OWNER, id))?.humanMessages).toBe(1);
  });
});
