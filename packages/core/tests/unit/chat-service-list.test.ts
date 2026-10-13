import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { ChatNotFoundError, createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { InvalidChatTitleError } from "../../src/conversation/chat-title";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import {
  controlledModel,
  finishPart,
  generateResult,
  mockCatalog,
  mockEnv,
  mockModel,
  mockModelId,
  readAll,
  reasoningAndTextParts,
  streamOf,
  streamStart,
  textParts,
} from "./support/mock-model";

const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

function setup(model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"]))), extra: Partial<ChatServiceOptions> = {}) {
  const storage = extra.storage ?? createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    logError,
    ...extra,
  });
  return { service, storage, logError };
}

async function ask(service: ReturnType<typeof setup>["service"], chatId: string, id: string, text: string, userId = "anna") {
  await readAll(await service.sendMessage(userId, chatId, user(id, text)));
}

describe("служба чата: список чатов", () => {
  it("отдаёт только чаты пользователя и только id, название и времена; самые недавние первыми", async () => {
    const { service } = setup();
    const old = await service.createChat("anna");
    const fresh = await service.createChat("anna");
    const foreign = await service.createChat("boris");
    await ask(service, old.id, "u1", "Старый разговор");
    await ask(service, fresh.id, "u2", "Свежий разговор");
    await ask(service, foreign.id, "u3", "Чужой разговор", "boris");

    const list = await service.listChats("anna");
    expect(list.map((item) => item.id)).toEqual([fresh.id, old.id]);
    expect(list[0]).toEqual({
      id: fresh.id,
      title: "Свежий разговор",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await service.listChats("nobody")).toEqual([]);
  });

  it("чат без названия — title: null", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    expect((await service.listChats("anna"))[0]).toMatchObject({ id: chat.id, title: null });
  });
});

describe("служба чата: название", () => {
  it("первое сообщение задаёт название до начала ответа", async () => {
    const source = controlledModel();
    const { service, storage } = setup(source.model);
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1", "  Расскажи\nпро   Грецию  ")));
    await source.opened;
    expect((await storage.getChat(chat.id))?.title).toBe("Расскажи про Грецию");
    source.push(streamStart, ...textParts(["Ответ"]), finishPart());
    source.end();
    await reading;
  });

  it("следующие сообщения название не меняют", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "Расскажи про Грецию");
    await ask(service, chat.id, "u2", "Совсем другой вопрос");
    expect((await storage.getChat(chat.id))?.title).toBe("Расскажи про Грецию");
  });

  it("название, заданное человеком, первое сообщение не перезаписывает", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await service.renameChat("anna", chat.id, "Отпуск");
    await ask(service, chat.id, "u1", "Привет");
    expect((await storage.getChat(chat.id))?.title).toBe("Отпуск");
  });

  it("переименование: срезает края, схлопывает пробелы, возвращает записанное; порядок списка не меняется", async () => {
    const { service } = setup();
    const first = await service.createChat("anna");
    const second = await service.createChat("anna");
    await ask(service, first.id, "u1", "раз");
    await ask(service, second.id, "u2", "два");
    expect(await service.renameChat("anna", first.id, "  Отпуск \n в   Греции ")).toBe("Отпуск в Греции");
    const list = await service.listChats("anna");
    expect(list.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(list[1]?.title).toBe("Отпуск в Греции");
  });

  it("пустое название и длиннее 100 знаков — InvalidChatTitleError, прежнее остаётся", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await service.renameChat("anna", chat.id, "Было");
    await expect(service.renameChat("anna", chat.id, "   ")).rejects.toBeInstanceOf(InvalidChatTitleError);
    await expect(service.renameChat("anna", chat.id, "я".repeat(101))).rejects.toBeInstanceOf(InvalidChatTitleError);
    expect((await service.listChats("anna"))[0]?.title).toBe("Было");
  });

  it("чужой и несуществующий чат — ChatNotFoundError, чужое название не меняется", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    await service.renameChat("anna", chat.id, "Моё");
    await expect(service.renameChat("boris", chat.id, "Взлом")).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.renameChat("anna", "missing", "Х")).rejects.toBeInstanceOf(ChatNotFoundError);
    expect((await service.listChats("anna"))[0]?.title).toBe("Моё");
  });
});

describe("служба чата: удаление", () => {
  it("удаляет чат с сообщениями; в списке и истории его нет", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    const other = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    await ask(service, other.id, "u9", "соседний чат");

    await service.deleteChat("anna", chat.id);

    expect(await storage.getChat(chat.id)).toBeNull();
    expect(await storage.listMessages(chat.id)).toEqual([]);
    expect((await service.listChats("anna")).map((item) => item.id)).toEqual([other.id]);
    await expect(service.getHistory("anna", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
    expect((await storage.listMessages(other.id)).length).toBeGreaterThan(0);
  });

  it("чужой и несуществующий чат — ChatNotFoundError, чужие данные целы", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    await expect(service.deleteChat("boris", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.deleteChat("anna", "missing")).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(await storage.getChat(chat.id)).not.toBeNull();
    expect((await storage.listMessages(chat.id)).length).toBeGreaterThan(0);
    // Повторное удаление уже удалённого — тоже «не найден».
    await service.deleteChat("anna", chat.id);
    await expect(service.deleteChat("anna", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("идущий ответ останавливается и дописывается до конца; после удаления в хранилище ничего не остаётся, журнал тихий", async () => {
    const source = controlledModel();
    const { service, storage, logError } = setup(source.model);
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1", "Долгий вопрос")));
    await source.opened;
    source.push(streamStart, ...textParts(["Начало ответа"]).slice(0, 2));

    await service.deleteChat("anna", chat.id);
    await reading;
    await service.flush();

    expect(await storage.getChat(chat.id)).toBeNull();
    expect(await storage.listMessages(chat.id)).toEqual([]);
    expect(await storage.listStreamingMessageIds()).toEqual([]);
    expect(logError).not.toHaveBeenCalled();
    await expect(service.subscribe("anna", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("пока чат удаляется, новое сообщение и «повторить» получают ChatBusyError", async () => {
    let releaseDeletion!: () => void;
    const gate = new Promise<void>((resolve) => (releaseDeletion = resolve));
    const base = createInMemoryChatStorage();
    const storage: ChatStorage = {
      ...base,
      async deleteChat(chatId) {
        await gate;
        return base.deleteChat(chatId);
      },
    };
    const { service } = setup(undefined, { storage });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");

    const deleting = service.deleteChat("anna", chat.id);
    await vi.waitFor(async () => {
      await expect(service.sendMessage("anna", chat.id, user("u2", "два"))).rejects.toBeInstanceOf(ChatBusyError);
    });
    await expect(service.retry("anna", chat.id)).rejects.toBeInstanceOf(ChatBusyError);
    await expect(service.deleteChat("anna", chat.id)).rejects.toBeInstanceOf(ChatBusyError);
    // Сжатие «сейчас» не должно дописать сводку в удаляемый чат; загрузка и чтение файлов — тоже.
    await expect(service.compactNow("anna", chat.id)).rejects.toBeInstanceOf(ChatBusyError);
    await expect(service.assertOwnChat("anna", chat.id)).rejects.toBeInstanceOf(ChatBusyError);
    releaseDeletion();
    await deleting;
    expect(await base.getChat(chat.id)).toBeNull();
    await expect(service.assertOwnChat("anna", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("идущее сжатие отменяется: записи нет, в журнале тихо", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let call = 0;
    const contexts = [100, 300, 600];
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const context = contexts[call++] ?? 600;
        return {
          stream: streamOf([
            streamStart,
            ...textParts([`ответ ${call}`]),
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 10, text: 10, reasoning: 0 },
              },
            },
          ]),
        };
      },
      doGenerate: async ({ abortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          void held.then(resolve);
          // Отмена могла прийти раньше запроса: слушатель её уже не поймает.
          if (abortSignal?.aborted) reject(abortSignal.reason);
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        });
        return generateResult("## Цель\nсводка", { output: 20 });
      },
    });
    const { service, storage, logError } = setup(model, {
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
    });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    await ask(service, chat.id, "u2", "два");
    await ask(service, chat.id, "u3", "три");
    await vi.waitFor(async () => expect((await service.getCompactions("anna", chat.id)).compacting).toBe(true));

    await service.deleteChat("anna", chat.id);
    release();
    await service.flush();

    expect(await storage.listCompactions(chat.id)).toEqual([]);
    expect(await storage.getChat(chat.id)).toBeNull();
    expect(logError).not.toHaveBeenCalled();
  });
});
