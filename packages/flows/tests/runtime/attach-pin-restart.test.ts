import type { Chat, ChatInstructionsTurn } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryFlowStore } from "../../src/store/memory";
import { DAY, HOUR, MIN } from "../flow-fixtures";
import { attachApp, human, OWNER, T0 } from "./attach-support";

// Чат перенесли в заданное место, сервер перезапустился до первого хода: место и сроки не потерялись.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const iso = (at: number) => new Date(at).toISOString();

describe("перенос чата переживает перезапуск сервера", () => {
  const startedAt = new Date(T0 - 2 * DAY);
  const enteredAt = new Date(T0 - 10 * MIN);
  const loaded = (json: Record<string, any>) => ({ flowId: "sales-review", versionId: "v1", flow: json, stateId: "doubts", startedAt, enteredAt });

  /** Первый процесс закрепил чат (`chatInstructions` перед ходом), но ход до записи места не дошёл. */
  async function pinnedThenRestarted() {
    const store = memoryFlowStore();
    const before = attachApp({ store, loaded });
    const service = before.addService("Единая");
    const chat = await service.service.createChat(OWNER);
    const id = chat.id;
    before.flow.attach(service.service);
    const options = before.flow.withChat({ agent: { instructions: "x" }, chatInstructions: async (_chat: Chat, _turn?: ChatInstructionsTurn) => null });
    await options.chatInstructions!(chat, { audience: "private" });
    expect(await store.getChat(id)).toMatchObject({ stateId: "doubts" });

    // Новый процесс: те же хранилище и чат, память пуста.
    const after = attachApp({ store, loaded });
    const reborn = after.addService("Единая", { storage: service.storage });
    after.owners.set(id, reborn);
    after.flow.attach(reborn.service);
    return { store, after, reborn, id };
  }

  it("запись чата хранит startedAt и enteredAt", async () => {
    const { store, id } = await pinnedThenRestarted();
    expect(await store.getChat(id)).toMatchObject({ placement: { startedAt: iso(startedAt.getTime()), enteredAt: iso(enteredAt.getTime()) } });
  });

  it("первый ход после перезапуска кладёт в заданное место, срок таймера — от enteredAt", async () => {
    const { store, after, reborn, id } = await pinnedThenRestarted();
    // Служба нового процесса не знает чата из прошлого: тот же чат в её журнале.
    await human(after, reborn.service, id, "сомневаюсь");

    expect(await after.flow.readRun(OWNER, id)).toMatchObject({ state: "doubts", startedAt: startedAt.getTime(), enteredAt: enteredAt.getTime() });
    expect(await store.getChat(id)).toMatchObject({ dueAt: iso(T0 + 10 * MIN), dueExitId: "doubts_timeout" });
  });

  it("после первого хода место снято с записи: дальше правда в состоянии чата", async () => {
    const { store, after, reborn, id } = await pinnedThenRestarted();
    await human(after, reborn.service, id, "сомневаюсь");
    expect((await store.getChat(id))?.placement).toBeNull();
    expect(HOUR).toBeGreaterThan(0);
  });
});
