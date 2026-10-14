import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR } from "../flow-fixtures";
import { agentTexts, attachApp, clockAt, errorsBesidesZone, human, MSK, NOVOSIBIRSK, OWNER, stateOfChat, T0, tickAll } from "./attach-support";

// T101/T102: две службы чата с разной инструкцией на один сценарий; `portFor` отдаёт службу чата, `attach(service)` 0.48
// работает как было.

beforeEach(() => {
  // Пояс сервера — UTC, не пояс приложения: тест не зависит от машины.
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.TZ;
});

const REMIND = "Вы ещё здесь? Можем продолжить, когда будет удобно.";

/** Две службы и по одному чату в каждой, человек написал по разу. */
async function twoChats(setup: Parameters<typeof attachApp>[0] = {}, zones: { a?: string; b?: string } = {}) {
  const app = attachApp(setup);
  const a = app.addService("А", zones.a === undefined ? {} : { timeZone: zones.a });
  const b = app.addService("Б", zones.b === undefined ? {} : { timeZone: zones.b });
  const idA = await app.openChat(a);
  const idB = await app.openChat(b);
  app.flow.attach({ portFor: app.portFor });
  await human(app, a.service, idA, "привет, я А");
  await human(app, b.service, idB, "привет, я Б");
  return { app, a, b, idA, idB };
}

describe("T101 привязка: служба на чат", () => {
  it("ход по таймеру идёт службой своего чата", async () => {
    const { app, a, b, idA, idB } = await twoChats();
    const deliverA = vi.spyOn(a.service, "deliverNotices");
    const deliverB = vi.spyOn(b.service, "deliverNotices");

    clockAt(T0 + 3 * HOUR);
    await tickAll(app, [
      { service: a.service, id: idA },
      { service: b.service, id: idB },
    ]);

    expect(deliverA.mock.calls.map(([input]) => input.chatId)).toEqual([idA]);
    expect(deliverB.mock.calls.map(([input]) => input.chatId)).toEqual([idB]);
    expect(await stateOfChat(a.service, idA)).toBe("remind");
    expect(await stateOfChat(b.service, idB)).toBe("remind");
    expect((await agentTexts(a.service, idA)).at(-1)).toBe(REMIND);
    expect((await agentTexts(b.service, idB)).at(-1)).toBe(REMIND);
    expect(errorsBesidesZone(app)).toEqual([]);
  });

  it("судья после хода спрашивает запасную модель службы своего чата", async () => {
    const app = attachApp({ realJudge: true });
    const a = app.addService("А");
    const b = app.addService("Б");
    const idA = await app.openChat(a);
    const idB = await app.openChat(b);
    app.flow.attach({ portFor: app.portFor });
    const answer = { text: "", object: { met: [] }, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
    const askA = vi.spyOn(a.service, "askModel").mockResolvedValue(answer);
    const askB = vi.spyOn(b.service, "askModel").mockResolvedValue(answer);

    await human(app, b.service, idB, "курс про Excel, продаж нет");

    expect(askB).toHaveBeenCalledTimes(1);
    expect(askB.mock.calls[0]![0]).toMatchObject({ ownerId: OWNER, chatId: idB });
    expect(askA).not.toHaveBeenCalled();

    await human(app, a.service, idA, "а у меня курс про йогу");
    expect(askA).toHaveBeenCalledTimes(1);
    expect(askA.mock.calls[0]![0]).toMatchObject({ chatId: idA });
    expect(askB).toHaveBeenCalledTimes(1);
  });

  it("readRun, сигнал и перемотка часов тоже идут службой чата", async () => {
    const { app, a, b, idA, idB } = await twoChats();
    expect(await app.flow.readRun(OWNER, idA)).toMatchObject({ state: "intro" });
    expect(await app.flow.readRun(OWNER, idB)).toMatchObject({ state: "intro" });

    const deliverA = vi.spyOn(a.service, "deliverNotices");
    const deliverB = vi.spyOn(b.service, "deliverNotices");
    await app.flow.signal({ ownerId: OWNER, chatId: idB, name: "ping", wakeAgent: true });
    expect(deliverA).not.toHaveBeenCalled();
    expect(deliverB).toHaveBeenCalledTimes(1);
  });

  it("portFor зовётся один раз на чат: ответ запоминается", async () => {
    const { app, a, b, idA, idB } = await twoChats();
    clockAt(T0 + 3 * HOUR);
    await tickAll(app, [
      { service: a.service, id: idA },
      { service: b.service, id: idB },
    ]);
    await app.flow.readRun(OWNER, idA);
    await app.flow.readRun(OWNER, idA);

    const asked = app.portFor.mock.calls.map(([chat]) => chat.chatId);
    expect(asked.filter((id) => id === idA)).toHaveLength(1);
    expect(asked.filter((id) => id === idB)).toHaveLength(1);
    expect(app.portFor).toHaveBeenCalledWith({ ownerId: OWNER, chatId: idA });
  });

  it("перевод чатов на новую версию сбрасывает запомненные службы", async () => {
    const { app, idA } = await twoChats();
    const before = app.portFor.mock.calls.length;
    await app.flow.migrateChats({ flowId: "sales-review", toVersionId: "v2", map: {}, flow: app.json });
    await app.flow.readRun(OWNER, idA);
    expect(app.portFor.mock.calls.length).toBeGreaterThan(before);
  });

  it("attach(service) как в 0.48: одна служба на все чаты", async () => {
    const app = attachApp();
    const only = app.addService("Единая");
    const first = await only.service.createChat(OWNER);
    const second = await only.service.createChat(OWNER);
    app.flow.attach(only.service);
    await human(app, only.service, first.id, "раз");
    await human(app, only.service, second.id, "два");

    clockAt(T0 + 3 * HOUR);
    await tickAll(app, [
      { service: only.service, id: first.id },
      { service: only.service, id: second.id },
    ]);
    expect(await stateOfChat(only.service, first.id)).toBe("remind");
    expect(await stateOfChat(only.service, second.id)).toBe("remind");
    expect(errorsBesidesZone(app)).toEqual([]);
  });

  it("чат без службы в portFor — ошибка в журнале, остальные чаты работают", async () => {
    const { app, a, b, idA, idB } = await twoChats();
    app.owners.delete(idA);
    app.flow.attach({ portFor: app.portFor });
    app.portFor.mockClear();
    clockAt(T0 + 3 * HOUR);
    await tickAll(app, [{ service: b.service, id: idB }]);

    expect(await stateOfChat(b.service, idB)).toBe("remind");
    expect(await stateOfChat(a.service, idA)).toBe("intro");
    expect(app.logError).toHaveBeenCalledWith(expect.stringContaining(idA));
  });
});

describe("T102 пояс приложения — свой у каждой службы", () => {
  it("сообщение без пояса страницы не записывается человеку чужим поясом приложения", async () => {
    const { app, idA, idB } = await twoChats({}, { a: NOVOSIBIRSK, b: MSK });

    expect(await app.store.getChat(idA)).toMatchObject({ timeZone: "" });
    expect(await app.store.getChat(idB)).toMatchObject({ timeZone: "" });
  });

  it("тихие часы чата считаются по поясу его службы", async () => {
    const { app, a, b, idA, idB } = await twoChats({}, { a: NOVOSIBIRSK, b: MSK });

    // Тишина 3 ч наступает в 15:00Z: в Москве 18:00 — можно писать, в Новосибирске 22:00 — тихие часы, срок на 09:00.
    clockAt(T0 + 3 * HOUR);
    await tickAll(app, [
      { service: a.service, id: idA },
      { service: b.service, id: idB },
    ]);

    expect(await stateOfChat(b.service, idB)).toBe("remind");
    expect(await stateOfChat(a.service, idA)).toBe("intro");
    expect(await app.store.getChat(idA)).toMatchObject({ dueAt: new Date(Date.UTC(2026, 9, 14, 2, 0)).toISOString(), dueExitId: "any_silence" });
  });
});
