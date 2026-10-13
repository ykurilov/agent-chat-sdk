import { afterEach, describe, expect, it, vi } from "vitest";
import { calling, createGate, noticesIn, openCopy, rolesOf, saying, scriptedModel, sharedStorage } from "./support/chat-server";
import { controlledTool } from "./support/fake-port";

/** T066: фон на настоящей службе чата — от вызова инструмента до служебного сообщения и хода агента. */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(stream: NonNullable<Parameters<typeof scriptedModel>[0]>["stream"]) {
  const shared = sharedStorage();
  const report = controlledTool();
  const model = scriptedModel({ stream });
  const copy = await openCopy({ storage: shared.storage, store: shared.openStore(), model, tools: { build_report: report.definition } });
  cleanups.push(shared.close, () => copy.service.flush());
  const chatId = (await copy.service.createChat("anna")).id;
  return { copy, model, chatId, runs: report.runs };
}

const reportCall = (id: string, period: string) => ({ id, name: "build_report", input: { period } });

describe("T066: фон и служба чата", { timeout: 10_000 }, () => {
  it("вызов → «запущена» → задача готова → служебное сообщение и ход агента с итогом", async () => {
    const { copy, model, chatId, runs } = await setup([calling(reportCall("c1", "март")), saying("Запустил отчёт")]);
    await copy.ask(chatId, "u1", "Построй отчёт за март");
    const [, answer] = await copy.history(chatId);
    expect(answer!.parts.find((part) => part.type === "tool-build_report")).toMatchObject({ output: { status: "started", taskId: expect.any(String) } });
    expect(await (await copy.call("GET", `/${chatId}/tasks`)).json()).toEqual([expect.objectContaining({ name: "build_report", status: "running" })]);

    runs[0]!.resolve("Отчёт: 42 сделки");
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "notice", "assistant"]));
    const messages = await copy.history(chatId);
    expect(noticesIn(messages)).toEqual([[expect.objectContaining({ kind: "task_done", title: "Отчёт за март", result: "Отчёт: 42 сделки" })]]);
    await vi.waitFor(async () => expect((await copy.history(chatId)).at(-1)?.metadata?.status).toBe("complete"));
    expect(model.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(model.doStreamCalls[2]!.prompt)).toContain("Отчёт: 42 сделки");
    expect(await (await copy.call("GET", `/${chatId}/tasks`)).json()).toEqual([expect.objectContaining({ status: "done" })]);
  });

  it("чат занят — итог приходит после конца хода", async () => {
    const gate = createGate();
    const { copy, model, chatId, runs } = await setup([calling(reportCall("c1", "март")), saying("Запустил"), gate.after(saying("Думаю над вторым вопросом"))]);
    await copy.ask(chatId, "u1", "Построй отчёт за март");
    const second = await copy.askAndKeep(chatId, "u2", "А что с апрелем?");
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(3));

    runs[0]!.resolve("Отчёт готов");
    await vi.waitFor(async () => expect(await (await copy.call("GET", `/${chatId}/tasks`)).json()).toEqual([expect.objectContaining({ status: "done" })]));
    expect(noticesIn(await copy.history(chatId))).toEqual([]);

    gate.open();
    await second.done;
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "user", "assistant", "notice", "assistant"]));
    expect(noticesIn(await copy.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_done", result: "Отчёт готов" })]]);
  });

  it("две задачи готовы, пока чат занят, — одно служебное сообщение и один ход", async () => {
    const gate = createGate();
    const { copy, model, chatId, runs } = await setup([calling(reportCall("c1", "март"), reportCall("c2", "апрель")), gate.after(saying("Запустил оба"))]);
    const first = await copy.askAndKeep(chatId, "u1", "Отчёты за март и апрель");
    await vi.waitFor(() => expect(runs).toHaveLength(2));

    runs[0]!.resolve("март готов");
    runs[1]!.resolve("апрель готов");
    await vi.waitFor(async () =>
      expect(await (await copy.call("GET", `/${chatId}/tasks`)).json()).toEqual([expect.objectContaining({ status: "done" }), expect.objectContaining({ status: "done" })]),
    );
    gate.open();
    await first.done;
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "notice", "assistant"]));
    const [batch] = noticesIn(await copy.history(chatId));
    expect(batch!.map((notice) => notice.kind === "task_done" && notice.result).sort()).toEqual(["апрель готов", "март готов"]);
    await vi.waitFor(async () => expect((await copy.history(chatId)).at(-1)?.metadata?.status).toBe("complete"));
    expect(model.doStreamCalls).toHaveLength(3);
  });
});
