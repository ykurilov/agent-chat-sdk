import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying, waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { flowTestChatData } from "../../src/runtime/test-clock";
import { createClientCard } from "../../src/runtime/client-card";
import { memoryFlowStore } from "../../src/store/memory";
import type { AgentFlowOptions } from "../../src/runtime/flow-types";
import { withoutSilenceTimers } from "../flow-fixtures";
import { agentTexts, clockAt, human, OWNER, T0, tick, timerChat, type TimerChatSetup } from "./timer-chat";
import { promptText, systemOf } from "./days-chat";
import { toolOutput, userTexts } from "./flow-chat";

// Человек вернулся после паузы: касания прекращаются без конца разговора (`nudges.stopAfter`), агент видит, сколько
// прошло (`pauseNotice`), и после конца отвечает по своему правилу приложения (`afterEndRules`).

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const DAY = 86_400_000;
const STOP = { afterSilence: [1, 1, 1, 1, 1].map((amount) => ({ amount, unit: "d" })), stopAfter: { amount: 3, unit: "d" } };
const PAUSE: AgentFlowOptions["pauseNotice"] = { after: { amount: 3, unit: "d" } };

const withStop = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.nudges = STOP;
};

async function testChat(chat: ReturnType<typeof timerChat>) {
  const { id } = await chat.service.createChat(OWNER, { data: flowTestChatData() });
  return id;
}

async function advance(chat: ReturnType<typeof timerChat>, chatId: string, ms: number) {
  await chat.flow.advanceTestClock({ ownerId: OWNER, chatId, ms });
  await waitTurn(chat.service, chatId);
  await chat.flow.settled();
}

/** Чат с настоящей карточкой клиента: агент запоминает имя. */
function cardChat(setup: TimerChatSetup = {}) {
  const store = memoryFlowStore();
  return timerChat({ store, clientCard: createClientCard(store, () => new Date()), ...setup });
}

const toolNames = (call: { tools?: unknown }) => JSON.stringify(call.tools ?? []);

describe("nudges.stopAfter в живом чате", () => {
  it("касания до срока, потом тишина без конца разговора — и при перемотке на год", async () => {
    const chat = timerChat({ edit: withStop });
    const id = await testChat(chat);
    await human(chat, id, "Привет");
    await advance(chat, id, DAY);
    await advance(chat, id, DAY);
    expect(await agentTexts(chat.service, id)).toHaveLength(3);

    await advance(chat, id, 365 * DAY);
    expect(await agentTexts(chat.service, id)).toHaveLength(3);
    expect(chat.finished).toEqual([]);
    expect(await chat.store.getChat(id)).toMatchObject({ endedAt: null, dueAt: null });

    // Человек вернулся — ряд касаний заново.
    await human(chat, id, "Я снова тут");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: expect.any(String) });
    expect(chat.logError).not.toHaveBeenCalled();
  });

  it("рабочий чат: таймер после stopAfter касания не пишет", async () => {
    const chat = timerChat({ edit: withStop });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    clockAt(T0 + DAY);
    await tick(chat, id);
    clockAt(T0 + 2 * DAY);
    await tick(chat, id);
    clockAt(T0 + 40 * DAY);
    await tick(chat, id);
    expect(await agentTexts(chat.service, id)).toHaveLength(3);
    expect(chat.finished).toEqual([]);
  });
});

describe("pauseNotice: сколько прошло с прошлого сообщения человека", () => {
  it("без опции — факта нет", async () => {
    const chat = timerChat({ edit: withStop });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    clockAt(T0 + 10 * DAY);
    await human(chat, id, "Я вернулся");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain("Пауза");
  });

  it("пауза короче порога — факта нет; длиннее — в хвосте шага, инструкция та же, в истории его нет", async () => {
    const chat = timerChat({ edit: withStop, options: { pauseNotice: PAUSE } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    clockAt(T0 + DAY);
    await human(chat, id, "Ещё вопрос");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain("Пауза");

    clockAt(T0 + 6 * DAY);
    await human(chat, id, "Я вернулся");
    const call = chat.model.doStreamCalls.at(-1)!;
    expect(promptText(call)).toContain("Пауза: человек не писал 5 дней, его прошлое сообщение — 14 октября 2026");
    expect(systemOf(call)).toBe(systemOf(chat.model.doStreamCalls[0]!));

    // Следующая реплика без паузы — факта нет, и в прошлых сообщениях он не остался.
    await human(chat, id, "И ещё");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain("Пауза");
  });

  it("тестовый чат: по перемотанным часам; после конца (afterEnd reply) — факт о конце", async () => {
    const chat = timerChat({ edit: withStop, options: { pauseNotice: PAUSE } });
    const id = await testChat(chat);
    await human(chat, id, "Привет");
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    await chat.flow.settled();

    // 13.10.2026 → 13.01.2027 по часам тестового чата.
    await advance(chat, id, 92 * DAY);
    expect(await agentTexts(chat.service, id)).toHaveLength(1);
    await human(chat, id, "Я вернулся");
    const call = chat.model.doStreamCalls.at(-1)!;
    expect(promptText(call)).toContain("Пауза: человек не писал 3 месяца, его прошлое сообщение — 13 октября 2026");
    expect(promptText(call)).toContain("Разговор уже закончен");
    expect(systemOf(call)).toContain("Программа закончилась");
  });

  it("после конца агент видит карточку клиента (flow:client) и записывает в неё через flow_note", async () => {
    const chat = cardChat({
      edit: withStop,
      scripts: [saying("Здравствуйте"), callTool("flow_note", "n1", { field: "course_topic", value: "Акварель для детей" }), saying("Записал"), saying("Помню")],
    });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    // Имя записано в карточку раньше, в другом разговоре: ни в сообщениях, ни в вызовах инструментов этого чата его нет.
    await chat.store.writeCardField({ ownerId: OWNER, fieldId: "name", value: "Ольга", chatId: "other", flowId: "sales-review", at: new Date().toISOString() });
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });

    await human(chat, id, "Я вернулся, у меня курс по акварели для детей");
    const back = chat.model.doStreamCalls.at(-2)!;
    expect(systemOf(back)).toContain("Программа закончилась");
    expect(userTexts(back)).toContain("Что известно о человеке");
    expect(userTexts(back)).toContain("Имя: Ольга");
    expect(toolOutput(chat.model.doStreamCalls.at(-1)!, "n1")).toContain("Записано");
    expect(await chat.store.readCard(OWNER)).toContainEqual(expect.objectContaining({ fieldId: "course_topic", value: "Акварель для детей", chatId: id }));

    await human(chat, id, "Что дальше?");
    expect(userTexts(chat.model.doStreamCalls.at(-1)!)).toContain("Тема курса: Акварель для детей");
  });

  it("разговор закрыли и открыли заново — так и сказано", async () => {
    const chat = timerChat({ edit: withStop, options: { pauseNotice: PAUSE } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    clockAt(T0 + DAY);
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    clockAt(T0 + 400 * DAY);
    expect(await chat.flow.reopen({ ownerId: OWNER, chatId: id, reason: "вернулся" })).toMatchObject({ reopened: true });
    await chat.flow.settled();
    await human(chat, id, "Я вернулся");
    const text = promptText(chat.model.doStreamCalls.at(-1)!);
    expect(text).toContain("Пауза: человек не писал 1 год 1 месяц");
    expect(text).toContain("Разговор был закончен и открыт заново");
    expect(text).not.toContain("Разговор уже закончен");
  });
});

describe("afterEndRules: своё правило после конца", () => {
  it("строка заменяет встроенное, «Общее» дописано; данные чата у приложения", async () => {
    const afterEndRules = vi.fn(async () => "# После конца\n\nПомни итог и выясни, с чем человек пришёл.");
    const chat = timerChat({ edit: withStop, options: { afterEndRules } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    await human(chat, id, "Я вернулся");
    const system = systemOf(chat.model.doStreamCalls.at(-1)!);
    expect(system).toContain("Помни итог и выясни, с чем человек пришёл.");
    expect(system).not.toContain("Программа закончилась");
    expect(system).toContain("## Общее");
    expect(afterEndRules).toHaveBeenCalledWith(expect.objectContaining({ ownerId: OWNER, chatId: id, endReason: "switched", flow: expect.objectContaining({ id: expect.any(String) }) }));
    // До конца не зовётся.
    expect(systemOf(chat.model.doStreamCalls[0]!)).not.toContain("После конца");
  });

  it("null — встроенное правило", async () => {
    const chat = timerChat({ edit: withStop, options: { afterEndRules: () => null } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет");
    await chat.flow.end({ ownerId: OWNER, chatId: id, reason: "switched" });
    await human(chat, id, "Я вернулся");
    expect(systemOf(chat.model.doStreamCalls.at(-1)!)).toContain("Программа закончилась");
  });
});
