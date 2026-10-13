import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { Chat } from "../../src/conversation/types";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { AfterTurnHandler, BeforeTurnHandler } from "../../src/turn-hooks/turn-hooks";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const lesson = { key: "lesson:7", data: { lessonId: 7, topic: "дроби" } };

/** Модель: шаг с вызовом `lookup`, затем текст. */
function toolThenTextModel() {
  const scripts: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: "{}" }, finishPart("tool-calls")],
    [streamStart, ...textParts(["Ответ"]), finishPart()],
  ];
  let call = 0;
  return mockModel(() => streamOf(scripts[call++ % scripts.length]!));
}

/** Служба, где инструмент `lookup` запоминает модель инструментов каждого вызова. */
function setup(extra: Partial<ChatServiceOptions> = {}) {
  const storage = extra.storage ?? createInMemoryChatStorage();
  const model = toolThenTextModel();
  const seen: AgentToolsModel[] = [];
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: {
      instructions: "Ты помощник.",
      tools: (toolsModel) => ({
        lookup: tool({
          description: "Справка",
          inputSchema: z.object({}),
          execute: async () => {
            seen.push(toolsModel);
            return "справка";
          },
        }),
      }),
    },
    env: mockEnv,
    ...extra,
  });
  return { service, storage, model, seen };
}

async function ask(service: ReturnType<typeof setup>["service"], chatId: string, text = "Привет") {
  return readAll(await service.sendMessage("anna", chatId, { id: `u-${crypto.randomUUID()}`, role: "user", parts: [{ type: "text", text }] }));
}

describe("данные объекта в модели инструментов", () => {
  it("ход в чате объекта: инструмент видит subject с ключом и данными на всех шагах", async () => {
    const { service, seen } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", ...lesson });
    await ask(service, chat.id);
    await ask(service, chat.id, "Ещё");
    expect(seen).toHaveLength(2);
    for (const model of seen) expect(model.subject).toEqual(lesson);
  });

  it("чат объекта без данных: subject только с ключом", async () => {
    const { service, seen } = setup();
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:8" });
    await ask(service, chat.id);
    expect(seen[0]!.subject).toEqual({ key: "lesson:8" });
    expect("data" in seen[0]!.subject!).toBe(false);
  });

  it("обычный чат: поля subject нет", async () => {
    const { service, seen } = setup();
    const chat = await service.createChat("anna");
    await ask(service, chat.id);
    expect("subject" in seen[0]!).toBe(false);
  });

  it("запрос к модели в чате объекта тот же, что в обычном: данные объекта модели не уходят", async () => {
    const plain = setup();
    const plainChat = await plain.service.createChat("anna");
    await ask(plain.service, plainChat.id);
    const subject = setup();
    const { chat } = await subject.service.openSubjectChat({ ownerId: "anna", ...lesson });
    await ask(subject.service, chat.id);

    const requests = (model: ReturnType<typeof setup>["model"], chatId: string) =>
      JSON.stringify(model.doStreamCalls.map(({ prompt, tools, providerOptions }) => ({ prompt, tools, providerOptions }))).replaceAll(chatId, "CHAT");
    expect(requests(subject.model, chat.id)).toBe(requests(plain.model, plainChat.id));
    expect(requests(subject.model, chat.id)).not.toContain("дроби");
  });
});

describe("данные объекта в итоге хода и в beforeTurn", () => {
  it("afterTurn в чате объекта получает subject; в обычном — поля нет", async () => {
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ afterTurn });
    const { chat } = await service.openSubjectChat({ ownerId: "anna", ...lesson });
    await ask(service, chat.id);
    const plain = await service.createChat("anna");
    await ask(service, plain.id);

    expect(afterTurn.mock.calls[0]![0].subject).toEqual(lesson);
    expect("subject" in afterTurn.mock.calls[1]![0]).toBe(false);
  });

  it("итог, доделанный после перезапуска, тоже получает subject", async () => {
    const storage = createInMemoryChatStorage();
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock", subjectKey: lesson.key, subjectData: lesson.data });
    await storage.insertMessage(newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Привет" }] }));
    await storage.insertMessage(
      newStoredMessage({
        id: "a1",
        chatId: "c1",
        parentId: "u1",
        role: "assistant",
        parts: [{ type: "text", text: "Начало", state: "done" }],
        modelId: mockModelId,
        providerId: "mock",
        createdAt: "2026-03-01T10:00:00.000Z",
        status: "complete",
        afterTurn: "pending",
      }),
    );
    const afterTurn = vi.fn<AfterTurnHandler>();
    const { service } = setup({ storage, afterTurn });
    await service.recoverInterruptedAnswers();
    await vi.waitFor(() => expect(afterTurn).toHaveBeenCalledTimes(1));
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ recovered: true, subject: lesson });
  });

  it("beforeTurn получает чат объекта с ключом и данными", async () => {
    const chats: Chat[] = [];
    const beforeTurn: BeforeTurnHandler = ({ chat }) => {
      chats.push(chat);
    };
    const { service } = setup({ beforeTurn });
    const { chat } = await service.openSubjectChat({ ownerId: "anna", ...lesson });
    await ask(service, chat.id);
    expect(chats[0]).toMatchObject({ subjectKey: lesson.key, subjectData: lesson.data });
  });
});
