import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatNotFoundError,
  InvalidMessageError,
  createChatService,
} from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import {
  controlledModel,
  finishPart,
  mockCatalog,
  mockEnv,
  mockModel,
  mockModelId,
  readAll,
  reasoningAndTextParts,
  streamOf,
  streamStart,
} from "./support/mock-model";
import { textOf } from "./support/turn-fixtures";

function userMessage(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

/** Модель, которая отдаёт начало ответа и ждёт, пока тест её не отпустит. */
function heldModel() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = mockModel(
    () =>
      new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "txt-0" });
          controller.enqueue({ type: "text-delta", id: "txt-0", delta: "Идёт" });
          await released;
          for (const part of reasoningAndTextParts([]).slice(-2)) controller.enqueue(part);
          controller.close();
        },
      }),
  );
  return { model, release };
}

function setup(options: { storage?: ChatStorage; held?: boolean } = {}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const held = heldModel();
  const answering = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
  const backup = mockModel(() => streamOf(reasoningAndTextParts(["Ответ запасного"])));
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: options.held ? held.model : answering, "mock-backup": backup }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
  });
  return { service, storage, release: held.release };
}

describe("служба чата", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createChat задаёт владельца и id из crypto.randomUUID()", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    expect(chat.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(chat.ownerId).toBe("anna");
    expect(await storage.getChat(chat.id)).toMatchObject({ ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  });

  it("отклоняет пустой после обрезки пробелов текст и текст длиннее 100 000 символов", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await expect(service.sendMessage("anna", chat.id, userMessage("u1", "   \n\t "))).rejects.toThrow(InvalidMessageError);
    await expect(service.sendMessage("anna", chat.id, userMessage("u2", "я".repeat(100_001)))).rejects.toThrow(
      InvalidMessageError,
    );
    expect(await storage.listMessages(chat.id)).toEqual([]);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "я".repeat(100_000))));
  });

  it("parentId новой реплики — конец текущей ветки, сервер считает сам", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Первый вопрос")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Второй вопрос")));

    const messages = await storage.listMessages(chat.id);
    const firstAnswer = messages.find((message) => message.parentId === "u1");
    const second = messages.find((message) => message.id === "u2");
    expect(messages.find((message) => message.id === "u1")?.parentId).toBeNull();
    expect(firstAnswer?.role).toBe("assistant");
    expect(second?.parentId).toBe(firstAnswer?.id);
    expect(messages.find((message) => message.parentId === "u2")?.role).toBe("assistant");
  });

  it("getHistory не отдаёт идущий ответ агента и говорит running: true", async () => {
    const { service, release } = setup({ held: true });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"));
    const reader = stream.getReader();
    while ((await reader.read()).value?.type !== "text-delta") {
      // ждём, пока ответ начнёт писаться
    }

    const during = await service.getHistory("anna", chat.id);
    expect(during.running).toBe(true);
    expect(during.messages.map((message) => message.id)).toEqual(["u1"]);

    release();
    while (!(await reader.read()).done) {
      // дочитываем
    }
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(false));
    const after = await service.getHistory("anna", chat.id);
    expect(after.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(after.messages[1]?.metadata).toMatchObject({ status: "complete", modelId: mockModelId, providerId: "mock" });
  });

  it("смена модели посреди чата: идущий ответ дописывает прежняя, следующий идёт на новой", async () => {
    const { service, storage, release } = setup({ held: true });
    const chat = await service.createChat("anna");
    const running = await service.sendMessage("anna", chat.id, userMessage("u1", "Раз"));
    await service.setModel("anna", chat.id, { modelId: mockModelId, providerId: "mock-backup" });
    release();
    await readAll(running);
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(false));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Два")));

    const answers = (await storage.listMessages(chat.id)).filter((message) => message.role === "assistant");
    expect(answers.map((answer) => answer.providerId)).toEqual(["mock", "mock-backup"]);
    expect(answers[1]?.parts.find((part) => part.type === "text")).toMatchObject({ text: "Ответ запасного" });
  });

  it("действие с чужим или несуществующим чатом — ChatNotFoundError", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await expect(service.getHistory("boris", chat.id)).rejects.toThrow(ChatNotFoundError);
    await expect(service.sendMessage("boris", chat.id, userMessage("u1", "Привет"))).rejects.toThrow(ChatNotFoundError);
    await expect(service.stop("boris", chat.id)).rejects.toThrow(ChatNotFoundError);
    await expect(service.subscribe("boris", chat.id)).rejects.toThrow(ChatNotFoundError);
    await expect(service.getHistory("anna", "нет-такого")).rejects.toThrow(ChatNotFoundError);
  });

  describe("flush при штатной остановке сервера", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("дописывает то, что запись раз в 0,5 с ещё не успела, и закрывает ответ как «Стоп»: обрывков нет", async () => {
      const source = controlledModel();
      const storage = createInMemoryChatStorage();
      const service = createChatService({
        storage,
        catalog: mockCatalog({ mock: source.model }),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: { instructions: "Ты помощник." },
        env: mockEnv,
      });
      const chat = await service.createChat("anna");
      const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
      await source.opened;
      const delta = (text: string): LanguageModelV4StreamPart => ({ type: "text-delta", id: "txt-0", delta: text });
      const savedText = async () => {
        const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant");
        return { status: answer?.status, text: textOf(answer?.parts ?? []) };
      };

      source.push(streamStart, { type: "text-start", id: "txt-0" }, delta("а"));
      await vi.advanceTimersByTimeAsync(500);
      source.push(delta("б"), delta("в"));
      await vi.advanceTimersByTimeAsync(0);
      expect(await savedText()).toEqual({ status: "streaming", text: "а" });

      await service.flush();
      expect(await savedText()).toEqual({ status: "stopped", text: "абв" });
      await reading;
      // Ходов не осталось — flush ничего не ждёт.
      await service.flush();
    });
  });
});
