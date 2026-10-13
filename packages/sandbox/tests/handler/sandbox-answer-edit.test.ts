import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import type { AnswerEditResponse, SandboxHistoryExtras } from "../../src/index";
import { appInstructions, setupSandbox } from "./support/sandbox-setup";

type History = SandboxHistoryExtras & { messages: Array<{ id: string; role: string; parts: Array<{ type: string; text?: string }> }> };

const lookup = tool({
  description: "Найти значение.",
  inputSchema: jsonSchema({ type: "object", properties: {} }),
  execute: async () => ({ value: 1 }),
});

/** Песочный чат с ответом «найдено» после вызова `lookup` (call-1). */
async function chatWithAnswer() {
  const setup = setupSandbox({
    steps: [{ toolCall: { id: "call-1", name: "lookup", input: {} } }, { text: "найдено" }],
    chat: { agent: { instructions: appInstructions, tools: { lookup } } },
  });
  const chatId = await setup.createChat();
  await setup.send(chatId);
  const history = (await (await setup.call("GET", `/${chatId}`)).json()) as History;
  const answer = history.messages.find((message) => message.role === "assistant")!;
  return { setup, chatId, answerId: answer.id };
}

const editPath = (chatId: string, messageId: string) => `/chats/${chatId}/messages/${messageId}/answer-edit`;

describe("правка ответа агента (T037)", () => {
  it("новый текст и результат инструмента → новый ответ, отметки в журнале и в истории", async () => {
    const { setup, chatId, answerId } = await chatWithAnswer();
    const response = await setup.call("POST", editPath(chatId, answerId), { body: { text: "найдено 2", toolOutputs: { "call-1": { value: 2 } } } });
    expect(response.status).toBe(200);
    const edited = (await response.json()) as AnswerEditResponse;
    expect(edited.messageId).not.toBe(answerId);
    expect(edited.mark).toEqual({ textEdited: true, editedToolCallIds: ["call-1"] });
    expect(await setup.journal.listEditedAnswers(chatId)).toEqual([
      expect.objectContaining({ messageId: edited.messageId, sourceMessageId: answerId, chatId, editedBy: "anna", textEdited: true, editedToolCallIds: ["call-1"] }),
    ]);

    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as History;
    expect(history.messages.at(-1)!.id).toBe(edited.messageId);
    expect(history.answerEdits).toEqual({ [edited.messageId]: { textEdited: true, editedToolCallIds: ["call-1"] } });
  });

  it("только текст: editedToolCallIds пуст; тот же результат инструмента правкой не считается", async () => {
    const { setup, chatId, answerId } = await chatWithAnswer();
    const response = await setup.call("POST", editPath(chatId, answerId), { body: { text: "другое", toolOutputs: { "call-1": { value: 1 } } } });
    expect(((await response.json()) as AnswerEditResponse).mark).toEqual({ textEdited: true, editedToolCallIds: [] });
  });

  it("правка уже правленого ответа сохраняет прежние отметки", async () => {
    const { setup, chatId, answerId } = await chatWithAnswer();
    const first = (await (await setup.call("POST", editPath(chatId, answerId), { body: { text: "найдено", toolOutputs: { "call-1": { value: 2 } } } })).json()) as AnswerEditResponse;
    expect(first.mark).toEqual({ textEdited: false, editedToolCallIds: ["call-1"] });
    const second = (await (await setup.call("POST", editPath(chatId, first.messageId), { body: { text: "иначе" } })).json()) as AnswerEditResponse;
    expect(second.mark).toEqual({ textEdited: true, editedToolCallIds: ["call-1"] });
  });

  it("закрытый чат: правка ответа уводит с точки закрытия — новая ветка открыта", async () => {
    const { setup, chatId, answerId } = await chatWithAnswer();
    await setup.storage.setChatClosed!(chatId, { code: "form_completed", message: "Заявка отправлена." });
    const response = await setup.call("POST", editPath(chatId, answerId), { body: { text: "другое" } });
    expect(response.status).toBe(200);
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as History & { chat: { closed: unknown } };
    expect(history.chat.closed ?? null).toBeNull();
  });

  it("без правок история отдаёт пустой answerEdits", async () => {
    const { setup, chatId } = await chatWithAnswer();
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as History;
    expect(history.answerEdits).toEqual({});
  });

  it("ошибки ядра → коды ответа", async () => {
    const { setup, chatId, answerId } = await chatWithAnswer();
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as History;
    const userMessage = history.messages.find((message) => message.role === "user")!.id;
    const cases: Array<[string, unknown, number, string]> = [
      [answerId, { text: "найдено" }, 400, "nothing_changed"],
      [answerId, { text: "   " }, 400, "empty_text"],
      [answerId, { text: "x", toolOutputs: { "no-call": 1 } }, 400, "invalid_tool_output"],
      [userMessage, { text: "x" }, 400, "not_an_answer"],
      ["no-such-message", { text: "x" }, 404, "message_not_found"],
    ];
    for (const [messageId, body, status, kind] of cases) {
      const response = await setup.call("POST", editPath(chatId, messageId), { body });
      expect(response.status, kind).toBe(status);
      expect(await response.json()).toEqual({ error: { kind } });
    }
    for (const body of [{}, { text: 5 }, { text: "x", toolOutputs: [1] }]) {
      expect((await setup.call("POST", editPath(chatId, answerId), { body })).status).toBe(400);
    }
    const missingChat = await setup.call("POST", editPath(crypto.randomUUID(), answerId), { body: { text: "x" } });
    expect(missingChat.status).toBe(404);
    expect(await missingChat.json()).toEqual({ error: { kind: "not_found" } });
  });

  it("ответ не на текущей ветке → 409", async () => {
    const { setup, chatId, answerId } = await chatWithAnswer();
    await setup.call("POST", editPath(chatId, answerId), { body: { text: "новое" } });
    const response = await setup.call("POST", editPath(chatId, answerId), { body: { text: "ещё" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "not_on_current_branch" } });
  });
});
