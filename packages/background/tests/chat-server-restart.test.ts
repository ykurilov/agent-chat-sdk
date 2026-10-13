import type { AgentHelper } from "@ykurilov/agent-chat-core";
import { jsonSchema, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskView } from "@ykurilov/agent-chat-core";
import { calling, helperCalls, helperHangs, helperText, noticesIn, openCopy, rolesOf, saying, scriptedModel, sharedStorage } from "./support/chat-server";
import type { ChatServerCopy } from "./support/chat-server";
import { controlledTool } from "./support/fake-port";

/** T067, T068: фон на настоящей службе — перезапуск, удаление чата, отмена и подтверждение через адреса сервера. */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const researcher = (extra: Partial<AgentHelper> = {}): AgentHelper => ({
  description: "Ищет сведения и пишет коротко",
  instructions: "Ты исследователь.",
  model: { modelId: "mock-model", providerId: "mock" },
  background: true,
  ...extra,
});

const tasksOf = async (copy: ChatServerCopy, chatId: string) => (await (await copy.call("GET", `/${chatId}/tasks`)).json()) as TaskView[];

function storageWithCleanup() {
  const shared = sharedStorage();
  cleanups.push(shared.close);
  return shared;
}

async function opened(copy: Promise<ChatServerCopy>) {
  const ready = await copy;
  cleanups.push(() => ready.service.flush());
  return ready;
}

describe("T067: перезапуск, удаление чата, отмена через адрес", { timeout: 15_000 }, () => {
  it("новый экземпляр службы на той же базе: фоновый помощник продолжает, обычный инструмент — «прервана»", async () => {
    const shared = storageWithCleanup();
    const report = controlledTool();
    const before = await opened(
      openCopy({
        storage: shared.storage,
        store: shared.openStore(),
        model: scriptedModel({
          stream: [calling({ id: "c1", name: "build_report", input: { period: "март" } }, { id: "h1", name: "helper_researcher", input: { task: "Найди цены" } }), saying("Запустил")],
          generate: [helperHangs],
        }),
        tools: { build_report: report.definition },
        helpers: { researcher: researcher() },
      }),
    );
    const chatId = (await before.service.createChat("anna")).id;
    await before.ask(chatId, "u1", "Отчёт и цены");
    await vi.waitFor(() => expect(before.model.doGenerateCalls).toHaveLength(1));
    expect((await tasksOf(before, chatId)).map((task) => task.status)).toEqual(["running", "running"]);
    await before.service.flush();

    const after = await opened(
      openCopy({
        storage: shared.storage,
        store: shared.openStore(),
        model: scriptedModel({ generate: [helperText("Цены: 100 ₽")] }),
        tools: { build_report: controlledTool().definition },
        helpers: { researcher: researcher() },
      }),
    );
    await vi.waitFor(async () => expect(noticesIn(await after.history(chatId)).flat()).toHaveLength(2), { timeout: 10_000 });
    const byName = Object.fromEntries((await tasksOf(after, chatId)).map((task) => [task.name, task.status]));
    expect(byName).toEqual({ build_report: "interrupted", researcher: "done" });
    expect(noticesIn(await after.history(chatId)).flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "task_interrupted", title: "Отчёт за март" }),
        expect.objectContaining({ kind: "task_done", result: "Цены: 100 ₽" }),
      ]),
    );
    // Помощник продолжил с сохранённым заданием — второй запрос уже у новой службы.
    expect(JSON.stringify(after.model.doGenerateCalls[0]!.prompt)).toContain("Найди цены");
  });

  it("удаление чата отменяет его задачи: работа остановлена, записи задач стёрты вместе с чатом", async () => {
    const shared = storageWithCleanup();
    const report = controlledTool();
    const copy = await opened(
      openCopy({
        storage: shared.storage,
        store: shared.openStore(),
        model: scriptedModel({ stream: [calling({ id: "c1", name: "build_report", input: { period: "март" } }), saying("Запустил")] }),
        tools: { build_report: report.definition },
      }),
    );
    const chatId = (await copy.service.createChat("anna")).id;
    await copy.ask(chatId, "u1", "Отчёт");
    const [task] = await tasksOf(copy, chatId);

    expect((await copy.call("DELETE", `/${chatId}`)).status).toBe(204);
    expect(report.runs[0]!.context.signal.aborted).toBe(true);
    const store = shared.openStore();
    expect(await store.get("anna", task!.id)).toBeNull();
    expect(copy.errors).toEqual([]);
  });

  it("отмена через адрес: пометка «отменена» в чате, работа остановлена, агент не просыпается", async () => {
    const shared = storageWithCleanup();
    const report = controlledTool();
    const copy = await opened(
      openCopy({
        storage: shared.storage,
        store: shared.openStore(),
        model: scriptedModel({ stream: [calling({ id: "c1", name: "build_report", input: { period: "март" } }), saying("Запустил")] }),
        tools: { build_report: report.definition },
      }),
    );
    const chatId = (await copy.service.createChat("anna")).id;
    await copy.ask(chatId, "u1", "Отчёт");
    const [task] = await tasksOf(copy, chatId);

    const response = await copy.call("POST", `/${chatId}/tasks/${task!.id}/cancel`);
    expect(await response.json()).toEqual({ status: "canceled" });
    expect(report.runs[0]!.context.signal.aborted).toBe(true);
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "notice"]));
    expect(noticesIn(await copy.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_canceled", taskId: task!.id })]]);
    expect(copy.model.doStreamCalls).toHaveLength(2);
    expect((await copy.call("POST", `/${chatId}/tasks/${task!.id}/cancel`)).status).toBe(200);
    expect((await copy.call("POST", `/${chatId}/tasks/нет-такой/cancel`)).status).toBe(404);
  });
});

describe("T068: пауза фонового помощника через адреса", { timeout: 10_000 }, () => {
  it("карточка подтверждения → POST …/approval → помощник продолжает, итог доставлен и будит агента", async () => {
    const shared = storageWithCleanup();
    const sendEmail = vi.fn(async ({ to }: { to: string }) => `письмо ушло ${to}`);
    const send_email = tool({
      description: "Отправить письмо",
      title: "Отправить письмо",
      inputSchema: jsonSchema<{ to: string }>({ type: "object", properties: { to: { type: "string" } }, required: ["to"] }),
      needsApproval: true,
      execute: sendEmail,
    });
    const copy = await opened(
      openCopy({
        storage: shared.storage,
        store: shared.openStore(),
        model: scriptedModel({
          stream: [calling({ id: "h1", name: "helper_researcher", input: { task: "Напиши Пете" } }), saying("Поручил помощнику")],
          generate: [helperCalls("e1", "send_email", { to: "petya@example.com" }), helperText("Письмо Пете отправлено")],
        }),
        helpers: { researcher: researcher({ tools: { send_email } }) },
      }),
    );
    const chatId = (await copy.service.createChat("anna")).id;
    await copy.ask(chatId, "u1", "Напиши Пете");

    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "notice"]));
    const card = noticesIn(await copy.history(chatId))[0]![0]!;
    expect(card).toMatchObject({ kind: "task_awaiting_approval", approval: { toolName: "send_email" } });
    expect(sendEmail).not.toHaveBeenCalled();
    // Карточка не будит агента: решать человеку.
    expect(copy.model.doStreamCalls).toHaveLength(2);
    expect((await tasksOf(copy, chatId)).map((task) => task.status)).toEqual(["awaiting_approval"]);

    const approvalId = card.approval!.approvalId;
    // Без номера вопроса ответ не принимается; ответ на чужой вопрос — не одобрение.
    expect((await copy.call("POST", `/${chatId}/tasks/${card.taskId!}/approval`, { decision: "allow" })).status).toBe(400);
    const stale = await copy.call("POST", `/${chatId}/tasks/${card.taskId!}/approval`, { decision: "allow", approvalId: "старый-вопрос" });
    expect([stale.status, await stale.json()]).toEqual([409, { error: { kind: "approval_stale" } }]);
    expect(sendEmail).not.toHaveBeenCalled();
    const answer = await copy.call("POST", `/${chatId}/tasks/${card.taskId!}/approval`, { decision: "allow", approvalId });
    expect(await answer.json()).toEqual({ status: "resumed" });
    await vi.waitFor(async () => expect(rolesOf(await copy.history(chatId))).toEqual(["user", "assistant", "notice", "notice", "assistant"]));
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(noticesIn(await copy.history(chatId))[1]).toEqual([expect.objectContaining({ kind: "task_done", result: "Письмо Пете отправлено" })]);
    expect((await copy.call("POST", `/${chatId}/tasks/${card.taskId!}/approval`, { decision: "allow", approvalId })).status).toBe(409);
  });
});
