import { ChatNotFoundError } from "@ykurilov/agent-chat-core";
import type { ChatEvent, TaskView } from "@ykurilov/agent-chat-core";
import { jsonSchema } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundTool } from "../src/index";
import { calling, createGate, noticesIn, openCopy, rolesOf, saying, scriptedModel, sharedStorage } from "./support/chat-server";
import type { ChatServerCopy } from "./support/chat-server";
import type { TaskStore } from "../src/types";
import { controlledTool } from "./support/fake-port";

/** `background.start`: приложение само запускает фоновую задачу в чате — без хода модели. */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Инструмент со схемой, которая проверяет вход (как zod): `period` — строка. */
const strictReport = backgroundTool({
  description: "Отчёт со строгой схемой",
  inputSchema: jsonSchema<{ period: string }>(
    { type: "object", properties: { period: { type: "string" } }, required: ["period"] },
    {
      validate: (value) =>
        typeof (value as { period?: unknown })?.period === "string"
          ? { success: true, value: value as { period: string } }
          : { success: false, error: new Error("period — строка") },
    },
  ),
  title: (input) => `Строгий отчёт за ${input.period}`,
  run: async () => "готово",
});

/** Инструмент, чьё `title(input)` пусто. */
const untitled = backgroundTool({
  description: "Без названия",
  inputSchema: jsonSchema<object>({ type: "object" }),
  title: () => "  ",
  run: async () => "готово",
});

/** Хранилище, у которого после записи новой задачи срабатывает `afterAdmit` (например, чат удаляют на другой копии). */
function withAfterAdmit(store: TaskStore, afterAdmit: () => Promise<void>): TaskStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "admitWithinLimit")
        return async (...args: Parameters<TaskStore["admitWithinLimit"]>) => {
          const admitted = await target.admitWithinLimit(...args);
          await afterAdmit();
          return admitted;
        };
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type Stream = NonNullable<Parameters<typeof scriptedModel>[0]>["stream"];

const tasksOf = async (copy: ChatServerCopy, chatId: string) => (await (await copy.call("GET", `/${chatId}/tasks`)).json()) as TaskView[];

async function setup(
  options: { stream?: Stream; maxRunningPerUser?: number; rerunAfterRestart?: boolean; afterAdmit?: (chatId: string) => Promise<void> } = {},
) {
  const shared = sharedStorage();
  cleanups.push(shared.close);
  const report = controlledTool({ ...(options.rerunAfterRestart && { rerunAfterRestart: true }) });
  let chatId = "";
  const open = async (stream?: Stream) => {
    const store = shared.openStore();
    const copy = await openCopy({
      storage: shared.storage,
      store: options.afterAdmit ? withAfterAdmit(store, () => options.afterAdmit!(chatId)) : store,
      model: scriptedModel({ ...(stream && { stream }) }),
      tools: { build_report: report.definition, strict_report: strictReport, untitled },
      ...(options.maxRunningPerUser && { maxRunningPerUser: options.maxRunningPerUser }),
    });
    cleanups.push(() => copy.service.flush());
    return copy;
  };
  const copy = await open(options.stream);
  chatId = (await copy.service.createChat("anna")).id;
  return { copy, chatId, runs: report.runs, open, storage: shared.storage };
}

describe("background.start: запуск задачи из кода приложения", { timeout: 15_000 }, () => {
  it("запуск → карточка в списке задач и живое событие → итог → служебное сообщение «запустило приложение» и ход агента", async () => {
    const { copy, chatId, runs } = await setup({ stream: [saying("Отчёт за март готов: 42 сделки")] });
    const events: ChatEvent[] = [];
    cleanups.push(async () => unsubscribe());
    const unsubscribe = copy.service.subscribeEvents((event) => events.push(event));

    const started = await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } });

    expect(started).toEqual({ status: "started", taskId: expect.any(String), title: "Отчёт за март" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tasks-changed", ownerId: "anna", chatId }));
    expect(await tasksOf(copy, chatId)).toEqual([expect.objectContaining({ id: started.status === "started" && started.taskId, name: "build_report", status: "running", title: "Отчёт за март" })]);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]!.input).toEqual({ period: "март" });
    // Модель не звалась: запуск без хода.
    expect(copy.model.doStreamCalls).toHaveLength(0);
    expect(await copy.history(chatId)).toEqual([]);

    runs[0]!.resolve("42 сделки");
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["notice", "assistant"]));
    expect(noticesIn(await copy.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_done", title: "Отчёт за март", result: "42 сделки", startedBy: "app" })]]);
    await vi.waitFor(async () => expect((await copy.history(chatId)).at(-1)?.metadata?.status).toBe("complete"));
    expect(JSON.stringify(copy.model.doStreamCalls[0]!.prompt)).toContain('Фоновая задача \\"Отчёт за март\\" (её запустило приложение, не ты) закончилась: 42 сделки');
    expect(await tasksOf(copy, chatId)).toEqual([expect.objectContaining({ status: "done" })]);
  });

  it("своё название вместо `title` инструмента; вход — после проверки схемой", async () => {
    const { copy, chatId, runs } = await setup();
    const started = await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "апрель" }, title: "Разбор загруженного видео" });
    expect(started).toMatchObject({ status: "started", title: "Разбор загруженного видео" });
    expect(await tasksOf(copy, chatId)).toEqual([expect.objectContaining({ title: "Разбор загруженного видео" })]);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
  });

  it("пустое название и пустой `title(input)` — карточка называется именем инструмента", async () => {
    const { copy, chatId } = await setup();
    expect(await copy.background.start({ ownerId: "anna", chatId, name: "untitled", input: {}, title: "   " })).toMatchObject({ status: "started", title: "untitled" });
    expect(await tasksOf(copy, chatId)).toEqual([expect.objectContaining({ title: "untitled" })]);
  });

  it("отмена с карточки: задача отменена, отметка в чате, агент не просыпается", async () => {
    const { copy, chatId, runs } = await setup();
    const started = await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } });
    const taskId = started.status === "started" ? started.taskId : "";
    await vi.waitFor(() => expect(runs).toHaveLength(1));

    expect((await copy.call("POST", `/${chatId}/tasks/${taskId}/cancel`)).status).toBe(200);
    expect(runs[0]!.context.signal.aborted).toBe(true);
    await vi.waitFor(async () => expect(noticesIn(await copy.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_canceled", startedBy: "app" })]]));
    expect(rolesOf(await copy.history(chatId))).toEqual(["notice"]);
    expect(copy.model.doStreamCalls).toHaveLength(0);
    expect(await tasksOf(copy, chatId)).toEqual([expect.objectContaining({ status: "canceled" })]);
  });

  it("предел maxRunningPerUser общий с задачами модели и между копиями сервера", async () => {
    const { copy, chatId, runs, open } = await setup({ maxRunningPerUser: 2, stream: [calling({ id: "c1", name: "build_report", input: { period: "март" } }), saying("Запустил")] });
    await copy.ask(chatId, "u1", "Отчёт за март");
    expect(await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "апрель" } })).toMatchObject({ status: "started" });

    const third = await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "май" } });
    expect(third).toEqual({ status: "too_many_tasks", message: expect.stringContaining("не больше 2") });
    const other = await open();
    expect(await other.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "май" } })).toMatchObject({ status: "too_many_tasks" });
    expect(await tasksOf(copy, chatId)).toHaveLength(2);

    await vi.waitFor(() => expect(runs).toHaveLength(2));
    runs[0]!.resolve("готово");
    await vi.waitFor(async () => expect((await tasksOf(copy, chatId)).filter((task) => task.status === "running")).toHaveLength(1));
    expect(await other.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "май" } })).toMatchObject({ status: "started" });
  });

  it("чат занят ходом: задача запускается, итог приходит после конца хода", async () => {
    const gate = createGate();
    const { copy, chatId, runs } = await setup({ stream: [gate.after(saying("Думаю")), saying("Отчёт готов")] });
    const turn = await copy.askAndKeep(chatId, "u1", "Привет");
    await vi.waitFor(() => expect(copy.model.doStreamCalls).toHaveLength(1));

    expect(await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } })).toMatchObject({ status: "started" });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    runs[0]!.resolve("42 сделки");
    await vi.waitFor(async () => expect(await tasksOf(copy, chatId)).toEqual([expect.objectContaining({ status: "done" })]));
    expect(noticesIn(await copy.history(chatId))).toEqual([]);

    gate.open();
    await turn.done;
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "notice", "assistant"]));
    expect(noticesIn(await copy.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_done", result: "42 сделки", startedBy: "app" })]]);
  });

  it("понятные отказы: нет инструмента, вход не по схеме, чужой или несуществующий чат — ничего не записано", async () => {
    const { copy, chatId, runs } = await setup();
    await expect(copy.background.start({ ownerId: "anna", chatId, name: "no_such_tool", input: {} })).rejects.toThrow(
      new TypeError("Фоновые задачи: фонового инструмента «no_such_tool» нет в настройках службы"),
    );
    await expect(copy.background.start({ ownerId: "anna", chatId, name: "strict_report", input: { period: 5 } })).rejects.toThrow(TypeError);
    await expect(copy.background.start({ ownerId: "anna", chatId, name: "strict_report", input: { period: 5 } })).rejects.toThrow(/strict_report.*не подходит под схему.*period — строка/);
    await expect(copy.background.start({ ownerId: "boris", chatId, name: "build_report", input: { period: "март" } })).rejects.toThrow(ChatNotFoundError);
    await expect(copy.background.start({ ownerId: "anna", chatId: "missing", name: "build_report", input: { period: "март" } })).rejects.toThrow(ChatNotFoundError);
    expect(await tasksOf(copy, chatId)).toEqual([]);
    expect(runs).toHaveLength(0);
  });

  it("чат удалён: задача остановлена и убрана", async () => {
    const { copy, chatId, runs } = await setup();
    await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    await copy.service.deleteChat("anna", chatId);
    expect(runs[0]!.context.signal.aborted).toBe(true);
    expect(await copy.background.listForChat("anna", chatId)).toEqual([]);
  });

  it("чат удалили на другой копии, пока задача записывалась: запуск отказан, задача остановлена и убрана", async () => {
    let deleteOnAdmit = false;
    const { copy, chatId, runs, storage } = await setup({
      afterAdmit: async (id) => {
        if (deleteOnAdmit) await storage.deleteChat(id);
      },
    });
    deleteOnAdmit = true;
    await expect(copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } })).rejects.toThrow(ChatNotFoundError);
    expect(await copy.background.listForChat("anna", chatId)).toEqual([]);
    for (const run of runs) expect(run.context.signal.aborted).toBe(true);
  });

  it("перезапуск сервера: задача приложения подхвачена новой копией, пометка «запустило приложение» сохранилась", async () => {
    const { copy, chatId, runs, open } = await setup({ rerunAfterRestart: true });
    await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    await copy.service.flush();

    const after = await open([saying("Отчёт готов")]);
    await vi.waitFor(() => expect(runs).toHaveLength(2), { timeout: 10_000 });
    expect(runs[1]!.input).toEqual({ period: "март" });
    runs[1]!.resolve("42 сделки");
    await vi.waitFor(async () => expect(noticesIn(await after.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_done", startedBy: "app" })]]), { timeout: 10_000 });
  });

  it("перезапуск сервера, инструмент без повтора: задача прервана, служебное сообщение помечено «запустило приложение»", async () => {
    const { copy, chatId, runs, open } = await setup();
    await copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    await copy.service.flush();

    const after = await open([saying("Разбор прервался")]);
    await vi.waitFor(async () => expect(noticesIn(await after.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_interrupted", startedBy: "app" })]]), { timeout: 10_000 });
    expect(runs).toHaveLength(1);
    await vi.waitFor(() => expect(after.model.doStreamCalls).toHaveLength(1));
    expect(JSON.stringify(after.model.doStreamCalls[0]!.prompt)).toContain("(её запустило приложение, не ты)");
  });

  it("служба остановлена — запуск отказан", async () => {
    const { copy, chatId } = await setup();
    await copy.service.flush();
    await expect(copy.background.start({ ownerId: "anna", chatId, name: "build_report", input: { period: "март" } })).rejects.toThrow(/остановлен/);
  });

  it("фон остановлен, а модель зовёт фоновый инструмент: ход не падает, модель видит понятную ошибку инструмента", async () => {
    const { copy, chatId, runs } = await setup({ stream: [calling({ id: "c1", name: "build_report", input: { period: "март" } }), saying("Не вышло")] });
    await copy.background.flush();
    await copy.ask(chatId, "u1", "Отчёт за март");

    const answer = (await copy.history(chatId)).at(-1)!;
    expect(answer.metadata?.status).toBe("complete");
    expect(JSON.stringify(answer.parts)).toContain("output-error");
    expect(JSON.stringify(copy.model.doStreamCalls[1]!.prompt)).toContain("Фоновые задачи остановлены");
    expect(runs).toHaveLength(0);
  });
});
