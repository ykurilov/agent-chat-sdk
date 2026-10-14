import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedFlow } from "../../src/runtime/flow-types";
import { DAY, HOUR, MIN } from "../flow-fixtures";
import { attachApp, errorsBesidesZone, human, OWNER, T0 } from "./attach-support";

// T105: чат переносится в заданное место: `loadFlow` → `stateId`, `startedAt`, `enteredAt`. Сроки таймеров считаются от
// переданных моментов, а не от первого сообщения.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const iso = (at: number) => new Date(at).toISOString();

async function pinnedChat(loaded: (json: Record<string, any>) => LoadedFlow) {
  const app = attachApp({ loaded });
  const only = app.addService("Единая");
  const id = await app.openChat(only);
  app.flow.attach(only.service);
  return { app, only, id };
}

describe("T105 перенос в заданное состояние", () => {
  it("чат закрепляется в `stateId`, первый ход не возвращает его на старт", async () => {
    const { app, only, id } = await pinnedChat((json) => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "block" }));
    await human(app, only.service, id, "доживаем разговор");

    expect(await app.store.getChat(id)).toMatchObject({ stateId: "block", flowId: "sales-review", versionId: "v1" });
    const run = await app.flow.readRun(OWNER, id);
    expect(run).toMatchObject({ state: "block" });
    expect(run?.path[0]).toMatchObject({ state: "block", from: null, decidedBy: "start" });
    expect(errorsBesidesZone(app)).toEqual([]);
  });

  it("`startedAt` и `enteredAt` ложатся в место; нет `enteredAt` — берётся `startedAt`", async () => {
    const startedAt = new Date(T0 - 2 * DAY);
    const enteredAt = new Date(T0 - 5 * HOUR);
    const first = await pinnedChat((json) => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "block", startedAt, enteredAt }));
    await human(first.app, first.only.service, first.id, "привет");
    expect(await first.app.flow.readRun(OWNER, first.id)).toMatchObject({ startedAt: startedAt.getTime(), enteredAt: enteredAt.getTime() });

    const second = await pinnedChat((json) => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "block", startedAt }));
    await human(second.app, second.only.service, second.id, "привет");
    expect(await second.app.flow.readRun(OWNER, second.id)).toMatchObject({ startedAt: startedAt.getTime(), enteredAt: startedAt.getTime() });
  });

  it("срок таймера ноды считается от `enteredAt`, а не от первого сообщения", async () => {
    // «Сомнения» уходят по таймеру через 20 мин в состоянии. Нода началась 10 минут назад — осталось 10.
    const enteredAt = new Date(T0 - 10 * MIN);
    const { app, only, id } = await pinnedChat((json) => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "doubts", enteredAt }));
    await human(app, only.service, id, "сомневаюсь");

    expect(await app.store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 10 * MIN), dueExitId: "doubts_timeout" });
  });

  it("состояния нет в сценарии — строка в журнал, чат идёт без сценария", async () => {
    const { app, only, id } = await pinnedChat((json) => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "нет-такого" }));
    await human(app, only.service, id, "привет");

    expect(await app.store.getChat(id)).toBeNull();
    expect(app.logError).toHaveBeenCalledWith(expect.stringContaining("нет-такого"));
  });

  it("без `stateId` — старт сценария, как в 0.48", async () => {
    const { app, only, id } = await pinnedChat((json) => ({ flowId: "sales-review", versionId: "v1", flow: json }));
    await human(app, only.service, id, "привет");

    expect(await app.flow.readRun(OWNER, id)).toMatchObject({ state: "intro", startedAt: T0, enteredAt: T0 });
  });
});
