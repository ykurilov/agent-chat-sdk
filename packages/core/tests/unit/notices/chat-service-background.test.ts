import { tool } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentViewerInput } from "../../../src/agent-run/agent-viewer";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import type { BackgroundPort, BackgroundTasks } from "../../../src/background/background-tasks";
import { researchHelper } from "../support/helper-fixtures";
import { readAll } from "../support/mock-model";
import { askInNewChat, doneNotice, noticeService, scriptedModel, toolNamesOf, waitTurn } from "../support/notice-chat";

const simple = (description: string) => tool({ description, inputSchema: z.object({}), execute: async () => description });

/** Фон-заглушка: запоминает порт и модели инструментов. */
function fakeBackground(names: readonly string[] = ["check_tasks", "cancel_task"]) {
  const port: { current?: BackgroundPort } = {};
  const models: AgentToolsModel[] = [];
  const background: BackgroundTasks = {
    instructions: "ФОН: долгие задачи запускай в фоне.",
    toolNames: names,
    tools: (model) => {
      models.push(model);
      return Object.fromEntries(names.map((name) => [name, simple(name)])) as ToolSet;
    },
    attach: vi.fn((given: BackgroundPort) => {
      port.current = given;
    }),
    listForChat: vi.fn(async () => []),
    cancel: vi.fn(async () => "not_found" as const),
    answerApproval: vi.fn(async () => "not_found" as const),
    chatDeleted: vi.fn(async () => {}),
    recover: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
  return { background, port, models };
}

describe("T046: подключение фона", () => {
  it("инструкция фона — в системной, инструменты фона — в запросе; модель инструментов фона знает канал и id ответа", async () => {
    const model = scriptedModel();
    const { background, models } = fakeBackground();
    const { service } = noticeService(model, { background, agent: { tools: { find: simple("Найти") } } });
    const chat = await askInNewChat(service, "привет", { channel: "vk" });
    const system = model.doStreamCalls[0]!.prompt.find((message) => message.role === "system");
    expect(JSON.stringify(system)).toContain("ФОН: долгие задачи запускай в фоне.");
    expect(toolNamesOf(model.doStreamCalls[0]!)).toEqual(["cancel_task", "check_tasks", "find"]);
    const answer = (await service.getHistory("anna", chat.id)).messages[1]!;
    expect(models[0]).toMatchObject({ channel: "vk", messageId: answer.id, chatId: chat.id, ownerId: "anna" });
  });

  it("совпадение имени инструмента фона с инструментом приложения — ошибка при создании службы", () => {
    const { background } = fakeBackground(["find"]);
    expect(() => noticeService(scriptedModel(), { background, agent: { tools: { find: simple("Найти") } } })).toThrow(/find/);
  });

  it("attach один раз: порт доставляет сообщения, отдаёт события, фоновых помощников и их модель", async () => {
    const model = scriptedModel();
    const { background, port } = fakeBackground();
    const { service } = noticeService(model, {
      background,
      agent: { helpers: { research: researchHelper({ background: true }), notes: researchHelper() } },
    });
    expect(background.attach).toHaveBeenCalledTimes(1);
    const given = port.current!;
    expect(Object.keys(given.helpers ?? {})).toEqual(["research"]);
    const seen: string[] = [];
    given.events.subscribe((event) => seen.push(event.type));
    const chat = await askInNewChat(service);
    expect(await given.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "ок")], wakeAgent: true, deliveryKey: "k" })).toMatchObject({
      status: "delivered",
      turnStarted: true,
    });
    await waitTurn(service, chat.id);
    expect(seen).toContain("turn-started");
    const helperModel = await given.helperModel("research", "anna", chat.id);
    expect(helperModel).toMatchObject({ ownerId: "anna", chatId: chat.id, channel: "web", audience: "private" });
    expect("subject" in helperModel).toBe(false);
    await expect(given.assertWithinLimit("anna", chat.id)).resolves.toBeUndefined();
    expect(typeof given.runHelper).toBe("function");
  });

  it("модель фонового помощника в групповом чате: audience «group» и канал — у viewer и у инструментов", async () => {
    const { background, port } = fakeBackground();
    const viewer = vi.fn(async (_input: AgentViewerInput) => ({ isAdmin: true }));
    const { service } = noticeService(scriptedModel(), { background, agent: { viewer, helpers: { research: researchHelper({ background: true }) } } });
    const chat = await askInNewChat(service, "всем привет", { channel: "telegram", group: { allowedTools: [], author: "Борис" } });
    viewer.mockClear();
    const helperModel = await port.current!.helperModel("research", "anna", chat.id);
    expect(helperModel).toMatchObject({ audience: "group", channel: "telegram", viewer: { isAdmin: true } });
    expect(viewer).toHaveBeenCalledTimes(1);
    expect(viewer.mock.calls[0]![0]).toMatchObject({ audience: "group", channel: "telegram" });
  });

  it("модель фонового помощника в чате объекта знает ключ и данные объекта", async () => {
    const { background, port } = fakeBackground();
    const { service } = noticeService(scriptedModel(), { background, agent: { helpers: { research: researchHelper({ background: true }) } } });
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:7", data: { lessonId: 7 } });
    const helperModel = await port.current!.helperModel("research", "anna", chat.id);
    expect(helperModel.subject).toEqual({ key: "lesson:7", data: { lessonId: 7 } });
  });

  it("удаление чата, восстановление и сброс зовут фон", async () => {
    const { background } = fakeBackground();
    const { service } = noticeService(scriptedModel(), { background });
    const chat = await askInNewChat(service);
    await service.deleteChat("anna", chat.id);
    expect(background.chatDeleted).toHaveBeenCalledWith("anna", chat.id);
    await service.recoverInterruptedAnswers();
    expect(background.recover).toHaveBeenCalledTimes(1);
    await service.flush();
    expect(background.flush).toHaveBeenCalledTimes(1);
  });

  it("без фона инструментов фона нет", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "привет" }] }));
    expect(toolNamesOf(model.doStreamCalls[0]!)).toEqual([]);
  });
});
