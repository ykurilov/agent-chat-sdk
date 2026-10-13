import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { AgentChatMessage, AgentToolsModel } from "@ykurilov/agent-chat-core";
import { APICallError, jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogWithModel, usage } from "./support/mock-catalog";
import { createTestChat, message } from "./support/test-chat";

const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const saying = (text: string): LanguageModelV4StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];
const callingRemove: LanguageModelV4StreamPart[] = [
  { type: "stream-start", warnings: [] },
  { type: "tool-call", toolCallId: "c1", toolName: "remove", input: JSON.stringify({ path: "a" }) },
  finish("tool-calls"),
];

type Step = LanguageModelV4StreamPart[] | "fail";

/** Модель по сценарию; инструмент `remove` с подтверждением записывает место, которое ему дали. */
function setup(steps: Step[] = []) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[call++] ?? saying("ответ");
      if (step === "fail") {
        throw new APICallError({ message: "ключ не подходит", url: "https://provider.test", requestBodyValues: {}, statusCode: 401, isRetryable: false });
      }
      return { stream: new ReadableStream({ start: (controller) => (step.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
  const toolPlaces: Array<AgentToolsModel["place"]> = [];
  const chat = createTestChat({
    catalog: catalogWithModel(model),
    agent: {
      instructions: "x",
      tools: (toolsModel) => {
        toolPlaces.push(toolsModel.place);
        return {
          remove: tool({
            description: "d",
            inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
            needsApproval: true,
            execute: async () => "удалено",
          }),
        };
      },
    },
  });
  /** Что модель увидела в хвосте последнего сообщения человека на вызове `index`; без части с сегодняшней датой. */
  const seen = (index = model.doStreamCalls.length - 1) => {
    const last = [...model.doStreamCalls[index]!.prompt].reverse().find((entry) => entry.role === "user")!;
    if (typeof last.content === "string") return last.content;
    const texts = last.content.map((part) => (part.type === "text" ? part.text : ""));
    return texts.filter((text) => !text.startsWith("Сегодня: ")).join("\n");
  };
  return { ...chat, model, toolPlaces, seen };
}

const here = { description: "Карточка клиента «ООО Ромашка», id 42", data: { customerId: 42 } };
const there = { description: "Карточка клиента «ИП Лютик», id 43" };
const tab = "tab-7";

const BAD_PLACES: Array<[string, unknown]> = [
  ["описание не строка", { description: 5 }],
  ["нет описания", { data: { a: 1 } }],
  ["место — строка", "Карточка"],
  ["место — список", ["Карточка"]],
  ["data не объект", { description: "Карточка", data: "x" }],
];
const BAD_TABS: Array<[string, unknown]> = [["пустая строка", ""], ["не строка", 7], ["длиннее 100 знаков", "x".repeat(101)]];

describe("обработчик чата: место и вкладка в теле запроса", () => {
  it("messages: модель видит место, инструмент получает его с данными", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "добавь ему заметку"), place: here, tabId: tab } });
    expect(response.status).toBe(200);
    await response.text();
    expect(chat.seen()).toContain("ООО Ромашка");
    expect(chat.toolPlaces).toEqual([here]);
    expect(JSON.stringify(await chat.history(chatId))).not.toContain("Ромашка");
  });

  it("без полей — как раньше: места нет ни у модели, ни у инструмента", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "привет") })).text();
    expect(chat.seen()).toBe("привет");
    expect(chat.toolPlaces).toEqual([null]);
  });

  it("place: null и только tabId — места нет", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    const first = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "раз"), place: null } });
    expect(first.status).toBe(200);
    await first.text();
    const second = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u2", "два"), tabId: tab } });
    expect(second.status).toBe(200);
    await second.text();
    expect(chat.toolPlaces).toEqual([null, null]);
  });

  it("слишком длинное описание — не ошибка: 200, в запросе обрезанное", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "привет"), place: { description: "д".repeat(5000) } } });
    expect(response.status).toBe(200);
    await response.text();
    expect(chat.toolPlaces[0]!.description).toHaveLength(1000);
  });

  it("edit: место из тела", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "первое") })).text();
    const response = await chat.call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u1b", "правка"), place: here, tabId: tab } });
    expect(response.status).toBe(200);
    await response.text();
    expect(chat.seen()).toContain("ООО Ромашка");
  });

  it("regenerate: место из тела", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "первое") })).text();
    const answer = (await chat.history(chatId)).messages.at(-1) as AgentChatMessage;
    const response = await chat.call("POST", `/${chatId}/regenerate`, { body: { messageId: answer.id, place: there, tabId: tab } });
    expect(response.status).toBe(200);
    await response.text();
    expect(chat.seen()).toContain("ИП Лютик");
  });

  it("retry: место из тела (и без тела — как раньше)", async () => {
    const chat = setup(["fail", saying("снова"), "fail", saying("ещё")]);
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "привет") })).text();
    const response = await chat.call("POST", `/${chatId}/retry`, { body: { place: here, tabId: tab } });
    expect(response.status).toBe(200);
    await response.text();
    expect(chat.seen()).toContain("ООО Ромашка");
    expect(chat.toolPlaces.at(-1)).toEqual(here);
  });

  it("retry без тела вообще работает", async () => {
    const chat = setup(["fail", saying("снова")]);
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "привет") })).text();
    const response = await chat.call("POST", `/${chatId}/retry`);
    expect(response.status).toBe(200);
    await response.text();
    expect(chat.toolPlaces.at(-1)).toBeNull();
  });

  it("approvals: инструменты получают место из ответа человека, модель — заметкой после результата, начало запроса прежнее", async () => {
    const chat = setup([callingRemove, saying("Готово")]);
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "удали"), place: here } })).text();
    const asked = ((await chat.history(chatId)).messages.at(-1) as AgentChatMessage).parts.find((part) => part.type === "tool-remove") as { approval: { id: string } };
    const response = await chat.call("POST", `/${chatId}/approvals/${asked.approval.id}`, { body: { decision: "allow", place: there, tabId: tab } });
    expect(response.status).toBe(200);
    await (await chat.call("GET", `/${chatId}/stream`)).text();
    expect(chat.toolPlaces).toEqual([here, there]);
    const [first, second] = chat.model.doStreamCalls.map((entry) => entry.prompt.map((message) => JSON.stringify(message)));
    expect(second!.slice(0, first!.length)).toEqual(first);
    expect(chat.seen(1)).toContain("ИП Лютик");
    expect(second!.slice(0, -1).join("")).not.toContain("ИП Лютик");
  });
});

describe("обработчик чата: неверные place и tabId — 400 invalid, ничего не записано", () => {
  it.each(BAD_PLACES)("messages: %s", async (_, place) => {
    const chat = setup();
    const chatId = await chat.createChat();
    const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "привет"), place } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect((await chat.history(chatId)).messages).toEqual([]);
    expect(chat.model.doStreamCalls).toHaveLength(0);
  });

  it.each(BAD_TABS)("messages: tabId — %s", async (_, tabId) => {
    const chat = setup();
    const chatId = await chat.createChat();
    const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "привет"), tabId } });
    expect(response.status).toBe(400);
    expect((await chat.history(chatId)).messages).toEqual([]);
  });

  it("edit: прежняя ветка не тронута", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "первое") })).text();
    const before = (await chat.history(chatId)).messages.length;
    const response = await chat.call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u1b", "правка"), place: { description: 1 } } });
    expect(response.status).toBe(400);
    expect((await chat.history(chatId)).messages).toHaveLength(before);
    expect((await chat.call("POST", `/${chatId}/edit`, { body: { editedMessageId: "u1", ...message("u1b", "правка"), tabId: "" } })).status).toBe(400);
  });

  it("regenerate и retry: 400, новых ответов нет", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "первое") })).text();
    const answer = (await chat.history(chatId)).messages.at(-1) as AgentChatMessage;
    const calls = chat.model.doStreamCalls.length;
    expect((await chat.call("POST", `/${chatId}/regenerate`, { body: { messageId: answer.id, place: "x" } })).status).toBe(400);
    expect((await chat.call("POST", `/${chatId}/regenerate`, { body: { messageId: answer.id, tabId: 5 } })).status).toBe(400);
    expect((await chat.call("POST", `/${chatId}/retry`, { body: { place: { description: null } } })).status).toBe(400);
    expect((await chat.call("POST", `/${chatId}/retry`, { body: { tabId: "x".repeat(101) } })).status).toBe(400);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect((await chat.history(chatId)).messages).toHaveLength(2);
  });

  it("approvals: запрос подтверждения остаётся ждать, ход не продолжается", async () => {
    const chat = setup([callingRemove, saying("Готово")]);
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "удали") })).text();
    const asked = ((await chat.history(chatId)).messages.at(-1) as AgentChatMessage).parts.find((part) => part.type === "tool-remove") as { approval: { id: string } };
    const url = `/${chatId}/approvals/${asked.approval.id}`;
    expect((await chat.call("POST", url, { body: { decision: "allow", place: { description: 7 } } })).status).toBe(400);
    expect((await chat.call("POST", url, { body: { decision: "allow", tabId: "" } })).status).toBe(400);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    const ok = await chat.call("POST", url, { body: { decision: "allow" } });
    expect(await ok.json()).toEqual({ resumed: true });
  });
});

describe("обработчик чата: часовой пояс человека в теле запроса", () => {
  const serverZone = process.env.TZ;
  beforeEach(() => {
    // Сервер в UTC.
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (serverZone === undefined) delete process.env.TZ;
    else process.env.TZ = serverZone;
  });
  /** Дата, которую модель увидела в хвосте запроса. */
  const dateSeen = (chat: ReturnType<typeof setup>) => JSON.stringify(chat.model.doStreamCalls.at(-1)!.prompt).match(/Сегодня: [^"]+/)?.[0];

  it("messages: дата в запросе — по поясу человека", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 2, 19, 0)));
    const chat = setup();
    const chatId = await chat.createChat();
    const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "какое число?"), timeZone: "Asia/Shanghai" } });
    expect(response.status).toBe(200);
    await response.text();
    expect(dateSeen(chat)).toBe("Сегодня: суббота, 3 октября 2026 г.");
  });

  it("не пояс — не ошибка: 200, дата по поясу сервера", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 2, 19, 0)));
    const chat = setup();
    const chatId = await chat.createChat();
    for (const [index, timeZone] of [42, "Mars/Olympus"].entries()) {
      const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message(`u${index}`, "какое число?"), timeZone } });
      expect(response.status).toBe(200);
      await response.text();
      expect(dateSeen(chat)).toBe("Сегодня: пятница, 2 октября 2026 г.");
    }
  });
});
