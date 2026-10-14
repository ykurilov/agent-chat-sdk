import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { memoryFlowStore } from "../../src/store/memory";
import { withoutSilenceTimers } from "../flow-fixtures";
import { clockAt, human, MSK, OWNER, tick, timerChat, type TimerChatSetup } from "./timer-chat";
import { iso, msk } from "./days-chat";

// 0.53: `createAgentFlow({ defaultTimeZone })` — пояс, пока пояс человека неизвестен (до первого хода, мессенджер без
// страницы). Порядок: человек → страница → defaultTimeZone → пояс службы (`agent.timeZone`) → сервер.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 11)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const MAKASSAR = "Asia/Makassar"; // UTC+8: 19:00 там — 14:00 по Москве.

/** Касание по тишине через 15 минут и вечернее в 19:00; тихие часы 21:00–09:00 (правила «писать первым» по умолчанию). */
const product = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: [{ amount: 15, unit: "min" }], dailyAt: ["19:00"] } };
};

const chatOf = (setup: TimerChatSetup = {}) => timerChat({ edit: product, agent: { timeZone: MAKASSAR }, ...setup });

/** Перенесённый чат без пояса: агент коснулся в 10:00, шаг ряда пройден — дальше только вечернее касание. */
async function adoptedWithoutZone(chat: ReturnType<typeof chatOf>) {
  const { id } = await chat.service.createChat(OWNER);
  await chat.flow.adopt({ ownerId: OWNER, chatId: id, flowId: "sales-review", versionId: "v1", stateId: "block", flow: chat.json, lastHumanAt: new Date(msk(14, 9, 45)), lastAgentAt: new Date(msk(14, 10)), nudgeStep: 1 });
  return id;
}

describe("defaultTimeZone — пояс, пока пояс человека неизвестен", () => {
  it("до первого хода: вечернее касание в 19:00 по defaultTimeZone, а не по поясу службы; предупреждения о поясе сервера нет", async () => {
    const chat = chatOf({ defaultTimeZone: MSK });
    const id = await adoptedWithoutZone(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 19)) });
    expect(chat.logError).not.toHaveBeenCalled();

    // Без настройки — пояс службы, как раньше.
    const old = chatOf();
    const oldId = await adoptedWithoutZone(old);
    expect(await old.store.getChat(oldId)).toMatchObject({ dueAt: iso(msk(14, 14)) });
  });

  it("мессенджер без страницы: день и тихие часы по defaultTimeZone; пояс человеку не записывается", async () => {
    const chat = chatOf({ defaultTimeZone: MSK });
    clockAt(msk(14, 20, 50));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели", null);
    // 21:05 по Москве — тихие часы: касание утром в 09:00 по Москве (по поясу службы было бы 04:00 по Москве).
    clockAt(msk(14, 21, 5));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)) });
    expect(await chat.store.readTimeZone(OWNER)).toBeNull();
    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
  });

  it("пояс страницы главнее defaultTimeZone", async () => {
    const chat = chatOf({ defaultTimeZone: MAKASSAR, agent: {} });
    clockAt(msk(14, 20, 50));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели", MSK);
    expect(await chat.store.readTimeZone(OWNER)).toBe(MSK);
    clockAt(msk(14, 21, 5));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(15, 9)) });
  });

  it("пояс страницы, совпавший с поясом службы, — всё равно пояс страницы, defaultTimeZone его не перебивает", async () => {
    const chat = chatOf({ defaultTimeZone: MAKASSAR, agent: { timeZone: MSK } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели", MSK);
    expect(await chat.store.readTimeZone(OWNER)).toBe(MSK);
  });

  it("дата в запросе к модели — тоже по defaultTimeZone, если у службы своего пояса нет", async () => {
    // 01:00 14 октября по Москве — на сервере (UTC) ещё 13-е.
    clockAt(msk(14, 1));
    const chat = timerChat({ edit: product, defaultTimeZone: MSK });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Какое сегодня число?", null);
    expect(JSON.stringify(chat.model.doStreamCalls.at(-1)!.prompt)).toMatch(/Сегодня: [^"]*14 октября/);

    // Свой пояс службы главнее: дата по нему.
    const own = timerChat({ edit: product, defaultTimeZone: MSK, agent: { timeZone: "UTC" } });
    const { id: ownId } = await own.service.createChat(OWNER);
    await human(own, ownId, "Какое сегодня число?", null);
    expect(JSON.stringify(own.model.doStreamCalls.at(-1)!.prompt)).toMatch(/Сегодня: [^"]*13 октября/);
  });

  it("не пояс IANA — ошибка при создании", () => {
    expect(() =>
      buildAgentFlow({ loadFlow: async () => null, store: memoryFlowStore(), judge: { fallback: { modelId: "m", providerId: "p" } }, defaultTimeZone: "Mars/Olympus" }),
    ).toThrow(TypeError);
  });
});
