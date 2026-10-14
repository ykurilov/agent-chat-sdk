import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, userMessage } from "../../../core/tests/unit/support/notice-chat";
import { readAll } from "../../../core/tests/unit/support/mock-model";
import type { FlowRuntime } from "../../src/runtime/flow-events";
import { attachApp, OWNER, T0 } from "./attach-support";

// T106: `settled()` ждёт всю фоновую работу сценария: судью, `onTransition`, доставку и `onFinish` частей других этапов.
// Эти части получают `runtime.track` и сдают в него свою работу.

const captured = vi.hoisted(() => ({ runtime: null as FlowRuntime | null }));

vi.mock("../../src/runtime/flow-delivery", () => ({
  createFlowDelivery: ({ runtime }: { runtime: FlowRuntime }) => {
    captured.runtime = runtime;
    return { own: () => false, send: async () => ({ status: "delivered" }), report: async () => {} };
  },
}));

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) }));
afterEach(() => vi.useRealTimers());

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** Ждёт ли промис: за один круг очереди событий он не завершился. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("ждёт");
  return (await Promise.race([promise.then(() => "готово"), new Promise((resolve) => setImmediate(() => resolve(marker)))])) === marker;
}

async function started(setup: Parameters<typeof attachApp>[0] = {}, scripts: Parameters<ReturnType<typeof attachApp>["addService"]>[1] = {}) {
  const app = attachApp(setup);
  const service = app.addService("Единая", scripts);
  const id = await app.openChat(service);
  app.flow.attach(service.service);
  return { app, service, id };
}

describe("T106 settled()", () => {
  it("ждёт медленный onTransition", async () => {
    const slow = deferred();
    const { app, service, id } = await started(
      { yes: ["intro_clear"], options: { onTransition: () => slow.promise } },
      { scripts: [callTool("flow_exit", "x1", { exit: 1, why: "всё рассказал" })] },
    );
    // Не `human`: он сам ждёт `settled()`, а `onTransition` ещё не отпущен.
    await readAll(await service.service.sendMessage(OWNER, id, userMessage("s1", "курс про Excel")));

    const waiting = app.flow.settled();
    expect(await isPending(waiting)).toBe(true);
    slow.release();
    await waiting;
  });

  it("ждёт работу, которую части сценария сдали в runtime.track", async () => {
    const { app, id } = await started();
    // Часть доставки создаётся при первом обращении: заставляем сценарий её собрать.
    await app.flow.reportDelivery({ chatId: id, messageId: "m1", outcome: { status: "delivered" } });
    expect(captured.runtime).not.toBeNull();

    const slow = deferred();
    captured.runtime!.track?.(slow.promise);
    const waiting = app.flow.settled();
    expect(await isPending(waiting)).toBe(true);
    slow.release();
    await waiting;
  });

  it("упавшая фоновая работа не роняет settled(): строка в журнал", async () => {
    const { app, id } = await started();
    await app.flow.reportDelivery({ chatId: id, messageId: "m1", outcome: { status: "delivered" } });

    captured.runtime!.track?.(Promise.reject(new Error("доставка упала")));
    await expect(app.flow.settled()).resolves.toBeUndefined();
    expect(app.logError).toHaveBeenCalledWith(expect.stringContaining("доставка упала"));
  });
});
