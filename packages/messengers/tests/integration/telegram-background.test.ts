import type { BackgroundToolDefinition } from "@ykurilov/agent-chat-background";
import { jsonSchema, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { messengerTexts } from "../../src/messenger-texts";
import { anna } from "../fake-apis/rig";
import { telegramChannel } from "./support/channels";
import { type RealChat, startRealChat, WEB_CHAT_URL } from "./support/real-chat";

const annaChat = { id: anna.id, type: "private" as const };

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** Фоновый «отчёт»: заканчивается, когда тест скажет, а не по паузе. */
function reportTool() {
  let finish: (result: string) => void = () => {};
  const done = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const report: BackgroundToolDefinition<{ topic: string }, string> = {
    description: "Долгий отчёт",
    inputSchema: jsonSchema<{ topic: string }>({ type: "object", properties: { topic: { type: "string" } } }),
    title: ({ topic }) => `Отчёт: ${topic}`,
    run: () => done,
  };
  return { report: report as BackgroundToolDefinition, finish: (result: string) => finish(result) };
}

async function backgroundChat(tools: Record<string, BackgroundToolDefinition>, server: Parameters<typeof startRealChat>[0]["server"] = {}) {
  const real = await startRealChat({ channel: await telegramChannel(), background: { tools }, server });
  await real.link(anna, "anna");
  return real;
}

const say = (real: RealChat, text: string) => real.human({ type: "text", chat: annaChat, from: anna, text });
const annaTexts = (real: RealChat) => real.textsIn(annaChat.id);

describe("T076 результат фона в мессенджер", () => {
  it("задача из мессенджера закончилась — агент реагирует, ответ приходит в тот же чат мессенджера", async () => {
    const { report, finish } = reportTool();
    chat = await backgroundChat({ report });
    chat.model.script({ tool: { name: "report", input: { topic: "сделки" } } }, { text: "Запустил отчёт." });
    await say(chat, "Сделай отчёт по сделкам");
    expect(annaTexts(chat).at(-1)).toBe("Запустил отчёт.");

    chat.model.script({ text: "Отчёт готов: 12 сделок." });
    finish("12 сделок за неделю");
    await chat.until(() => annaTexts(chat as RealChat).at(-1) === "Отчёт готов: 12 сделок.", "ответ на итог задачи");
    expect(chat.model.lastPromptText()).toContain("12 сделок за неделю");
    expect(chat.errors).toEqual([]);
  });

  it("помощнику в задаче нужно разрешение — карточка кнопками; «Разрешить» продолжает задачу, итог приходит в чат", async () => {
    const removed: string[] = [];
    const remove = tool({
      description: "Удалить файл",
      inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } } }),
      needsApproval: true,
      execute: async ({ path }) => {
        removed.push(path);
        return "удалено";
      },
    });
    chat = await backgroundChat(
      {},
      {
        agent: {
          instructions: "Ты помощник.",
          helpers: {
            cleaner: { description: "Уборка файлов", instructions: "Ты уборщик файлов.", model: { modelId: "mock-model", providerId: "mock" }, tools: { remove }, background: true },
          },
        },
      },
    );
    chat.model.scriptWhen("Ты уборщик файлов.", { tool: { name: "remove", input: { path: "/tmp/a.txt" } } }, { text: "Удалил /tmp/a.txt." });
    chat.model.script({ tool: { name: "helper_cleaner", input: { task: "Убери /tmp/a.txt" } } }, { text: "Поручил уборку." });
    await say(chat, "Убери /tmp/a.txt");

    const isCard = (message: RealChat["channel"]["outgoing"][number]) => message.text === messengerTexts.taskApprovalQuestion("Убери /tmp/a.txt", "remove");
    await chat.until(() => (chat as RealChat).channel.outgoing.some(isCard), "карточка паузы");
    const card = chat.channel.outgoing.find(isCard);
    expect(card?.buttons.flat().map((button) => button.text)).toEqual([messengerTexts.allow, messengerTexts.deny]);
    expect(removed).toEqual([]);

    chat.model.script({ text: "Уборка закончена." });
    const allow = card?.buttons.flat()[0];
    await chat.human({ type: "press", chat: annaChat, from: anna, data: allow?.data as string, messageId: card?.messageId as string });
    await chat.until(() => annaTexts(chat as RealChat).at(-1) === "Уборка закончена.", "ответ после задачи");
    expect(removed).toEqual(["/tmp/a.txt"]);
    // Карточка одна, хотя задача менялась много раз.
    expect(chat.channel.outgoing.filter(isCard)).toHaveLength(1);
    expect(chat.errors).toEqual([]);
  });
});

describe("отмена фоновой задачи из мессенджера", () => {
  it("задача идёт — карточка «Отменить задачу»; нажатие отменяет задачу, отчёт не приходит", async () => {
    const { report } = reportTool();
    chat = await backgroundChat({ report });
    chat.model.script({ tool: { name: "report", input: { topic: "сделки" } } }, { text: "Запустил отчёт." });
    await say(chat, "Сделай отчёт по сделкам");

    const isCard = (message: RealChat["channel"]["outgoing"][number]) => message.text === messengerTexts.taskRunning("Отчёт: сделки");
    await chat.until(() => (chat as RealChat).channel.outgoing.some(isCard), "карточка отмены");
    const card = chat.channel.outgoing.find(isCard);
    const cancel = card?.buttons.flat()[0];
    expect(cancel?.text).toBe(messengerTexts.cancelTask);

    await chat.human({ type: "press", chat: annaChat, from: anna, data: cancel?.data as string, messageId: card?.messageId as string });
    expect(chat.channel.answers.at(-1)?.text).toBe(messengerTexts.taskCanceled);
    const [task] = await (chat.service.tasks?.list?.("anna", (await chat.store.listConversationsOfUser("anna"))[0]?.currentChatId as string) ?? []);
    expect(task?.status).toBe("canceled");
    // Карточка одна, хотя задача менялась.
    expect(chat.channel.outgoing.filter(isCard)).toHaveLength(1);
    expect(chat.errors).toEqual([]);
  });
});

describe("T077 «Задача готова» на настоящем сервере", () => {
  async function taskFromWeb(real: RealChat) {
    const created = await real.service.createChat("anna");
    real.model.script({ tool: { name: "report", input: { topic: "склад" } } }, { text: "Запустил." });
    const stream = await real.service.sendMessage("anna", created.id, { id: "m1", role: "user", parts: [{ type: "text", text: "Отчёт по складу" }] });
    for (const reader = stream.getReader(); !(await reader.read()).done; );
    await real.settle();
    return created.id;
  }

  it("задача из веба, вкладка закрыта — «Задача готова» с кнопкой «Открыть чат»", async () => {
    const { report, finish } = reportTool();
    chat = await backgroundChat({ report });
    const chatId = await taskFromWeb(chat);
    finish("готово");
    await chat.until(() => annaTexts(chat as RealChat).length > 0, "сообщение в мессенджер");
    expect(annaTexts(chat)).toEqual([messengerTexts.taskReady("Отчёт: склад")]);
    expect(chat.channel.outgoing[0]?.buttons.flat()).toEqual([expect.objectContaining({ text: messengerTexts.openChat, url: `${WEB_CHAT_URL}/${chatId}` })]);
  });

  it("вкладка открыта — в мессенджер ничего", async () => {
    const { report, finish } = reportTool();
    chat = await backgroundChat({ report });
    const chatId = await taskFromWeb(chat);
    const watch = await chat.web("GET", `/${chatId}/watch`);
    expect(watch.status).toBe(200);
    const answers = chat.model.calls.length;
    finish("готово");
    await chat.until(() => (chat as RealChat).model.calls.length > answers, "ход после задачи");
    await chat.settle();
    expect(annaTexts(chat)).toEqual([]);
    await watch.body?.cancel();
  });
});

describe("готовый ответ на служебное сообщение (deliverNotices с reply)", () => {
  it("ответ без модели приходит в чат мессенджера", async () => {
    chat = await backgroundChat({});
    chat.model.script({ text: "Привет!" });
    await say(chat, "Привет");
    const [current] = await chat.service.listChats("anna");
    const calls = chat.model.calls.length;
    await chat.service.deliverNotices({
      ownerId: "anna",
      chatId: current!.id,
      notices: [{ kind: "app", name: "flow_timer", title: "Прошло два дня" }],
      wakeAgent: true,
      deliveryKey: "timer-1",
      reply: { text: "Как успехи с привычкой?" },
    });
    await chat.until(() => annaTexts(chat as RealChat).at(-1) === "Как успехи с привычкой?", "готовый ответ");
    expect(chat.model.calls.length).toBe(calls);
    expect(chat.errors).toEqual([]);
  });
});
