import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { UNANSWERED_NOTE } from "../../src/agent-run/unanswered-messages";
import { createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

/*
 * Ход упал сбоем модели до первых слов: вопрос человека остался без ответа. Следующее сообщение не сливается с ним
 * в одно — модель видит два вопроса по отдельности и между ними постоянную пометку «ответа не было».
 */

const refused = () =>
  new APICallError({
    message: "400 Bad Request",
    url: "https://provider.test/v1/messages",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: "bad request",
    isRetryable: false,
  });

/** Модель, у которой первый запрос падает, а остальные отвечают «Ответ N». */
function failingFirstModel() {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1;
      if (call === 1) throw refused();
      return { stream: streamOf([streamStart, ...textParts([`Ответ ${call}`]), finishPart()]) };
    },
  });
}

function serviceWith(model: MockLanguageModelV4) {
  const storage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError: () => {},
  });
  return { storage, service };
}

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

type PromptMessage = LanguageModelV4Prompt[number];
const textOf = (message: PromptMessage): string =>
  typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
const dialog = (prompt: LanguageModelV4Prompt) => prompt.filter((message) => message.role !== "system");
const userTexts = (prompt: LanguageModelV4Prompt) => dialog(prompt).filter((message) => message.role === "user").map(textOf);

async function failedFirstTurn() {
  const model = failingFirstModel();
  const { storage, service } = serviceWith(model);
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Первое сообщение")));
  const failed = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant");
  expect(failed?.status).toBe("error");
  return { model, storage, service, chatId: chat.id };
}

describe("createChatService: вопрос без ответа после сбоя модели", () => {
  it("новое сообщение не сливается с вопросом без ответа: две реплики человека, между ними пометка «ответа не было»", async () => {
    const { model, service, chatId } = await failedFirstTurn();
    await readAll(await service.sendMessage("anna", chatId, userMessage("u2", "Второе сообщение")));

    const prompt = model.doStreamCalls[1]!.prompt;
    const texts = userTexts(prompt);
    expect(texts.every((text) => !(text.includes("Первое сообщение") && text.includes("Второе сообщение")))).toBe(true);
    expect(texts[0]).toContain("Первое сообщение");
    expect(texts[1]).toContain("Второе сообщение");
    expect(dialog(prompt).map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(dialog(prompt)[1]!)).toBe(UNANSWERED_NOTE);
  });

  it("кэш: на следующем ходе начало запроса — те же байты, пометка на том же месте", async () => {
    const { model, service, chatId } = await failedFirstTurn();
    await readAll(await service.sendMessage("anna", chatId, userMessage("u2", "Второе сообщение")));
    await readAll(await service.sendMessage("anna", chatId, userMessage("u3", "Третье сообщение")));

    const second = dialog(model.doStreamCalls[1]!.prompt);
    const third = dialog(model.doStreamCalls[2]!.prompt);
    expect(third.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    // Первое сообщение и пометка не меняются; второе в прошлом запросе несло блоки хода (дату) — они уходят, как всегда.
    expect(JSON.stringify(third.slice(0, 2))).toBe(JSON.stringify(second.slice(0, 2)));
  });

  it("«Повторить» после сбоя отвечает на тот же вопрос: он в запросе один раз, пометки нет", async () => {
    const { model, service, chatId } = await failedFirstTurn();
    await readAll(await service.retry("anna", chatId));

    const prompt = model.doStreamCalls[1]!.prompt;
    expect(dialog(prompt).map((message) => message.role)).toEqual(["user"]);
    expect(userTexts(prompt)[0]).toContain("Первое сообщение");
  });

  it("правка второго сообщения: вопрос без ответа и пометка остаются перед ним, как были", async () => {
    const { model, service, chatId } = await failedFirstTurn();
    await readAll(await service.sendMessage("anna", chatId, userMessage("u2", "Второе сообщение")));
    await readAll(await service.editMessage("anna", chatId, "u2", userMessage("u2-edit", "Второе, исправленное")));

    const prompt = model.doStreamCalls[2]!.prompt;
    expect(dialog(prompt).map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(dialog(prompt)[1]!)).toBe(UNANSWERED_NOTE);
    expect(userTexts(prompt)[1]).toContain("Второе, исправленное");
  });

  it("правка вопроса без ответа: новая ветка начинается до него — ни его, ни пометки в запросе нет", async () => {
    const { model, service, chatId } = await failedFirstTurn();
    await readAll(await service.sendMessage("anna", chatId, userMessage("u2", "Второе сообщение")));
    await readAll(await service.editMessage("anna", chatId, "u1", userMessage("u1-edit", "Первое, исправленное")));

    const prompt = model.doStreamCalls[2]!.prompt;
    expect(dialog(prompt).map((message) => message.role)).toEqual(["user"]);
    expect(userTexts(prompt)[0]).toContain("Первое, исправленное");
  });
});
