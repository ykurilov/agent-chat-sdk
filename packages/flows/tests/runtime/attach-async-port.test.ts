import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR } from "../flow-fixtures";
import { agentTexts, attachApp, clockAt, errorsBesidesZone, human, NOVOSIBIRSK, OWNER, stateOfChat, T0, tickAll } from "./attach-support";

// `portFor` приложения может отвечать обещанием: службу чата ещё надо найти. Все места ждут её.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.TZ;
});

async function twoChats(setup: Parameters<typeof attachApp>[0] = {}, zones: { a?: string } = {}) {
  const app = attachApp({ asyncPort: true, ...setup });
  const a = app.addService("А", zones.a === undefined ? {} : { timeZone: zones.a });
  const b = app.addService("Б");
  const idA = await app.openChat(a);
  const idB = await app.openChat(b);
  app.flow.attach({ portFor: app.portFor });
  await human(app, a.service, idA, "привет, я А");
  await human(app, b.service, idB, "привет, я Б");
  return { app, a, b, idA, idB };
}

describe("асинхронный portFor", () => {
  it("ходы, таймеры и чтение места идут службой своего чата", async () => {
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
    expect(await app.flow.readRun(OWNER, idB)).toMatchObject({ state: "remind" });
    expect(errorsBesidesZone(app)).toEqual([]);
  });

  it("судья спрашивает запасную модель службы своего чата", async () => {
    const app = attachApp({ asyncPort: true, realJudge: true });
    const a = app.addService("А");
    const b = app.addService("Б");
    await app.openChat(a);
    const idB = await app.openChat(b);
    app.flow.attach({ portFor: app.portFor });
    const answer = { text: "", object: { met: [] }, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
    const askA = vi.spyOn(a.service, "askModel").mockResolvedValue(answer);
    const askB = vi.spyOn(b.service, "askModel").mockResolvedValue(answer);

    await human(app, b.service, idB, "курс про Excel, продаж нет");

    expect(askB).toHaveBeenCalledTimes(1);
    expect(askA).not.toHaveBeenCalled();
  });

  it("сигнал с пробуждением и перемотка часов ждут службу", async () => {
    const { app, a, b, idB } = await twoChats();
    const deliverA = vi.spyOn(a.service, "deliverNotices");
    const deliverB = vi.spyOn(b.service, "deliverNotices");
    await app.flow.signal({ ownerId: OWNER, chatId: idB, name: "ping", wakeAgent: true });
    expect(deliverA).not.toHaveBeenCalled();
    expect(deliverB).toHaveBeenCalledTimes(1);
  });

  it("одновременные обращения к одному чату спрашивают приложение один раз", async () => {
    const { app, idA } = await twoChats();
    app.flow.attach({ portFor: app.portFor });
    app.portFor.mockClear();
    await Promise.all([app.flow.readRun(OWNER, idA), app.flow.readRun(OWNER, idA), app.flow.readRun(OWNER, idA)]);
    expect(app.portFor).toHaveBeenCalledTimes(1);
  });

  it("пояс службы известен таймерам: тихие часы по её поясу", async () => {
    const { app, a, b, idA, idB } = await twoChats({}, { a: NOVOSIBIRSK });
    clockAt(T0 + 3 * HOUR);
    await tickAll(app, [
      { service: a.service, id: idA },
      { service: b.service, id: idB },
    ]);
    expect(await stateOfChat(a.service, idA)).toBe("intro");
    expect(await stateOfChat(b.service, idB)).toBe("remind");
    expect((await agentTexts(b.service, idB)).length).toBeGreaterThan(1);
  });

  it("portFor отказал — ошибка с номером чата, отказ не запоминается: следующее обращение спросит снова", async () => {
    const { app, idA } = await twoChats();
    app.flow.attach({ portFor: app.portFor });
    const service = app.owners.get(idA)!;
    app.owners.delete(idA);
    await expect(app.flow.readRun(OWNER, idA)).rejects.toThrow(idA);

    app.owners.set(idA, service);
    expect(await app.flow.readRun(OWNER, idA)).toMatchObject({ state: "intro" });
  });
});
