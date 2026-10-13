import { jsonSchema } from "ai";
import { describe, expect, it } from "vitest";
import { CURRENT_FORMAT_VERSION, newStoredMessage } from "../conversation/types";
import type { StoredBranchSelection, StoredCompaction, StoredMessage, UsageRecord } from "../conversation/types";
import {
  ChatAlreadyExistsError,
  DuplicateChatSubjectError,
  DuplicateMessageError,
  MessageAlreadyFinishedError,
  MessageNotAwaitingError,
  UnsupportedFormatVersionError,
} from "./chat-storage";
import type { ChatStorage } from "./chat-storage";
import { ChatDataTooLargeError } from "./chat-data";
import type { ChatDataFilter } from "./chat-data";
import { WidgetNotPendingError, createChatService } from "../chat-service";
import type { ChatService } from "../chat-service";
import { AnswerEditError } from "../conversation/edit-answer-parts";
import { extendCatalog } from "../models/catalog-changes";
import { standardCatalog } from "../models/standard-catalog";
import type { MemoryError, MemoryNote, MemoryNoteInput, MemoryWriteGuard } from "../memory/long-term-memory";
import type { MemoryOptimizationRules } from "../memory/memory-optimization";

/**
 * Проверки договора хранилища (contracts/storage.md). Каждый адаптер подключает их
 * в своих тестах: `describeChatStorageContract(() => createMyStorage())`.
 */
export function describeChatStorageContract(
  createStorage: () => ChatStorage | Promise<ChatStorage>,
  options: {
    /** `choiceMemory: "required"` — методы запомненного выбора обязаны быть (для встроенных хранилищ); иначе их проверки пропускаются. */
    choiceMemory?: "required";
    /** `voiceDialog: "required"` — то же для методов голосового режима (`setVoiceCut`, `getVoiceChoice`, `setVoiceChoice`). */
    voiceDialog?: "required";
    /** `memory: "required"` — методы долгой памяти обязаны быть (для встроенных хранилищ). */
    memory?: "required";
    /** `memoryOptimization: "required"` — методы оптимизации дублей обязаны быть (для встроенных хранилищ). */
    memoryOptimization?: "required";
    /** `spendingLimitState: "required"` — методы состояния лимитов расходов обязаны быть (для встроенных хранилищ). */
    spendingLimitState?: "required";
    /** `subjectChats: "required"` — чаты объектов обязаны быть (`findChatBySubject`, ключ, данные, название и дата в `createChat`, `listChats` с `subjects`). */
    subjectChats?: "required";
    /** `chatData: "required"` — данные чата (`data`, `updateChatData`, фильтр `data` в `listChats`) обязаны быть. */
    chatData?: "required";
    /** `importChat: "required"` — перенос чата целиком (`importChat`) обязан быть. */
    importChat?: "required";
    /** `afterTurnState: "required"` — состояние хука итога у сообщения (`setAfterTurnState`, `listPendingAfterTurn`) обязано быть. */
    afterTurnState?: "required";
    /** `chatClosure: "required"` — закрытие чата (`setChatClosed`, поле `closed` у чата) обязано быть. */
    chatClosure?: "required";
    /** `partsOfTypes: "required"` — лёгкое чтение частей нужных типов (`listMessagePartsOfTypes`) обязано быть. */
    partsOfTypes?: "required";
  } = {},
): void {
  const chatInput = { id: "chat-1", ownerId: "anna", modelId: "deepseek-4.1-flash", providerId: "deepseek" };

  function userMessage(id: string, createdAt: string, parentId: string | null = null): StoredMessage {
    return newStoredMessage({
      id,
      chatId: chatInput.id,
      parentId,
      role: "user",
      parts: [{ type: "text", text: `вопрос ${id}` }],
      createdAt,
    });
  }

  function streamingAnswer(id: string, parentId: string, createdAt: string): StoredMessage {
    return {
      ...userMessage(id, createdAt, parentId),
      role: "assistant",
      parts: [],
      status: "streaming",
      modelId: "deepseek-4.1-flash",
      providerId: "deepseek",
    };
  }

  async function storageWithChat(): Promise<ChatStorage> {
    const storage = await createStorage();
    await storage.createChat(chatInput);
    return storage;
  }

  describe("договор ChatStorage", () => {
    it("создаёт чат и читает его; неизвестный чат — null", async () => {
      const storage = await storageWithChat();
      const chat = await storage.getChat(chatInput.id);
      expect(chat).toMatchObject(chatInput);
      expect(typeof chat?.createdAt).toBe("string");
      expect(chat?.updatedAt).toBe(chat?.createdAt);
      expect(await storage.getChat("missing")).toBeNull();
    });

    it("хранит происхождение чата: из мессенджера — отдаёт, без него — поля нет", async () => {
      const storage = await createStorage();
      const fromMessenger = await storage.createChat({ ...chatInput, id: "from-telegram", origin: "telegram" });
      expect(fromMessenger.origin).toBe("telegram");
      expect((await storage.getChat("from-telegram"))?.origin).toBe("telegram");

      const web = await storage.createChat({ ...chatInput, id: "from-web" });
      expect(web.origin).toBeUndefined();
      const read = await storage.getChat("from-web");
      expect(read).not.toHaveProperty("origin");

      const listed = await storage.listChats(chatInput.ownerId);
      expect(listed.find((chat) => chat.id === "from-telegram")?.origin).toBe("telegram");
      expect(listed.find((chat) => chat.id === "from-web")).not.toHaveProperty("origin");

      for (const origin of ["vk", "max"] as const) {
        const chat = await storage.createChat({ ...chatInput, id: `from-${origin}`, origin });
        expect((await storage.getChat(chat.id))?.origin).toBe(origin);
      }

      await storage.updateChatModel("from-telegram", { modelId: "m", providerId: "p" });
      expect((await storage.getChat("from-telegram"))?.origin).toBe("telegram");
    });

    it("updateChatModel меняет модель и провайдера чата", async () => {
      const storage = await storageWithChat();
      await storage.updateChatModel(chatInput.id, { modelId: "other-model", providerId: "fireworks" });
      expect(await storage.getChat(chatInput.id)).toMatchObject({ modelId: "other-model", providerId: "fireworks" });
    });

    it("хранит уровень рассуждений чата: при создании и при смене модели; без него — стирает", async () => {
      const storage = await createStorage();
      const withLevel = await storage.createChat({ ...chatInput, id: "with-level", reasoning: "high" });
      expect(withLevel.reasoning).toBe("high");
      expect((await storage.getChat("with-level"))?.reasoning).toBe("high");

      const without = await storage.createChat({ ...chatInput, id: "without-level" });
      expect(without.reasoning).toBeUndefined();
      expect((await storage.getChat("without-level"))?.reasoning).toBeUndefined();

      await storage.updateChatModel("without-level", { modelId: "m", providerId: "p", reasoning: "low" });
      expect(await storage.getChat("without-level")).toMatchObject({ modelId: "m", providerId: "p", reasoning: "low" });

      await storage.updateChatModel("without-level", { modelId: "m", providerId: "p" });
      expect((await storage.getChat("without-level"))?.reasoning).toBeUndefined();
    });

    it("insertMessage обновляет updatedAt чата", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      expect((await storage.getChat(chatInput.id))?.updatedAt).toBe("2099-01-01T00:00:00.000Z");
    });

    it("insertMessage в несуществующий чат — отказ, сообщение не записано", async () => {
      const storage = await storageWithChat();
      await expect(storage.insertMessage({ ...userMessage("u1", "2099-01-01T00:00:00.000Z"), chatId: "missing" })).rejects.toThrow();
      expect(await storage.getMessage("u1")).toBeNull();
      expect(await storage.listMessages("missing")).toEqual([]);
    });

    it("listMessages отдаёт сообщения чата по времени создания", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u2", "2099-01-01T00:00:02.000Z", "a1"));
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      expect((await storage.listMessages(chatInput.id)).map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
      expect(await storage.listMessages("missing")).toEqual([]);
    });

    it("listMessageLinks отдаёт только id, родителя и время создания, в том же порядке, что listMessages", async () => {
      const storage = await storageWithChat();
      const sameTime = "2099-01-01T00:00:02.000Z";
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      await storage.insertMessage(userMessage("u3", sameTime, "a1"));
      await storage.insertMessage(userMessage("u2", sameTime, "a1"));
      expect(await storage.listMessageLinks(chatInput.id)).toEqual([
        { id: "u1", parentId: null, createdAt: "2099-01-01T00:00:00.000Z" },
        { id: "a1", parentId: "u1", createdAt: "2099-01-01T00:00:01.000Z" },
        { id: "u3", parentId: "a1", createdAt: sameTime },
        { id: "u2", parentId: "a1", createdAt: sameTime },
      ]);
      expect((await storage.listMessageLinks(chatInput.id)).map((link) => link.id)).toEqual(
        (await storage.listMessages(chatInput.id)).map((message) => message.id),
      );
      expect(await storage.listMessageLinks("missing")).toEqual([]);
    });

    it("listMessagePartsOfTypes отдаёт связи и только части нужных типов, в порядке listMessages", async (context) => {
      const storage = await storageWithChat();
      if (!storage.listMessagePartsOfTypes) {
        if (options.partsOfTypes === "required") throw new Error("У хранилища нет listMessagePartsOfTypes");
        context.skip();
      }
      const sameTime = "2099-01-01T00:00:02.000Z";
      const record = { type: "data-app-state", data: { set: { "fields.email": "a@x.ru", $closed: { code: "done", message: "Готово «ок» \\ \"кавычки\"" } } } };
      const voice = { type: "data-voice-mode", data: { voice: "alloy" } };
      await storage.insertMessage({ ...userMessage("u1", "2099-01-01T00:00:00.000Z"), parts: [{ type: "text", text: "вопрос" }, voice] as StoredMessage["parts"] });
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      await storage.updateStreamingMessage("a1", {
        parts: [{ type: "step-start" }, record, { type: "text", text: "длинный ответ", state: "done" }, { type: "data-app-state", data: { unset: ["fields.email"] } }] as StoredMessage["parts"],
        reasoningDurationsMs: {},
      });
      await storage.insertMessage(userMessage("u3", sameTime, "a1"));
      await storage.insertMessage({ ...userMessage("u2", sameTime, "a1"), parts: [record] as StoredMessage["parts"] });
      expect(await storage.listMessagePartsOfTypes!(chatInput.id, ["data-app-state", "data-voice-mode"])).toEqual([
        { id: "u1", parentId: null, createdAt: "2099-01-01T00:00:00.000Z", parts: [voice] },
        { id: "a1", parentId: "u1", createdAt: "2099-01-01T00:00:01.000Z", parts: [record, { type: "data-app-state", data: { unset: ["fields.email"] } }] },
        { id: "u3", parentId: "a1", createdAt: sameTime, parts: [] },
        { id: "u2", parentId: "a1", createdAt: sameTime, parts: [record] },
      ]);
      expect(await storage.listMessagePartsOfTypes!(chatInput.id, ["data-voice-mode"])).toMatchObject([{ parts: [voice] }, { parts: [] }, { parts: [] }, { parts: [] }]);
      expect(await storage.listMessagePartsOfTypes!("missing", ["data-app-state"])).toEqual([]);
    });

    it("повтор id в insertMessage — DuplicateMessageError", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await expect(storage.insertMessage(userMessage("u1", "2099-01-01T00:00:01.000Z"))).rejects.toBeInstanceOf(
        DuplicateMessageError,
      );
      expect(await storage.listMessages(chatInput.id)).toHaveLength(1);
    });

    it("части с providerMetadata у рассуждений читаются без изменений", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      const parts: StoredMessage["parts"] = [
        { type: "step-start" },
        {
          type: "reasoning",
          id: "r1",
          text: "думаю о сложении",
          state: "done",
          providerMetadata: { deepseek: { signature: "штамп-провайдера", nested: { list: [1, 2, 3] } } },
        },
        { type: "text", text: "42", state: "done" },
      ];
      await storage.updateStreamingMessage("a1", { parts, reasoningDurationsMs: { r1: 1500 } });
      const saved = (await storage.listMessages(chatInput.id)).find((message) => message.id === "a1");
      expect(saved?.parts).toEqual(parts);
      expect(saved?.reasoningDurationsMs).toEqual({ r1: 1500 });
      expect(saved?.status).toBe("streaming");
    });

    it("отметка голосового режима в частях сообщения человека переживает запись и чтение", async () => {
      const storage = await storageWithChat();
      const parts: StoredMessage["parts"] = [
        { type: "text", text: "сказано голосом" },
        { type: "data-voice-mode", data: true },
      ];
      await storage.insertMessage({ ...userMessage("u1", "2099-01-01T00:00:00.000Z"), parts });
      expect((await storage.getMessage("u1"))?.parts).toEqual(parts);
      expect((await storage.listMessages(chatInput.id)).find((message) => message.id === "u1")?.parts).toEqual(parts);
    });

    it("finishMessage переводит ответ в конечное состояние с итогом", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      const usage = { inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, reasoningTokens: 10 };
      await storage.finishMessage("a1", {
        status: "error",
        parts: [{ type: "text", text: "часть", state: "done" }],
        usage,
        error: { kind: "overloaded" },
      });
      const saved = (await storage.listMessages(chatInput.id)).find((message) => message.id === "a1");
      expect(saved).toMatchObject({ status: "error", usage, error: { kind: "overloaded" } });
      expect(saved?.parts).toEqual([{ type: "text", text: "часть", state: "done" }]);
    });

    it("finishMessage с providerId меняет провайдера ответа, без поля — провайдер прежний", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      await storage.insertMessage(streamingAnswer("a2", "u1", "2099-01-01T00:00:02.000Z"));
      await storage.finishMessage("a1", { status: "complete", providerId: "fireworks" });
      await storage.finishMessage("a2", { status: "complete" });
      const saved = await storage.listMessages(chatInput.id);
      expect(saved.find((message) => message.id === "a1")?.providerId).toBe("fireworks");
      expect((await storage.getMessage("a1"))?.providerId).toBe("fireworks");
      expect(saved.find((message) => message.id === "a2")?.providerId).toBe("deepseek");
    });

    it("сообщение в конечном состоянии не меняется — MessageAlreadyFinishedError", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      await storage.finishMessage("a1", { status: "stopped" });
      await expect(storage.updateStreamingMessage("a1", { parts: [] })).rejects.toBeInstanceOf(
        MessageAlreadyFinishedError,
      );
      await expect(storage.finishMessage("a1", { status: "complete" })).rejects.toBeInstanceOf(
        MessageAlreadyFinishedError,
      );
      await expect(storage.updateStreamingMessage("u1", { parts: [] })).rejects.toBeInstanceOf(
        MessageAlreadyFinishedError,
      );
      const saved = (await storage.listMessages(chatInput.id)).find((message) => message.id === "a1");
      expect(saved?.status).toBe("stopped");
    });

    describe("ответ, который ждёт подтверждения", () => {
      const requested = {
        type: "tool-remove",
        toolCallId: "c1",
        state: "approval-requested",
        input: { path: "a" },
        approval: { id: "ap1" },
      } as StoredMessage["parts"][number];

      async function storageWithAwaitingAnswer(): Promise<ChatStorage> {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        await storage.finishMessage("a1", { status: "awaiting_approval", parts: [requested] });
        return storage;
      }

      const savedAnswer = async (storage: ChatStorage) =>
        (await storage.listMessages(chatInput.id)).find((message) => message.id === "a1");

      it("хранится как обычное сообщение и не считается идущим", async () => {
        const storage = await storageWithAwaitingAnswer();
        expect(await savedAnswer(storage)).toMatchObject({ status: "awaiting_approval", parts: [requested] });
        expect(await storage.listStreamingMessageIds()).toEqual([]);
      });

      it("updateAwaitingMessage меняет части и оставляет ожидание, если статус не указан", async () => {
        const storage = await storageWithAwaitingAnswer();
        const responded = { ...requested, state: "approval-responded", approval: { id: "ap1", approved: true } };
        await storage.updateAwaitingMessage("a1", { parts: [responded as StoredMessage["parts"][number]] });
        expect(await savedAnswer(storage)).toMatchObject({ status: "awaiting_approval", parts: [responded] });
      });

      it("updateAwaitingMessage со статусом streaming возвращает ответ в работу, после чего он дописывается и завершается", async () => {
        const storage = await storageWithAwaitingAnswer();
        await storage.updateAwaitingMessage("a1", { parts: [requested], status: "streaming" });
        expect(await storage.listStreamingMessageIds()).toEqual(["a1"]);
        await storage.updateStreamingMessage("a1", { parts: [requested, { type: "text", text: "готово", state: "done" }] });
        await storage.finishMessage("a1", { status: "complete" });
        expect(await savedAnswer(storage)).toMatchObject({ status: "complete" });
      });

      it("updateAwaitingMessage со статусом complete закрывает ожидание", async () => {
        const storage = await storageWithAwaitingAnswer();
        await storage.updateAwaitingMessage("a1", { parts: [], status: "complete" });
        expect(await savedAnswer(storage)).toMatchObject({ status: "complete", parts: [] });
      });

      it("updateAwaitingMessage с expectedParts пишет, только если части в базе те же (порядок ключей не важен)", async () => {
        const storage = await storageWithAwaitingAnswer();
        const read = (await savedAnswer(storage))!.parts;
        const reordered = read.map((part) => Object.fromEntries(Object.entries(part).reverse())) as StoredMessage["parts"];
        const responded = { ...requested, state: "approval-responded", approval: { id: "ap1", approved: true } } as StoredMessage["parts"][number];
        await storage.updateAwaitingMessage("a1", { parts: [responded], expectedParts: reordered });
        expect(await savedAnswer(storage)).toMatchObject({ status: "awaiting_approval", parts: [responded] });
      });

      it("updateAwaitingMessage с expectedParts: части изменились с прочтения — MessageNotAwaitingError, в базе чужая запись", async () => {
        const storage = await storageWithAwaitingAnswer();
        const read = (await savedAnswer(storage))!.parts;
        const theirs = { ...requested, state: "approval-responded", approval: { id: "ap1", approved: false } } as StoredMessage["parts"][number];
        const mine = { ...requested, state: "approval-responded", approval: { id: "ap1", approved: true } } as StoredMessage["parts"][number];
        await storage.updateAwaitingMessage("a1", { parts: [theirs] });
        await expect(storage.updateAwaitingMessage("a1", { parts: [mine], status: "streaming", expectedParts: read })).rejects.toBeInstanceOf(
          MessageNotAwaitingError,
        );
        expect(await savedAnswer(storage)).toMatchObject({ status: "awaiting_approval", parts: [theirs] });
      });

      it("не из ожидания — MessageNotAwaitingError; ожидающее не пишется как идущее", async () => {
        const storage = await storageWithAwaitingAnswer();
        await storage.insertMessage(streamingAnswer("a2", "u1", "2099-01-01T00:00:02.000Z"));
        await expect(storage.updateAwaitingMessage("a2", { parts: [] })).rejects.toBeInstanceOf(MessageNotAwaitingError);
        await expect(storage.updateAwaitingMessage("u1", { parts: [] })).rejects.toBeInstanceOf(MessageNotAwaitingError);
        await expect(storage.updateAwaitingMessage("missing", { parts: [] })).rejects.toThrow("Сообщения missing нет");
        await expect(storage.updateStreamingMessage("a1", { parts: [] })).rejects.toBeInstanceOf(MessageAlreadyFinishedError);
      });
    });

    describe("ждущий виджет и несколько копий сервера (SC-002, SC-003)", () => {
      it("служба, созданная заново на том же хранилище, видит ждущий виджет и принимает ответ", async () => {
        const storage = await createStorage();
        const asking = widgetService(storage);
        const chat = await asking.createChat("anna");
        await drain(await asking.sendMessage("anna", chat.id, widgetQuestion()));
        const restarted = widgetService(storage);
        expect(await restarted.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).toEqual({ resumed: true });
        await drain((await restarted.subscribe("anna", chat.id))!);
        const answer = (await storage.listMessages(chat.id)).at(-1)!;
        expect(answer.status).toBe("complete");
        expect(answer.parts.find((part) => (part as { toolCallId?: string }).toolCallId === "w1")).toMatchObject({ state: "output-available", output: { выбрано: "Про" } });
      });

      it("две копии одновременно отвечают на один виджет: принят ровно один ответ, второй — WidgetNotPendingError (20 повторов)", async () => {
        const storage = await createStorage();
        const [first, second] = [widgetService(storage), widgetService(storage)];
        for (let round = 0; round < 20; round++) {
          const chat = await first.createChat("anna");
          await drain(await first.sendMessage("anna", chat.id, widgetQuestion(`u${round}`)));
          const answers = [
            { service: first, choice: "Базовый" },
            { service: second, choice: "Про" },
          ];
          const results = await Promise.allSettled(
            answers.map(({ service, choice }) => service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: choice } })),
          );
          const accepted = results.flatMap((result, index) => (result.status === "fulfilled" ? [answers[index]!] : []));
          expect(accepted).toHaveLength(1);
          expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.any(WidgetNotPendingError) });
          await drain((await accepted[0]!.service.subscribe("anna", chat.id))!);
          const answer = (await storage.listMessages(chat.id)).at(-1)!;
          expect(answer.status).toBe("complete");
          expect(answer.parts.find((part) => (part as { toolCallId?: string }).toolCallId === "w1")).toMatchObject({ output: { выбрано: accepted[0]!.choice } });
        }
        // 20 кругов на встроенной базе: при полном прогоне под нагрузкой 5 с по умолчанию не хватает.
      }, 30_000);
    });

    describe("правка ответа агента (editAnswer)", () => {
      async function answeredChat(storage: ChatStorage, lockedToolOutputs?: readonly string[]) {
        const editing = editAnswerService(storage, lockedToolOutputs);
        const chat = await editing.service.createChat("anna");
        await drain(await editing.service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "найди отчёт" }] }));
        const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
        return { ...editing, chat, answer };
      }
      const toolPart = (message: StoredMessage, toolCallId: string) =>
        message.parts.find((part) => (part as { toolCallId?: string }).toolCallId === toolCallId);

      it("новый ответ — сосед прежнего под тем же вопросом и текущая ветка; прежний не тронут; модель не вызывается", async () => {
        const storage = await createStorage();
        const { service, chat, answer, prompts } = await answeredChat(storage);
        const calls = prompts.length;
        const edited = await service.editAnswer("anna", chat.id, answer.id, { text: "Отчёт не найден.", toolOutputs: { f1: "ничего нет" } });
        expect(prompts).toHaveLength(calls);
        expect(edited).toMatchObject({ chatId: chat.id, parentId: answer.parentId, role: "assistant", status: "complete", usage: null, modelId: answer.modelId, providerId: answer.providerId });
        expect(edited.id).not.toBe(answer.id);
        expect(edited.parts.filter((part) => part.type === "text")).toEqual([{ type: "text", text: "Отчёт не найден.", state: "done" }]);
        expect(toolPart(edited, "f1")).toMatchObject({ state: "output-available", output: "ничего нет", input: { name: "отчёт" } });
        expect(await storage.getMessage(answer.id)).toEqual(answer);
        expect(await storage.getMessage(edited.id)).toEqual(edited);
        expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).toEqual(["u1", edited.id]);
        expect((await service.getBranchForks("anna", chat.id)).forks).toEqual([expect.objectContaining({ messageId: edited.id })]);
      });

      it("следующий вопрос видит правленый ответ и новый результат инструмента", async () => {
        const storage = await createStorage();
        const { service, chat, answer, prompts } = await answeredChat(storage);
        await service.editAnswer("anna", chat.id, answer.id, { text: "Отчёт не найден.", toolOutputs: { f1: "ничего нет" } });
        const calls = prompts.length;
        await drain(await service.sendMessage("anna", chat.id, { id: "u2", role: "user", parts: [{ type: "text", text: "а теперь?" }] }));
        const sent = JSON.stringify(prompts[calls]);
        expect(sent).toContain("Отчёт не найден.");
        expect(sent).toContain("ничего нет");
        expect(sent).not.toContain("Нашёл отчёт.");
        expect(sent).not.toContain("отчёт.pdf");
      });

      it("результат инструмента из lockedToolOutputs не правится, текст рядом с ним — правится", async () => {
        const storage = await createStorage();
        const { service, chat, answer } = await answeredChat(storage, ["find"]);
        await expect(service.editAnswer("anna", chat.id, answer.id, { text: "Новый.", toolOutputs: { f1: "ничего" } })).rejects.toMatchObject({
          kind: "invalid_tool_output",
        });
        expect(toolPart(await service.editAnswer("anna", chat.id, answer.id, { text: "Новый." }), "f1")).toEqual(toolPart(answer, "f1"));
      });

      it("ошибки правки: kind в AnswerEditError, ничего не записано", async () => {
        const storage = await createStorage();
        const { service, chat, answer } = await answeredChat(storage);
        const kindOf = (attempt: Promise<unknown>) => attempt.then(() => "принято", (error: unknown) => (error instanceof AnswerEditError ? error.kind : error));
        expect(await kindOf(service.editAnswer("boris", chat.id, answer.id, { text: "Чужое." }))).toBe("chat_not_found");
        expect(await kindOf(service.editAnswer("anna", chat.id, "нет-такого", { text: "Новый." }))).toBe("message_not_found");
        expect(await kindOf(service.editAnswer("anna", chat.id, "u1", { text: "Новый." }))).toBe("not_an_answer");
        expect(await kindOf(service.editAnswer("anna", chat.id, answer.id, { text: " " }))).toBe("empty_text");
        expect(await kindOf(service.editAnswer("anna", chat.id, answer.id, { text: "Новый.", toolOutputs: { чужой: 1 } }))).toBe("invalid_tool_output");
        expect(await kindOf(service.editAnswer("anna", chat.id, answer.id, { text: "Ищу отчёт.\n\nНашёл отчёт." }))).toBe("nothing_changed");
        const before = await storage.listMessages(chat.id);
        expect(before).toHaveLength(2);
        await service.editAnswer("anna", chat.id, answer.id, { text: "Новый." });
        expect(await kindOf(service.editAnswer("anna", chat.id, answer.id, { text: "Ещё новее." }))).toBe("not_on_current_branch");
        await storage.insertMessage({ ...streamingAnswer("a-broken", "u1", "2099-01-01T00:00:00.000Z"), chatId: chat.id });
        await storage.finishMessage("a-broken", { status: "error" });
        await service.selectBranch("anna", chat.id, "a-broken");
        expect(await kindOf(service.editAnswer("anna", chat.id, "a-broken", { text: "Новый." }))).toBe("answer_busy");
      });
    });

    it("getMessage отдаёт сообщение целиком по id, неизвестного нет", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a9", "u1", "2099-01-01T00:00:01.000Z"));
      expect(await storage.getMessage("a9")).toMatchObject({ id: "a9", chatId: chatInput.id, status: "streaming" });
      expect(await storage.getMessage("нет-такого")).toBeNull();
    });

    it("listStreamingMessageIds возвращает только идущие ответы", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      await storage.insertMessage(streamingAnswer("a2", "u1", "2099-01-01T00:00:02.000Z"));
      await storage.finishMessage("a1", { status: "complete" });
      expect(await storage.listStreamingMessageIds()).toEqual(["a2"]);
    });

    describe("знак жизни идущего ответа (FR-060)", () => {
      /** Давно: ответ, созданный тогда и без знака жизни, молчит дольше любого порога. */
      const longAgo = (second: number) => `2000-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
      const minute = 60_000;
      const silent = (storage: ChatStorage, filter: { silentForMs: number; chatId?: string }) =>
        storage.listSilentAnswerIds!(filter).then((ids) => ids.sort());

      it("молчащие ответы: без знака считается время создания; знак «сейчас» делает ответ живым, «брошен» — молчащим сразу", async (context) => {
        const storage = await storageWithChat();
        if (!storage.listSilentAnswerIds) return context.skip();
        await storage.insertMessage(userMessage("u1", longAgo(0)));
        await storage.insertMessage(streamingAnswer("a1", "u1", longAgo(1)));
        await storage.insertMessage({ ...streamingAnswer("a2", "u1", longAgo(2)), alive: "now" });
        await storage.insertMessage({ ...streamingAnswer("a3", "u1", longAgo(3)), alive: "now" });
        await storage.updateStreamingMessage("a3", { parts: [], alive: "released" });
        expect(await silent(storage, { silentForMs: minute })).toEqual(["a1", "a3"]);
        expect((await storage.listStreamingMessageIds()).sort()).toEqual(["a1", "a2", "a3"]);
      });

      it("«сейчас» — по часам хранилища: знак стареет со временем; запись без знака знак не стирает", async (context) => {
        const storage = await storageWithChat();
        if (!storage.listSilentAnswerIds) return context.skip();
        await storage.insertMessage(userMessage("u1", longAgo(0)));
        await storage.insertMessage(streamingAnswer("a1", "u1", longAgo(1)));
        await storage.updateStreamingMessage("a1", { parts: [], alive: "now" });
        await storage.updateStreamingMessage("a1", { parts: [{ type: "text", text: "ещё", state: "done" }] });
        expect(await silent(storage, { silentForMs: minute })).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(await silent(storage, { silentForMs: 20 })).toEqual(["a1"]);
      });

      it("только ответы нужного чата, если он задан", async (context) => {
        const storage = await storageWithChat();
        if (!storage.listSilentAnswerIds) return context.skip();
        await storage.createChat({ ...chatInput, id: "chat-2" });
        await storage.insertMessage(userMessage("u1", longAgo(0)));
        await storage.insertMessage(streamingAnswer("a1", "u1", longAgo(1)));
        await storage.insertMessage({ ...userMessage("b1", longAgo(0)), chatId: "chat-2" });
        await storage.insertMessage({ ...streamingAnswer("b2", "b1", longAgo(1)), chatId: "chat-2" });
        expect(await silent(storage, { silentForMs: minute, chatId: "chat-2" })).toEqual(["b2"]);
        expect(await silent(storage, { silentForMs: minute })).toEqual(["a1", "b2"]);
      });

      it("ответ, вернувшийся в работу после подтверждения, получает знак жизни", async (context) => {
        const storage = await storageWithChat();
        if (!storage.listSilentAnswerIds) return context.skip();
        await storage.insertMessage(userMessage("u1", longAgo(0)));
        await storage.insertMessage(streamingAnswer("a1", "u1", longAgo(1)));
        await storage.finishMessage("a1", { status: "awaiting_approval" });
        await storage.updateAwaitingMessage("a1", { parts: [], status: "streaming", alive: "now" });
        expect(await silent(storage, { silentForMs: minute })).toEqual([]);
        expect(await storage.listStreamingMessageIds()).toEqual(["a1"]);
      });

      it("лёгкая отметка «жив» пишет только знак: части и расход прежние; законченный ответ — MessageAlreadyFinishedError", async (context) => {
        const storage = await storageWithChat();
        if (!storage.markAnswerAlive || !storage.listSilentAnswerIds) return context.skip();
        await storage.insertMessage(userMessage("u1", longAgo(0)));
        await storage.insertMessage(streamingAnswer("a1", "u1", longAgo(1)));
        const parts = [{ type: "text" as const, text: "начало", state: "streaming" as const }];
        const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0 };
        await storage.updateStreamingMessage("a1", { parts, usage });
        await storage.markAnswerAlive("a1");
        expect(await silent(storage, { silentForMs: minute })).toEqual([]);
        expect(await storage.getMessage("a1")).toMatchObject({ parts, usage, status: "streaming" });
        await storage.finishMessage("a1", { status: "interrupted" });
        await expect(storage.markAnswerAlive("a1")).rejects.toBeInstanceOf(MessageAlreadyFinishedError);
        await expect(storage.markAnswerAlive("missing")).rejects.toThrow("Сообщения missing нет");
      });

      it("знак жизни не возвращается при чтении", async () => {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", longAgo(0)));
        await storage.insertMessage({ ...streamingAnswer("a1", "u1", longAgo(1)), alive: "now" });
        for (const message of [await storage.getMessage("a1"), (await storage.listMessages(chatInput.id)).find((found) => found.id === "a1")]) {
          expect(message).not.toHaveProperty("alive");
          expect(message).not.toHaveProperty("aliveAt");
        }
      });
    });

    it("сообщения с одинаковым временем создания отдаются в порядке записи", async () => {
      const storage = await storageWithChat();
      const sameTime = "2099-01-01T00:00:00.000Z";
      const ids = ["m5", "m1", "m4", "m2", "m3"];
      for (const id of ids) await storage.insertMessage(userMessage(id, sameTime));
      expect((await storage.listMessages(chatInput.id)).map((message) => message.id)).toEqual(ids);
    });

    it("запись в ответ, которого нет, — ошибка «Сообщения … нет»", async () => {
      const storage = await storageWithChat();
      await expect(storage.updateStreamingMessage("missing", { parts: [] })).rejects.toThrow("Сообщения missing нет");
      await expect(storage.finishMessage("missing", { status: "complete" })).rejects.toThrow("Сообщения missing нет");
    });

    it("чаты не путаются: сообщения и идущие ответы каждого чата свои", async () => {
      const storage = await storageWithChat();
      await storage.createChat({ ...chatInput, id: "chat-2", ownerId: "boris" });
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      await storage.insertMessage({ ...userMessage("b1", "2099-01-01T00:00:00.000Z"), chatId: "chat-2" });
      expect((await storage.listMessages(chatInput.id)).map((message) => message.id)).toEqual(["u1", "a1"]);
      expect((await storage.listMessages("chat-2")).map((message) => message.id)).toEqual(["b1"]);
      expect((await storage.getChat("chat-2"))?.ownerId).toBe("boris");
      expect((await storage.getChat(chatInput.id))?.updatedAt).toBe("2099-01-01T00:00:01.000Z");
      expect((await storage.getChat("chat-2"))?.updatedAt).toBe("2099-01-01T00:00:00.000Z");
      expect(await storage.listStreamingMessageIds()).toEqual(["a1"]);
    });

    it("поля без значения возвращаются как null, а пустые рассуждения — как {}", async () => {
      const storage = await storageWithChat();
      const message = userMessage("u1", "2099-01-01T00:00:00.000Z");
      await storage.insertMessage(message);
      const [saved] = await storage.listMessages(chatInput.id);
      expect(saved).toEqual(message);
      expect(saved?.usage).toBeNull();
      expect(saved?.error).toBeNull();
      expect(saved?.modelId).toBeNull();
      expect(saved?.parentId).toBeNull();
      expect(saved?.reasoningDurationsMs).toEqual({});
    });

    it("очень длинный ответ сохраняется и читается целиком", async () => {
      const storage = await storageWithChat();
      await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
      await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
      const text = "Длинный ответ, «кавычки», \\ обратная косая, эмодзи 🙂. ".repeat(6000);
      await storage.finishMessage("a1", { status: "complete", parts: [{ type: "text", text, state: "done" }] });
      const saved = (await storage.listMessages(chatInput.id)).find((message) => message.id === "a1");
      expect(saved?.parts).toEqual([{ type: "text", text, state: "done" }]);
    });

    it("updateChatModel неизвестного чата ничего не делает", async () => {
      const storage = await storageWithChat();
      await expect(storage.updateChatModel("missing", { modelId: "m", providerId: "p" })).resolves.toBeUndefined();
      expect(await storage.getChat("missing")).toBeNull();
    });

    it("чтение formatVersion больше известной — UnsupportedFormatVersionError, запись не меняется", async () => {
      const storage = await storageWithChat();
      const fromFuture = { ...userMessage("u1", "2099-01-01T00:00:00.000Z"), formatVersion: CURRENT_FORMAT_VERSION + 1 };
      await storage.insertMessage(fromFuture);
      await expect(storage.listMessages(chatInput.id)).rejects.toBeInstanceOf(UnsupportedFormatVersionError);
      await expect(storage.listMessages(chatInput.id)).rejects.toBeInstanceOf(UnsupportedFormatVersionError);
      await expect(storage.insertMessage(fromFuture)).rejects.toBeInstanceOf(DuplicateMessageError);
    });
    describe("список, название и удаление чатов", () => {
      it("у нового чата названия нет; renameChat пишет и стирает его, updatedAt не меняется", async () => {
        const storage = await storageWithChat();
        expect((await storage.getChat(chatInput.id))?.title).toBeUndefined();
        const before = (await storage.getChat(chatInput.id))?.updatedAt;
        await storage.renameChat(chatInput.id, "Отпуск в Греции «2026» 🙂");
        expect(await storage.getChat(chatInput.id)).toMatchObject({ title: "Отпуск в Греции «2026» 🙂", updatedAt: before });
        await storage.renameChat(chatInput.id, null);
        expect((await storage.getChat(chatInput.id))?.title).toBeUndefined();
      });

      it("renameChat неизвестного чата ничего не делает", async () => {
        const storage = await storageWithChat();
        await expect(storage.renameChat("missing", "Название")).resolves.toBeUndefined();
        expect(await storage.getChat("missing")).toBeNull();
      });

      it("listChats отдаёт только чаты владельца, самые недавние первыми", async () => {
        const storage = await createStorage();
        await storage.createChat({ ...chatInput, id: "old" });
        await storage.createChat({ ...chatInput, id: "new" });
        await storage.createChat({ ...chatInput, id: "boris-chat", ownerId: "boris" });
        await storage.insertMessage({ ...userMessage("m-old", "2099-01-01T00:00:01.000Z"), chatId: "old" });
        await storage.insertMessage({ ...userMessage("m-new", "2099-01-01T00:00:05.000Z"), chatId: "new" });
        await storage.insertMessage({ ...userMessage("m-boris", "2099-01-01T00:00:09.000Z"), chatId: "boris-chat" });
        expect((await storage.listChats("anna")).map((chat) => chat.id)).toEqual(["new", "old"]);
        expect((await storage.listChats("boris")).map((chat) => chat.id)).toEqual(["boris-chat"]);
        expect(await storage.listChats("nobody")).toEqual([]);
      });

      it("listChats: переписка поднимает чат, переименование порядок не меняет", async () => {
        const storage = await createStorage();
        await storage.createChat({ ...chatInput, id: "first" });
        await storage.createChat({ ...chatInput, id: "second" });
        await storage.insertMessage({ ...userMessage("m1", "2099-01-01T00:00:01.000Z"), chatId: "first" });
        await storage.insertMessage({ ...userMessage("m2", "2099-01-01T00:00:02.000Z"), chatId: "second" });
        await storage.renameChat("first", "Переименован");
        expect((await storage.listChats("anna")).map((chat) => chat.id)).toEqual(["second", "first"]);
        await storage.insertMessage({ ...userMessage("m3", "2099-01-01T00:00:03.000Z"), chatId: "first" });
        expect((await storage.listChats("anna")).map((chat) => chat.id)).toEqual(["first", "second"]);
        expect((await storage.listChats("anna"))[0]).toMatchObject({ id: "first", title: "Переименован", ownerId: "anna" });
      });

      it("listChats: при равном времени последнего сообщения — по времени создания, затем по id, новее и больше первыми", async () => {
        const storage = await createStorage();
        for (const id of ["b", "a", "c", "d"]) {
          await storage.createChat({ ...chatInput, id });
          await storage.insertMessage({ ...userMessage(`m-${id}`, "2099-01-01T00:00:00.000Z"), chatId: id });
        }
        const listed = await storage.listChats("anna");
        expect(listed).toHaveLength(4);
        const expected = [...listed].sort(
          (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        );
        expect(listed.map((chat) => chat.id)).toEqual(expected.map((chat) => chat.id));
        expect((await storage.listChats("anna")).map((chat) => chat.id)).toEqual(listed.map((chat) => chat.id));
      });

      it("deleteChat удаляет чат, сообщения всех веток, записи сжатия и выбор веток; другие чаты целы", async () => {
        const storage = await storageWithChat();
        await storage.createChat({ ...chatInput, id: "chat-2", ownerId: "boris" });
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        await storage.insertMessage({ ...streamingAnswer("a2", "u1", "2099-01-01T00:00:02.000Z"), status: "complete" });
        await storage.insertCompaction({
          id: "c1",
          chatId: chatInput.id,
          fromMessageId: "u1",
          throughMessageId: "a1",
          summary: "сводка",
          summaryTokens: 1,
          modelId: "m",
          providerId: "p",
          usage: null,
          createdAt: "2099-01-01T00:00:10.000Z",
        });
        await storage.insertBranchSelection({ id: "s1", chatId: chatInput.id, messageId: "a2", selectedAt: "2099-01-01T00:00:11.000Z" });
        await storage.insertMessage({ ...userMessage("b1", "2099-01-01T00:00:00.000Z"), chatId: "chat-2" });
        await storage.insertBranchSelection({ id: "s2", chatId: "chat-2", messageId: "b1", selectedAt: "2099-01-01T00:00:11.000Z" });
        await storage.insertCompaction({
          id: "c2",
          chatId: "chat-2",
          fromMessageId: "b1",
          throughMessageId: "b1",
          summary: "чужая сводка",
          summaryTokens: 1,
          modelId: "m",
          providerId: "p",
          usage: null,
          createdAt: "2099-01-01T00:00:10.000Z",
        });

        await storage.deleteChat(chatInput.id);

        expect(await storage.getChat(chatInput.id)).toBeNull();
        expect(await storage.listMessages(chatInput.id)).toEqual([]);
        expect(await storage.listMessageLinks(chatInput.id)).toEqual([]);
        expect(await storage.listCompactions(chatInput.id)).toEqual([]);
        expect(await storage.listBranchSelections(chatInput.id)).toEqual([]);
        expect((await storage.listChats("anna")).map((chat) => chat.id)).toEqual([]);
        expect(await storage.listStreamingMessageIds()).toEqual([]);
        expect((await storage.listMessages("chat-2")).map((message) => message.id)).toEqual(["b1"]);
        expect((await storage.listCompactions("chat-2")).map((record) => record.id)).toEqual(["c2"]);
        expect((await storage.listBranchSelections("chat-2")).map((record) => record.id)).toEqual(["s2"]);
        expect(await storage.getChat("chat-2")).not.toBeNull();
      });

      it("deleteChat неизвестного чата ничего не делает; удалённый id можно занять снова", async () => {
        const storage = await storageWithChat();
        await expect(storage.deleteChat("missing")).resolves.toBeUndefined();
        expect(await storage.getChat(chatInput.id)).not.toBeNull();
        await storage.deleteChat(chatInput.id);
        await storage.deleteChat(chatInput.id);
        await storage.createChat(chatInput);
        expect(await storage.listMessages(chatInput.id)).toEqual([]);
      });

      it("после удаления запись в сообщения удалённого чата не появляется тихо: чата нет", async () => {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        await storage.deleteChat(chatInput.id);
        await expect(storage.updateStreamingMessage("a1", { parts: [] })).rejects.toThrow("Сообщения a1 нет");
      });
    });

    describe("записи сжатия", () => {
      function compaction(id: string, extra: Partial<StoredCompaction> = {}): StoredCompaction {
        return {
          id,
          chatId: chatInput.id,
          fromMessageId: "u1",
          throughMessageId: "a1",
          summary: `## Цель\nсводка ${id} «в кавычках» 🙂`,
          summaryTokens: 321,
          modelId: "deepseek-4.1-flash",
          providerId: "deepseek",
          usage: { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 400, reasoningTokens: 79, contextTokens: 1400 },
          createdAt: "2099-01-01T00:00:10.000Z",
          ...extra,
        };
      }

      it("insertCompaction и listCompactions возвращают запись как записана; у чата без сжатий — пусто", async () => {
        const storage = await storageWithChat();
        expect(await storage.listCompactions(chatInput.id)).toEqual([]);
        expect(await storage.listCompactions("missing")).toEqual([]);
        await storage.insertCompaction(compaction("c1"));
        expect(await storage.listCompactions(chatInput.id)).toEqual([compaction("c1")]);
      });

      it("записи отдаются в порядке добавления, даже при одинаковом или обратном времени", async () => {
        const storage = await storageWithChat();
        await storage.insertCompaction(compaction("c2", { createdAt: "2099-01-01T00:00:10.000Z" }));
        await storage.insertCompaction(compaction("c1", { createdAt: "2099-01-01T00:00:10.000Z" }));
        await storage.insertCompaction(compaction("c3", { createdAt: "2099-01-01T00:00:05.000Z" }));
        expect((await storage.listCompactions(chatInput.id)).map((record) => record.id)).toEqual(["c2", "c1", "c3"]);
      });

      it("расход на сжатие может быть пустым", async () => {
        const storage = await storageWithChat();
        await storage.insertCompaction(compaction("c1", { usage: null }));
        expect((await storage.listCompactions(chatInput.id))[0]?.usage).toBeNull();
      });

      it("записи чатов не путаются", async () => {
        const storage = await storageWithChat();
        await storage.createChat({ ...chatInput, id: "chat-2", ownerId: "boris" });
        await storage.insertCompaction(compaction("c1"));
        await storage.insertCompaction(compaction("c2", { chatId: "chat-2" }));
        expect((await storage.listCompactions(chatInput.id)).map((record) => record.id)).toEqual(["c1"]);
        expect((await storage.listCompactions("chat-2")).map((record) => record.id)).toEqual(["c2"]);
      });

      it("повтор id записи — ошибка, прежняя запись не меняется", async () => {
        const storage = await storageWithChat();
        await storage.insertCompaction(compaction("c1"));
        await expect(storage.insertCompaction(compaction("c1", { summary: "другая" }))).rejects.toThrow();
        expect(await storage.listCompactions(chatInput.id)).toEqual([compaction("c1")]);
      });

      it("сжатие не трогает оригиналы сообщений и время обновления чата", async () => {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        const before = await storage.listMessages(chatInput.id);
        const updatedAt = (await storage.getChat(chatInput.id))?.updatedAt;
        await storage.insertCompaction(compaction("c1"));
        expect(await storage.listMessages(chatInput.id)).toEqual(before);
        expect((await storage.getChat(chatInput.id))?.updatedAt).toBe(updatedAt);
      });

      it("итог ответа хранит contextTokens", async () => {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0, contextTokens: 15 };
        await storage.finishMessage("a1", { status: "complete", usage });
        expect((await storage.listMessages(chatInput.id)).find((message) => message.id === "a1")?.usage).toEqual(usage);
      });

      it("идущий ответ хранит расход хода с пометкой «примерно»", async () => {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        const usage = { inputTokens: 300, cachedInputTokens: 0, outputTokens: 40, reasoningTokens: 0, contextTokens: 340, estimated: true as const };
        await storage.updateStreamingMessage("a1", { parts: [], usage });
        expect((await storage.getMessage("a1"))?.usage).toEqual(usage);
      });
    });

    describe("выбор ветки", () => {
      function selection(id: string, extra: Partial<StoredBranchSelection> = {}): StoredBranchSelection {
        return { id, chatId: chatInput.id, messageId: "a1", selectedAt: "2099-01-01T00:00:10.000Z", ...extra };
      }

      it("insertBranchSelection и listBranchSelections возвращают запись как записана; у чата без выбора — пусто", async () => {
        const storage = await storageWithChat();
        expect(await storage.listBranchSelections(chatInput.id)).toEqual([]);
        expect(await storage.listBranchSelections("missing")).toEqual([]);
        await storage.insertBranchSelection(selection("s1"));
        expect(await storage.listBranchSelections(chatInput.id)).toEqual([selection("s1")]);
      });

      it("записи отдаются в порядке добавления, даже при одинаковом или обратном времени", async () => {
        const storage = await storageWithChat();
        await storage.insertBranchSelection(selection("s2", { selectedAt: "2099-01-01T00:00:10.000Z" }));
        await storage.insertBranchSelection(selection("s1", { selectedAt: "2099-01-01T00:00:10.000Z" }));
        await storage.insertBranchSelection(selection("s3", { selectedAt: "2099-01-01T00:00:05.000Z" }));
        expect((await storage.listBranchSelections(chatInput.id)).map((record) => record.id)).toEqual(["s2", "s1", "s3"]);
      });

      it("записи чатов не путаются", async () => {
        const storage = await storageWithChat();
        await storage.createChat({ ...chatInput, id: "chat-2", ownerId: "boris" });
        await storage.insertBranchSelection(selection("s1"));
        await storage.insertBranchSelection(selection("s2", { chatId: "chat-2" }));
        expect((await storage.listBranchSelections(chatInput.id)).map((record) => record.id)).toEqual(["s1"]);
        expect((await storage.listBranchSelections("chat-2")).map((record) => record.id)).toEqual(["s2"]);
      });

      it("повтор id записи — ошибка, прежняя запись не меняется", async () => {
        const storage = await storageWithChat();
        await storage.insertBranchSelection(selection("s1"));
        await expect(storage.insertBranchSelection(selection("s1", { messageId: "другое" }))).rejects.toThrow();
        expect(await storage.listBranchSelections(chatInput.id)).toEqual([selection("s1")]);
      });

      it("выбор не меняет ни сообщения, ни записи сжатия, ни время обновления чата", async () => {
        const storage = await storageWithChat();
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        await storage.insertCompaction({
          id: "c1",
          chatId: chatInput.id,
          fromMessageId: "u1",
          throughMessageId: "a1",
          summary: "сводка",
          summaryTokens: 5,
          modelId: "deepseek-4.1-flash",
          providerId: "deepseek",
          usage: null,
          createdAt: "2099-01-01T00:00:05.000Z",
        });
        const messagesBefore = await storage.listMessages(chatInput.id);
        const compactionsBefore = await storage.listCompactions(chatInput.id);
        const updatedAt = (await storage.getChat(chatInput.id))?.updatedAt;
        await storage.insertBranchSelection(selection("s1"));
        expect(await storage.listMessages(chatInput.id)).toEqual(messagesBefore);
        expect(await storage.listCompactions(chatInput.id)).toEqual(compactionsBefore);
        expect((await storage.getChat(chatInput.id))?.updatedAt).toBe(updatedAt);
      });
    });
    describe("записи расхода", () => {
      function usageRecord(id: string, fields: Partial<UsageRecord> = {}): UsageRecord {
        return {
          id,
          ownerId: "anna",
          chatId: chatInput.id,
          messageId: `a-${id}`,
          source: "answer",
          modelId: "deepseek-4.1-flash",
          providerId: "deepseek",
          inputTokens: 1000,
          cachedInputTokens: 400,
          cacheWriteTokens: 0,
          outputTokens: 200,
          reasoningTokens: 50,
          costUsd: 0.25,
          createdAt: "2099-01-15T10:00:00.000Z",
          ...fields,
        };
      }

      it("пустой расход — пустая сумма", async () => {
        const storage = await storageWithChat();
        expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
      });

      it("суммирует токены записей одной пары «модель × провайдер»", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1"));
        await storage.insertUsageRecord(usageRecord("r2", { inputTokens: 500, cacheWriteTokens: 30, source: "compaction", messageId: null }));
        expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([
          {
            modelId: "deepseek-4.1-flash",
            providerId: "deepseek",
            inputTokens: 1500,
            cachedInputTokens: 800,
            cacheWriteTokens: 30,
            outputTokens: 400,
            reasoningTokens: 100,
            costUsd: 0.5,
          },
        ]);
      });

      it("запись «примерно» принимается и считается в сумме вместе с остальными", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1"));
        await storage.insertUsageRecord(usageRecord("r2", { estimated: true, inputTokens: 300 }));
        expect((await storage.sumUsage({ ownerId: "anna" }))[0]?.inputTokens).toBe(1300);
      });

      it("деньги суммируются из записей: цена на момент расхода, а не пересчёт по токенам", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1", { costUsd: 0.1 }));
        await storage.insertUsageRecord(usageRecord("r2", { costUsd: 0.2, inputTokens: 0, outputTokens: 0 }));
        await storage.insertUsageRecord(usageRecord("r3", { costUsd: 0 }));
        const [sum] = await storage.sumUsage({ ownerId: "anna" });
        expect(sum?.costUsd).toBeCloseTo(0.3, 12);
      });

      it("разные пары «модель × провайдер» суммируются отдельно", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1"));
        await storage.insertUsageRecord(usageRecord("r2", { providerId: "openrouter" }));
        const sums = await storage.sumUsage({ ownerId: "anna" });
        expect(sums.map((sum) => sum.providerId).sort()).toEqual(["deepseek", "openrouter"]);
      });

      it("фильтр по владельцу и по чату", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1"));
        await storage.insertUsageRecord(usageRecord("r2", { chatId: "chat-2", outputTokens: 7 }));
        await storage.insertUsageRecord(usageRecord("r3", { ownerId: "boris", chatId: "chat-3", outputTokens: 11 }));
        expect((await storage.sumUsage({ ownerId: "anna" }))[0]?.outputTokens).toBe(207);
        expect((await storage.sumUsage({ chatId: "chat-2" }))[0]?.outputTokens).toBe(7);
        expect((await storage.sumUsage({ ownerId: "boris" }))[0]?.outputTokens).toBe(11);
        expect((await storage.sumUsage({ ownerId: "anna", chatId: "chat-3" }))).toEqual([]);
        expect(await storage.sumUsage({ ownerId: "nobody" })).toEqual([]);
      });

      it("фильтр по сообщению и источнику: только расход ответа этого сообщения", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1", { messageId: "m1", outputTokens: 1 }));
        await storage.insertUsageRecord(usageRecord("r2", { messageId: "m1", outputTokens: 10 }));
        await storage.insertUsageRecord(usageRecord("r3", { messageId: "m2", outputTokens: 100 }));
        await storage.insertUsageRecord(usageRecord("r4", { messageId: "m1", source: "speech", outputTokens: 1000 }));
        expect((await storage.sumUsage({ chatId: "chat-1", messageId: "m1", source: "answer" }))[0]?.outputTokens).toBe(11);
        expect((await storage.sumUsage({ messageId: "m1" }))[0]?.outputTokens).toBe(1011);
        expect(await storage.sumUsage({ messageId: "m3" })).toEqual([]);
      });

      it("«since» включает границу и отсекает более раннее", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1", { createdAt: "2099-01-31T23:59:59.999Z", outputTokens: 1 }));
        await storage.insertUsageRecord(usageRecord("r2", { createdAt: "2099-02-01T00:00:00.000Z", outputTokens: 10 }));
        await storage.insertUsageRecord(usageRecord("r3", { createdAt: "2099-02-10T00:00:00.000Z", outputTokens: 100 }));
        expect((await storage.sumUsage({ ownerId: "anna", since: "2099-02-01T00:00:00.000Z" }))[0]?.outputTokens).toBe(110);
        expect((await storage.sumUsage({ ownerId: "anna" }))[0]?.outputTokens).toBe(111);
      });

      it("повтор id — ошибка, сумма не меняется", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(usageRecord("r1"));
        await expect(storage.insertUsageRecord(usageRecord("r1", { outputTokens: 999 }))).rejects.toThrow();
        expect((await storage.sumUsage({ ownerId: "anna" }))[0]?.outputTokens).toBe(200);
      });

      it("поиск записи расхода по id: есть — true, нет — false", async (context) => {
        const storage = await createStorage();
        if (!storage.hasUsageRecord) return context.skip();
        expect(await storage.hasUsageRecord("r1")).toBe(false);
        await storage.insertUsageRecord(usageRecord("r1", { chatId: "deleted-chat" }));
        expect(await storage.hasUsageRecord("r1")).toBe(true);
        expect(await storage.hasUsageRecord("r2")).toBe(false);
      });

      it("запись не требует чата и не меняет время его обновления", async () => {
        const storage = await createStorage();
        await storage.insertUsageRecord(usageRecord("r1", { chatId: "deleted-chat" }));
        expect((await storage.sumUsage({ chatId: "deleted-chat" }))[0]?.inputTokens).toBe(1000);
        await storage.createChat(chatInput);
        const updatedAt = (await storage.getChat(chatInput.id))?.updatedAt;
        await storage.insertUsageRecord(usageRecord("r2"));
        expect((await storage.getChat(chatInput.id))?.updatedAt).toBe(updatedAt);
      });

      it("десять записей одновременно дают точную сумму", async () => {
        const storage = await storageWithChat();
        await Promise.all(Array.from({ length: 10 }, (_, index) => storage.insertUsageRecord(usageRecord(`p${index}`, { outputTokens: 3 }))));
        expect((await storage.sumUsage({ ownerId: "anna" }))[0]?.outputTokens).toBe(30);
      });
    });

    describe("озвучка в расходах (source: speech)", () => {
      function speechRecord(id: string, fields: Partial<UsageRecord> = {}): UsageRecord {
        return {
          id,
          ownerId: "anna",
          chatId: chatInput.id,
          messageId: `a-${id}`,
          source: "speech",
          modelId: "eleven_v4_turbo",
          providerId: "elevenlabs",
          inputTokens: 200,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costUsd: 0.012,
          createdAt: "2099-01-15T10:00:00.000Z",
          ...fields,
        };
      }

      it("запись озвучки сохраняется и суммируется отдельной парой «модель × провайдер»", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(speechRecord("s1"));
        await storage.insertUsageRecord(speechRecord("s2", { inputTokens: 300, costUsd: 0.018 }));
        const [sum] = await storage.sumUsage({ ownerId: "anna" });
        expect(sum).toMatchObject({ modelId: "eleven_v4_turbo", providerId: "elevenlabs", inputTokens: 500, outputTokens: 0 });
        expect(sum!.costUsd).toBeCloseTo(0.03, 10);
      });

      it("озвучка приближает лимит: сумма денег включает и ответы, и озвучку", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord({
          id: "answer-1",
          ownerId: "anna",
          chatId: chatInput.id,
          messageId: "a-1",
          source: "answer",
          modelId: "deepseek-4.1-flash",
          providerId: "deepseek",
          inputTokens: 1000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 100,
          reasoningTokens: 0,
          costUsd: 0.25,
          createdAt: "2099-01-15T09:00:00.000Z",
        });
        const before = (await storage.sumUsage({ ownerId: "anna" })).reduce((total, sum) => total + sum.costUsd, 0);
        await storage.insertUsageRecord(speechRecord("s1", { costUsd: 0.1 }));
        const after = (await storage.sumUsage({ ownerId: "anna" })).reduce((total, sum) => total + sum.costUsd, 0);
        expect(after - before).toBeCloseTo(0.1, 10);
      });

      it("озвучка чужого человека в сумму не попадает", async () => {
        const storage = await storageWithChat();
        await storage.insertUsageRecord(speechRecord("s1", { ownerId: "boris" }));
        expect(await storage.sumUsage({ ownerId: "anna" })).toEqual([]);
      });
    });

    describe("чаты объектов (необязательные методы)", () => {
      type SubjectStorage = ChatStorage & Required<Pick<ChatStorage, "findChatBySubject">>;

      /** Хранилище без `findChatBySubject` договор не нарушает: ядро тогда не включает чаты объектов и говорит об этом при старте. */
      async function subjectStorage(context: { skip: () => never }): Promise<SubjectStorage> {
        const storage = await createStorage();
        if (!storage.findChatBySubject) {
          if (options.subjectChats === "required") throw new Error("У хранилища нет чатов объектов");
          context.skip();
        }
        return storage as SubjectStorage;
      }

      const lessonData = { lesson: { id: 7, title: "Дроби", tags: ["математика", "5 класс"] }, open: true, score: null };

      it("ключ и данные объекта пишутся и читаются; чат без ключа — без этих полей", async (context) => {
        const storage = await subjectStorage(context);
        const created = await storage.createChat({ ...chatInput, id: "lesson-chat", subjectKey: "lesson:7", subjectData: lessonData });
        expect(created).toMatchObject({ subjectKey: "lesson:7", subjectData: lessonData });
        expect(await storage.getChat("lesson-chat")).toMatchObject({ subjectKey: "lesson:7", subjectData: lessonData });

        await storage.createChat({ ...chatInput, id: "plain" });
        const plain = await storage.getChat("plain");
        expect(plain).not.toHaveProperty("subjectKey");
        expect(plain).not.toHaveProperty("subjectData");
      });

      it("ключ без данных: subjectData нет", async (context) => {
        const storage = await subjectStorage(context);
        await storage.createChat({ ...chatInput, id: "lesson-chat", subjectKey: "lesson:7" });
        const chat = await storage.getChat("lesson-chat");
        expect(chat?.subjectKey).toBe("lesson:7");
        expect(chat).not.toHaveProperty("subjectData");
      });

      it("findChatBySubject находит чат владельца по ключу; чужой владелец и неизвестный ключ — null", async (context) => {
        const storage = await subjectStorage(context);
        await storage.createChat({ ...chatInput, id: "lesson-chat", subjectKey: "lesson:7", subjectData: lessonData });
        expect(await storage.findChatBySubject(chatInput.ownerId, "lesson:7")).toMatchObject({ id: "lesson-chat", subjectData: lessonData });
        expect(await storage.findChatBySubject("boris", "lesson:7")).toBeNull();
        expect(await storage.findChatBySubject(chatInput.ownerId, "lesson:8")).toBeNull();
      });

      it("повтор ключа у того же владельца — DuplicateChatSubjectError, второй чат не записан; у другого владельца — можно", async (context) => {
        const storage = await subjectStorage(context);
        await storage.createChat({ ...chatInput, id: "first", subjectKey: "lesson:7" });
        await expect(storage.createChat({ ...chatInput, id: "second", subjectKey: "lesson:7" })).rejects.toBeInstanceOf(DuplicateChatSubjectError);
        expect(await storage.getChat("second")).toBeNull();
        expect((await storage.findChatBySubject(chatInput.ownerId, "lesson:7"))?.id).toBe("first");

        await storage.createChat({ ...chatInput, id: "boris-chat", ownerId: "boris", subjectKey: "lesson:7" });
        expect((await storage.findChatBySubject("boris", "lesson:7"))?.id).toBe("boris-chat");
      });

      it("чатов без ключа у владельца может быть сколько угодно", async (context) => {
        const storage = await subjectStorage(context);
        for (const id of ["a", "b", "c"]) await storage.createChat({ ...chatInput, id });
        expect(await storage.listChats(chatInput.ownerId)).toHaveLength(3);
      });

      it("удаление чата освобождает ключ", async (context) => {
        const storage = await subjectStorage(context);
        await storage.createChat({ ...chatInput, id: "first", subjectKey: "lesson:7" });
        await storage.deleteChat("first");
        expect(await storage.findChatBySubject(chatInput.ownerId, "lesson:7")).toBeNull();
        await storage.createChat({ ...chatInput, id: "again", subjectKey: "lesson:7" });
        expect((await storage.findChatBySubject(chatInput.ownerId, "lesson:7"))?.id).toBe("again");
      });

      it("listChats: по умолчанию и с exclude — без чатов с ключом; include — все; only — только с ключом; порядок прежний", async (context) => {
        const storage = await subjectStorage(context);
        await storage.createChat({ ...chatInput, id: "plain-old" });
        await storage.createChat({ ...chatInput, id: "lesson-old", subjectKey: "lesson:1" });
        await storage.createChat({ ...chatInput, id: "plain-new" });
        await storage.createChat({ ...chatInput, id: "lesson-new", subjectKey: "lesson:2" });
        await storage.createChat({ ...chatInput, id: "boris-lesson", ownerId: "boris", subjectKey: "lesson:1" });
        const touch = async (chatId: string, at: string) => storage.insertMessage({ ...userMessage(`m-${chatId}`, at), chatId });
        await touch("plain-old", "2099-01-01T00:00:01.000Z");
        await touch("lesson-old", "2099-01-01T00:00:02.000Z");
        await touch("plain-new", "2099-01-01T00:00:03.000Z");
        await touch("lesson-new", "2099-01-01T00:00:04.000Z");

        const ids = async (subjects?: "exclude" | "include" | "only") =>
          (await storage.listChats(chatInput.ownerId, subjects ? { subjects } : undefined)).map((chat) => chat.id);
        expect(await ids()).toEqual(["plain-new", "plain-old"]);
        expect(await ids("exclude")).toEqual(["plain-new", "plain-old"]);
        expect(await ids("include")).toEqual(["lesson-new", "plain-new", "lesson-old", "plain-old"]);
        expect(await ids("only")).toEqual(["lesson-new", "lesson-old"]);
        expect((await storage.listChats(chatInput.ownerId, { subjects: "only" }))[0]?.subjectKey).toBe("lesson:2");
      });

      it("createChat с названием и датой: дата создания и обновления — заданная, название — заданное", async (context) => {
        const storage = await subjectStorage(context);
        const createdAt = "2024-03-05T10:20:30.000Z";
        const created = await storage.createChat({ ...chatInput, id: "dated", title: "Урок 7. Дроби", createdAt });
        expect(created).toMatchObject({ title: "Урок 7. Дроби", createdAt, updatedAt: createdAt });
        expect(await storage.getChat("dated")).toMatchObject({ title: "Урок 7. Дроби", createdAt, updatedAt: createdAt });
      });

      it("данные объекта — копия: правка отданного объекта хранилище не меняет", async (context) => {
        const storage = await subjectStorage(context);
        const data = structuredClone(lessonData);
        await storage.createChat({ ...chatInput, id: "lesson-chat", subjectKey: "lesson:7", subjectData: data });
        data.lesson.tags.push("лишнее");
        const read = await storage.getChat("lesson-chat");
        (read?.subjectData as typeof lessonData).lesson.tags.push("ещё");
        expect((await storage.getChat("lesson-chat"))?.subjectData).toEqual(lessonData);
      });
    });

    describe("данные чата (data, updateChatData, фильтр data в listChats; необязательные)", () => {
      type ChatDataStorage = ChatStorage & Required<Pick<ChatStorage, "updateChatData">>;

      /** Хранилище без `updateChatData` договор не нарушает: ядро тогда данных чата не обещает. */
      async function chatDataStorage(context: { skip: () => never }): Promise<ChatDataStorage> {
        const storage = await createStorage();
        if (!storage.updateChatData) {
          if (options.chatData === "required") throw new Error("У хранилища нет данных чата");
          context.skip();
        }
        return storage as ChatDataStorage;
      }

      const maxBytes = 16 * 1024;
      const formData = { formId: "f1", mode: "test", attempts: 3, vip: true, utm: { campaign: "autumn" } };

      it("data у обычного чата пишется и читается; subjectData — тот же объект; чат без данных — без обоих полей", async (context) => {
        const storage = await chatDataStorage(context);
        const created = await storage.createChat({ ...chatInput, id: "with-data", data: formData });
        expect(created).toMatchObject({ data: formData, subjectData: formData });
        expect(created).not.toHaveProperty("subjectKey");
        expect(await storage.getChat("with-data")).toMatchObject({ data: formData, subjectData: formData });

        await storage.createChat({ ...chatInput, id: "plain" });
        const plain = await storage.getChat("plain");
        expect(plain).not.toHaveProperty("data");
        expect(plain).not.toHaveProperty("subjectData");
      });

      it("старый код: subjectData на входе читается и как data", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "old-style", subjectKey: "lesson:7", subjectData: formData });
        expect(await storage.getChat("old-style")).toMatchObject({ data: formData, subjectData: formData });
      });

      it("data — копия: правка отданного и прочитанного объекта хранилище не меняет", async (context) => {
        const storage = await chatDataStorage(context);
        const data = structuredClone(formData);
        await storage.createChat({ ...chatInput, id: "copy", data });
        data.utm.campaign = "правка";
        const read = await storage.getChat("copy");
        (read?.data as typeof formData).utm.campaign = "ещё правка";
        expect((await storage.getChat("copy"))?.data).toEqual(formData);
      });

      it("updateChatData сливает верхние ключи: новые добавляются, старые заменяются целиком, прочие остаются", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "merge", data: formData });
        const updated = await storage.updateChatData("merge", { mode: "live", utm: { source: "tg" }, extra: [1, 2] }, { maxBytes });
        const expected = { formId: "f1", mode: "live", attempts: 3, vip: true, utm: { source: "tg" }, extra: [1, 2] };
        expect(updated).toMatchObject({ id: "merge", data: expected, subjectData: expected });
        expect((await storage.getChat("merge"))?.data).toEqual(expected);
      });

      it("updateChatData у чата без данных создаёт их", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "empty" });
        await storage.updateChatData("empty", { source: "telegram" }, { maxBytes });
        expect((await storage.getChat("empty"))?.data).toEqual({ source: "telegram" });
      });

      it("ключ со значением undefined удаляется; null остаётся значением; не осталось ключей — данных нет", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "drop", data: { a: 1, b: 2 } });
        await storage.updateChatData("drop", { a: undefined, c: null }, { maxBytes });
        expect((await storage.getChat("drop"))?.data).toEqual({ b: 2, c: null });
        await storage.updateChatData("drop", { b: undefined, c: undefined }, { maxBytes });
        const emptied = await storage.getChat("drop");
        expect(emptied).not.toHaveProperty("data");
        expect(emptied).not.toHaveProperty("subjectData");
      });

      it("updateChatData: нет такого чата — null; дата обновления чата не меняется", async (context) => {
        const storage = await chatDataStorage(context);
        expect(await storage.updateChatData("missing", { a: 1 }, { maxBytes })).toBeNull();
        const created = await storage.createChat({ ...chatInput, id: "stay", createdAt: "2024-01-01T00:00:00.000Z" });
        await storage.updateChatData("stay", { a: 1 }, { maxBytes });
        expect((await storage.getChat("stay"))?.updatedAt).toBe(created.updatedAt);
      });

      it("итог больше предела — ChatDataTooLargeError, данные не изменены", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "big", data: { keep: "x".repeat(60) } });
        await expect(storage.updateChatData("big", { more: "y".repeat(60) }, { maxBytes: 100 })).rejects.toBeInstanceOf(ChatDataTooLargeError);
        expect((await storage.getChat("big"))?.data).toEqual({ keep: "x".repeat(60) });
      });

      it("ключ __proto__ в правке или в фильтре — TypeError, данные не изменены: молча он не теряется", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "proto", data: { keep: 1 } });
        const withProto = JSON.parse('{"__proto__":{"admin":true},"other":2}') as Record<string, unknown>;
        await expect(storage.updateChatData("proto", withProto, { maxBytes })).rejects.toBeInstanceOf(TypeError);
        expect((await storage.getChat("proto"))?.data).toEqual({ keep: 1 });
        await expect(storage.listChats(chatInput.ownerId, { data: JSON.parse('{"__proto__":1}') as never })).rejects.toBeInstanceOf(TypeError);
      });

      it("символ NUL (\\u0000) в ключе или значении правки и фильтра — TypeError, данные не изменены, список цел", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "nul", data: { keep: 1 } });
        await expect(storage.updateChatData("nul", { note: "a\u0000b" }, { maxBytes })).rejects.toBeInstanceOf(TypeError);
        await expect(storage.updateChatData("nul", { nested: { ["k\u0000"]: 1 } }, { maxBytes })).rejects.toBeInstanceOf(TypeError);
        await expect(storage.updateChatData("nul", { list: ["ok", "\u0000"] }, { maxBytes })).rejects.toBeInstanceOf(TypeError);
        expect((await storage.getChat("nul"))?.data).toEqual({ keep: 1 });
        await expect(storage.listChats(chatInput.ownerId, { data: { keep: "\u0000" } })).rejects.toBeInstanceOf(TypeError);
        await expect(storage.listChats(chatInput.ownerId, { data: { ["k\u0000"]: 1 } })).rejects.toBeInstanceOf(TypeError);
        expect((await storage.listChats(chatInput.ownerId, { data: { keep: 1 } })).map((chat) => chat.id)).toEqual(["nul"]);
      });

      it("одновременные правки разных ключей не затирают друг друга", async (context) => {
        const storage = await chatDataStorage(context);
        await storage.createChat({ ...chatInput, id: "race", data: { start: true } });
        await Promise.all(Array.from({ length: 10 }, (_, index) => storage.updateChatData("race", { [`key${index}`]: index }, { maxBytes })));
        const data = (await storage.getChat("race"))?.data as Record<string, unknown>;
        expect(Object.keys(data).sort()).toEqual(["start", ...Array.from({ length: 10 }, (_, index) => `key${index}`)].sort());
      });

      describe("фильтр data в listChats", () => {
        async function filled(context: { skip: () => never }) {
          const storage = await chatDataStorage(context);
          await storage.createChat({ ...chatInput, id: "test-1", createdAt: "2024-01-01T00:00:00.000Z", data: { formId: "f1", mode: "test", n: 1, flag: true, none: null } });
          await storage.createChat({ ...chatInput, id: "test-2", createdAt: "2024-01-02T00:00:00.000Z", data: { formId: "f1", mode: "test", n: 2, flag: false } });
          await storage.createChat({ ...chatInput, id: "live-1", createdAt: "2024-01-03T00:00:00.000Z", data: { formId: "f1", mode: "live" } });
          await storage.createChat({ ...chatInput, id: "other-form", createdAt: "2024-01-04T00:00:00.000Z", data: { formId: "f2", mode: "test" } });
          await storage.createChat({ ...chatInput, id: "no-data", createdAt: "2024-01-05T00:00:00.000Z" });
          await storage.createChat({ ...chatInput, id: "boris-test", ownerId: "boris", createdAt: "2024-01-06T00:00:00.000Z", data: { formId: "f1", mode: "test" } });
          const ids = async (data: ChatDataFilter, extra: { subjects?: "include" | "only" | "exclude" } = {}) =>
            (await storage.listChats(chatInput.ownerId, { data, ...extra })).map((chat) => chat.id);
          return { storage, ids };
        }

        it("равенство одного ключа; чат без данных и чужой владелец не попадают; порядок обычный", async (context) => {
          const { ids } = await filled(context);
          expect(await ids({ formId: "f1" })).toEqual(["live-1", "test-2", "test-1"]);
          expect(await ids({ mode: "test" })).toEqual(["other-form", "test-2", "test-1"]);
        });

        it("несколько ключей — все должны совпасть", async (context) => {
          const { ids } = await filled(context);
          expect(await ids({ formId: "f1", mode: "test" })).toEqual(["test-2", "test-1"]);
          expect(await ids({ formId: "f2", mode: "live" })).toEqual([]);
        });

        it("тип значения важен: число не равно строке, true не равно 1, null не равен отсутствию ключа", async (context) => {
          const { ids } = await filled(context);
          expect(await ids({ n: 1 })).toEqual(["test-1"]);
          expect(await ids({ n: "1" })).toEqual([]);
          expect(await ids({ flag: true })).toEqual(["test-1"]);
          expect(await ids({ flag: false })).toEqual(["test-2"]);
          expect(await ids({ flag: 1 })).toEqual([]);
          expect(await ids({ none: null })).toEqual(["test-1"]);
        });

        it("пустой фильтр — как без фильтра по данным", async (context) => {
          const { ids } = await filled(context);
          expect(await ids({})).toEqual(["no-data", "other-form", "live-1", "test-2", "test-1"]);
        });

        it("работает вместе с subjects: чаты с ключом объекта по умолчанию скрыты", async (context) => {
          const { storage, ids } = await filled(context);
          await storage.createChat({ ...chatInput, id: "subject-test", subjectKey: "form:1", data: { formId: "f1", mode: "test" } });
          expect(await ids({ formId: "f1", mode: "test" })).toEqual(["test-2", "test-1"]);
          expect(await ids({ formId: "f1", mode: "test" }, { subjects: "include" })).toContain("subject-test");
          expect(await ids({ formId: "f1", mode: "test" }, { subjects: "only" })).toEqual(["subject-test"]);
        });

        it("значение-объект или массив в фильтре — TypeError: равенство только для строки, числа, булева и null", async (context) => {
          const { storage } = await filled(context);
          await expect(storage.listChats(chatInput.ownerId, { data: { utm: { campaign: "a" } } as never })).rejects.toBeInstanceOf(TypeError);
          await expect(storage.listChats(chatInput.ownerId, { data: { tags: ["a"] } as never })).rejects.toBeInstanceOf(TypeError);
        });

        it("ключ с точкой, кавычкой и пробелом ищется как есть", async (context) => {
          const storage = await chatDataStorage(context);
          await storage.createChat({ ...chatInput, id: "odd-keys", data: { "a.b": 1, 'q"uote': 2, "with space": 3 } });
          await storage.createChat({ ...chatInput, id: "nested", data: { a: { b: 1 } } });
          for (const filter of [{ "a.b": 1 }, { 'q"uote': 2 }, { "with space": 3 }] as ChatDataFilter[]) {
            expect((await storage.listChats(chatInput.ownerId, { data: filter })).map((chat) => chat.id)).toEqual(["odd-keys"]);
          }
        });

        it("после updateChatData чат находится по новому значению, а по старому — нет", async (context) => {
          const { storage, ids } = await filled(context);
          await storage.updateChatData("live-1", { mode: "test" }, { maxBytes });
          expect(await ids({ formId: "f1", mode: "test" })).toEqual(["live-1", "test-2", "test-1"]);
          expect(await ids({ mode: "live" })).toEqual([]);
        });
      });

      it("importChat переносит данные чата", async (context) => {
        const storage = await chatDataStorage(context);
        if (!storage.importChat) context.skip();
        const at = "2023-01-01T09:00:00.000Z";
        await storage.importChat!(
          { ...chatInput, id: "imported-data", createdAt: at, updatedAt: at, data: formData },
          [newStoredMessage({ id: "i1", chatId: "imported-data", role: "user", parts: [{ type: "text", text: "Привет" }], createdAt: at })],
        );
        expect(await storage.getChat("imported-data")).toMatchObject({ data: formData, subjectData: formData });
      });
    });

    describe("перенос чата целиком (importChat, необязательный)", () => {
      type ImportStorage = ChatStorage & Required<Pick<ChatStorage, "importChat">>;

      async function importStorage(context: { skip: () => never }): Promise<ImportStorage> {
        const storage = await createStorage();
        if (!storage.importChat) {
          if (options.importChat === "required") throw new Error("У хранилища нет importChat");
          context.skip();
        }
        return storage as ImportStorage;
      }

      const imported = {
        id: "imported",
        ownerId: "anna",
        modelId: "deepseek-4.1-flash",
        providerId: "deepseek",
        reasoning: "high",
        title: "Старый разговор",
        createdAt: "2023-01-01T09:00:00.000Z",
        updatedAt: "2023-01-02T09:00:00.000Z",
      };

      function importedMessages(chatId = "imported", prefix = ""): StoredMessage[] {
        return [
          newStoredMessage({ id: `${prefix}greet`, chatId, role: "assistant", parts: [{ type: "text", text: "Здравствуйте!" }], createdAt: "2023-01-01T09:00:00.000Z" }),
          newStoredMessage({ id: `${prefix}q1`, chatId, parentId: `${prefix}greet`, role: "user", parts: [{ type: "text", text: "Вопрос" }], createdAt: "2023-01-01T09:05:00.000Z" }),
          newStoredMessage({
            id: `${prefix}a1`,
            chatId,
            parentId: `${prefix}q1`,
            role: "assistant",
            parts: [{ type: "text", text: "Ответ" }],
            modelId: "deepseek-4.1-flash",
            providerId: "deepseek",
            createdAt: "2023-01-01T09:06:00.000Z",
          }),
        ];
      }

      it("чат и сообщения ложатся как есть: даты чата не пересчитываются по сообщениям, порядок и содержимое прежние", async (context) => {
        const storage = await importStorage(context);
        const messages = importedMessages();
        await storage.importChat(imported, messages);
        expect(await storage.getChat("imported")).toEqual(imported);
        expect(await storage.listMessages("imported")).toEqual(messages);
        expect(await storage.listChats("anna")).toEqual([imported]);
      });

      it("ключ и данные объекта переносятся: чат находится по ключу", async (context) => {
        const storage = await importStorage(context);
        await storage.importChat({ ...imported, subjectKey: "lesson:7", subjectData: { lesson: 7 } }, importedMessages());
        expect(await storage.getChat("imported")).toMatchObject({ subjectKey: "lesson:7", subjectData: { lesson: 7 } });
        expect((await storage.findChatBySubject?.("anna", "lesson:7"))?.id).toBe("imported");
      });

      it("чат без сообщений переносится", async (context) => {
        const storage = await importStorage(context);
        await storage.importChat(imported, []);
        expect(await storage.getChat("imported")).toEqual(imported);
        expect(await storage.listMessages("imported")).toEqual([]);
      });

      it("повтор id чата — ChatAlreadyExistsError, ничего не записано, прежний чат цел", async (context) => {
        const storage = await importStorage(context);
        await storage.createChat({ ...chatInput, id: "imported" });
        await expect(storage.importChat(imported, importedMessages())).rejects.toBeInstanceOf(ChatAlreadyExistsError);
        expect(await storage.getChat("imported")).toMatchObject({ ...chatInput, id: "imported" });
        expect(await storage.listMessages("imported")).toEqual([]);
      });

      it("повтор ключа объекта — DuplicateChatSubjectError, ничего не записано", async (context) => {
        const storage = await importStorage(context);
        await storage.createChat({ ...chatInput, id: "first", subjectKey: "lesson:7" });
        await expect(storage.importChat({ ...imported, subjectKey: "lesson:7" }, importedMessages())).rejects.toBeInstanceOf(DuplicateChatSubjectError);
        expect(await storage.getChat("imported")).toBeNull();
        expect(await storage.getMessage("greet")).toBeNull();
      });

      it("сбой на сообщении — ничего не записано: ни чата, ни сообщений (одна транзакция)", async (context) => {
        const storage = await importStorage(context);
        await storage.importChat({ ...imported, id: "other" }, importedMessages("other", "x-"));
        // Последнее сообщение повторяет id уже записанного — вставка падает на нём.
        const messages = [...importedMessages(), { ...importedMessages()[2]!, id: "x-a1", parentId: "a1", createdAt: "2023-01-01T09:07:00.000Z" }];
        await expect(storage.importChat(imported, messages)).rejects.toBeInstanceOf(DuplicateMessageError);
        expect(await storage.getChat("imported")).toBeNull();
        expect(await storage.getMessage("greet")).toBeNull();
        expect(await storage.listMessages("imported")).toEqual([]);
        expect((await storage.getMessage("x-a1"))?.chatId).toBe("other");
      });

      it("перенесённый чат дальше живёт как обычный: новое сообщение поднимает updatedAt", async (context) => {
        const storage = await importStorage(context);
        await storage.importChat(imported, importedMessages());
        await storage.insertMessage({ ...userMessage("q2", "2099-01-01T00:00:00.000Z", "a1"), chatId: "imported" });
        expect((await storage.getChat("imported"))?.updatedAt).toBe("2099-01-01T00:00:00.000Z");
        expect((await storage.listMessages("imported")).map((message) => message.id)).toEqual(["greet", "q1", "a1", "q2"]);
      });
    });

    describe("состояние хука итога у сообщения (необязательные методы)", () => {
      type AfterTurnStorage = ChatStorage & Required<Pick<ChatStorage, "setAfterTurnState" | "listPendingAfterTurn">>;

      async function afterTurnStorage(context: { skip: () => never }): Promise<AfterTurnStorage> {
        const storage = await createStorage();
        if (!storage.setAfterTurnState || !storage.listPendingAfterTurn) {
          if (options.afterTurnState === "required") throw new Error("У хранилища нет состояния хука итога");
          context.skip();
        }
        await storage.createChat(chatInput);
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
        return storage as AfterTurnStorage;
      }

      it("у сообщения без состояния его нет; ждущих — пусто", async (context) => {
        const storage = await afterTurnStorage(context);
        expect((await storage.getMessage("a1"))?.afterTurn ?? null).toBeNull();
        expect(await storage.listPendingAfterTurn()).toEqual([]);
      });

      it("pendingForMs: ждущий свежее порога не отдаётся; отметка — переход в pending по часам хранилища, а не дата создания", async (context) => {
        const storage = await afterTurnStorage(context);
        const old = "2020-01-01T00:00:00.000Z";
        await storage.insertMessage(userMessage("u0", old));
        await storage.insertMessage(streamingAnswer("finished-now", "u0", old));
        await storage.finishMessage("finished-now", { status: "complete", afterTurn: "pending" });
        await storage.insertMessage({ ...streamingAnswer("left-long-ago", "u0", old), status: "complete", afterTurn: "pending" });
        await storage.insertMessage({ ...streamingAnswer("reopened-now", "u0", old), status: "complete" });
        await storage.setAfterTurnState("reopened-now", "pending");

        expect((await storage.listPendingAfterTurn()).sort()).toEqual(["finished-now", "left-long-ago", "reopened-now"]);
        expect(await storage.listPendingAfterTurn({ pendingForMs: 60_000 })).toEqual(["left-long-ago"]);
      });

      it("finishMessage с afterTurn: pending ставит состояние той же записью; ответ попадает в ждущие", async (context) => {
        const storage = await afterTurnStorage(context);
        await storage.finishMessage("a1", { status: "complete", parts: [{ type: "text", text: "готово" }], afterTurn: "pending" });
        expect(await storage.getMessage("a1")).toMatchObject({ status: "complete", afterTurn: "pending" });
        expect((await storage.listMessages(chatInput.id)).find((message) => message.id === "a1")?.afterTurn).toBe("pending");
        expect(await storage.listPendingAfterTurn()).toEqual(["a1"]);
      });

      it("finishMessage без afterTurn состояние не ставит", async (context) => {
        const storage = await afterTurnStorage(context);
        await storage.finishMessage("a1", { status: "complete" });
        expect((await storage.getMessage("a1"))?.afterTurn ?? null).toBeNull();
        expect(await storage.listPendingAfterTurn()).toEqual([]);
      });

      it("setAfterTurnState меняет состояние законченного ответа: done и failed уходят из ждущих", async (context) => {
        const storage = await afterTurnStorage(context);
        await storage.insertMessage({ ...streamingAnswer("a2", "u1", "2099-01-01T00:00:02.000Z"), status: "complete" });
        await storage.finishMessage("a1", { status: "complete", afterTurn: "pending" });
        await storage.setAfterTurnState("a2", "pending");
        expect((await storage.listPendingAfterTurn()).sort()).toEqual(["a1", "a2"]);

        await storage.setAfterTurnState("a1", "done");
        await storage.setAfterTurnState("a2", "failed");
        expect((await storage.getMessage("a1"))?.afterTurn).toBe("done");
        expect((await storage.getMessage("a2"))?.afterTurn).toBe("failed");
        expect(await storage.listPendingAfterTurn()).toEqual([]);
      });

      it("неизвестное сообщение — тихо ничего", async (context) => {
        const storage = await afterTurnStorage(context);
        await expect(storage.setAfterTurnState("missing", "done")).resolves.toBe(false);
        expect(await storage.getMessage("missing")).toBeNull();
      });

      it("done и failed пишутся только из pending: второй закрывающий не проходит", async (context) => {
        const storage = await afterTurnStorage(context);
        await storage.finishMessage("a1", { status: "complete", afterTurn: "pending" });
        expect(await storage.setAfterTurnState("a1", "done")).toBe(true);
        expect(await storage.setAfterTurnState("a1", "failed")).toBe(false);
        expect((await storage.getMessage("a1"))?.afterTurn).toBe("done");
        await storage.insertMessage({ ...streamingAnswer("a2", "u1", "2099-01-01T00:00:02.000Z"), status: "complete" });
        expect(await storage.setAfterTurnState("a2", "done")).toBe(false);
        expect((await storage.getMessage("a2"))?.afterTurn ?? null).toBeNull();
      });

      it("appendParts дописываются в конец частей той же записью и только из pending", async (context) => {
        const storage = await afterTurnStorage(context);
        const event = { type: "data-app-event", data: { type: "lesson_passed", data: { score: 5 } } } as StoredMessage["parts"][number];
        await storage.finishMessage("a1", { status: "complete", parts: [{ type: "text", text: "готово" }], afterTurn: "pending" });
        expect(await storage.setAfterTurnState("a1", "done", { appendParts: [event] })).toBe(true);
        expect((await storage.getMessage("a1"))?.parts).toEqual([{ type: "text", text: "готово" }, event]);
        expect(await storage.setAfterTurnState("a1", "done", { appendParts: [event] })).toBe(false);
        expect((await storage.getMessage("a1"))?.parts).toHaveLength(2);
      });

      it("удаление чата убирает его ждущие ответы", async (context) => {
        const storage = await afterTurnStorage(context);
        await storage.finishMessage("a1", { status: "complete", afterTurn: "pending" });
        await storage.deleteChat(chatInput.id);
        expect(await storage.listPendingAfterTurn()).toEqual([]);
      });
    });

    describe("закрытие чата (необязательный метод)", () => {
      type ClosureStorage = ChatStorage & Required<Pick<ChatStorage, "setChatClosed">>;

      async function closureStorage(context: { skip: () => never }): Promise<ClosureStorage> {
        const storage = await createStorage();
        if (!storage.setChatClosed) {
          if (options.chatClosure === "required") throw new Error("У хранилища нет закрытия чата");
          context.skip();
        }
        await storage.createChat(chatInput);
        return storage as ClosureStorage;
      }

      const closure = { code: "form_completed", message: "Заявка отправлена. «Диалог» только для чтения 🙂" };

      it("у нового чата закрытия нет; setChatClosed пишет его, null — стирает; updatedAt не меняется", async (context) => {
        const storage = await closureStorage(context);
        const before = await storage.getChat(chatInput.id);
        expect(before).not.toHaveProperty("closed");
        await storage.setChatClosed(chatInput.id, closure);
        expect(await storage.getChat(chatInput.id)).toMatchObject({ closed: closure, updatedAt: before!.updatedAt });
        expect((await storage.listChats("anna"))[0]).toMatchObject({ closed: closure });
        await storage.setChatClosed(chatInput.id, null);
        expect(await storage.getChat(chatInput.id)).not.toHaveProperty("closed");
      });

      it("повторное закрытие заменяет код и текст; неизвестный чат — тихо", async (context) => {
        const storage = await closureStorage(context);
        await storage.setChatClosed(chatInput.id, closure);
        await storage.setChatClosed(chatInput.id, { code: "form_unpublished", message: "Форма снята с публикации." });
        expect((await storage.getChat(chatInput.id))?.closed).toEqual({ code: "form_unpublished", message: "Форма снята с публикации." });
        await expect(storage.setChatClosed("missing", closure)).resolves.toBeUndefined();
        expect(await storage.getChat("missing")).toBeNull();
      });
    });

    describe("голосовой режим (необязательные методы)", () => {
      type VoiceStorage = ChatStorage & Required<Pick<ChatStorage, "setVoiceCut" | "getVoiceChoice" | "setVoiceChoice">>;

      /** Хранилище без этих методов договор не нарушает: пакет диалога тогда держит выбор и отметку в памяти. */
      async function voiceStorage(context: { skip: () => never }, withChat = true): Promise<VoiceStorage> {
        const storage = await createStorage();
        if (!storage.setVoiceCut || !storage.getVoiceChoice || !storage.setVoiceChoice) {
          if (options.voiceDialog === "required") throw new Error("У хранилища нет методов голосового режима");
          context.skip();
        }
        if (withChat) await storage.createChat(chatInput);
        return storage as VoiceStorage;
      }

      const cut = { partIndex: 0, charOffset: 27, spokenTail: "…сначала разберём, как это устроено" };

      async function chatWithAnswer(storage: VoiceStorage): Promise<void> {
        await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
        await storage.insertMessage({
          ...streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"),
          status: "complete",
          parts: [{ type: "text", text: "Сначала разберём, как это устроено, потом посмотрим на примеры." }],
        });
      }

      describe("отметка обрыва", () => {
        it("у сообщения без отметки чтение даёт voiceCut: null", async (context) => {
          const storage = await voiceStorage(context);
          await chatWithAnswer(storage);
          expect((await storage.getMessage("a1"))?.voiceCut).toBeNull();
          expect((await storage.listMessages(chatInput.id)).map((message) => message.voiceCut)).toEqual([null, null]);
        });

        it("setVoiceCut пишет отметку владельцу: её видят getMessage и listMessages; повторная запись заменяет", async (context) => {
          const storage = await voiceStorage(context);
          await chatWithAnswer(storage);
          await storage.setVoiceCut({ ownerId: "anna", chatId: chatInput.id, messageId: "a1", voiceCut: cut });
          expect((await storage.getMessage("a1"))?.voiceCut).toEqual(cut);
          expect((await storage.listMessages(chatInput.id)).find((message) => message.id === "a1")?.voiceCut).toEqual(cut);

          const later = { partIndex: 0, charOffset: 50, spokenTail: "…потом посмотрим" };
          await storage.setVoiceCut({ ownerId: "anna", chatId: chatInput.id, messageId: "a1", voiceCut: later });
          expect((await storage.getMessage("a1"))?.voiceCut).toEqual(later);
        });

        it("чужой владелец: тихо ничего, отметка не появляется", async (context) => {
          const storage = await voiceStorage(context);
          await chatWithAnswer(storage);
          await expect(
            storage.setVoiceCut({ ownerId: "boris", chatId: chatInput.id, messageId: "a1", voiceCut: cut }),
          ).resolves.toBeUndefined();
          expect((await storage.getMessage("a1"))?.voiceCut).toBeNull();
        });

        it("сообщение из другого чата или неизвестное: тихо ничего", async (context) => {
          const storage = await voiceStorage(context);
          await chatWithAnswer(storage);
          await storage.createChat({ ...chatInput, id: "chat-2" });
          await storage.setVoiceCut({ ownerId: "anna", chatId: "chat-2", messageId: "a1", voiceCut: cut });
          await storage.setVoiceCut({ ownerId: "anna", chatId: chatInput.id, messageId: "missing", voiceCut: cut });
          await storage.setVoiceCut({ ownerId: "anna", chatId: "missing", messageId: "a1", voiceCut: cut });
          expect((await storage.getMessage("a1"))?.voiceCut).toBeNull();
        });

        it("отметка, поставленная у идущего ответа, переживает его завершение и дописывание", async (context) => {
          const storage = await voiceStorage(context);
          await storage.insertMessage(userMessage("u1", "2099-01-01T00:00:00.000Z"));
          await storage.insertMessage(streamingAnswer("a1", "u1", "2099-01-01T00:00:01.000Z"));
          await storage.setVoiceCut({ ownerId: "anna", chatId: chatInput.id, messageId: "a1", voiceCut: cut });
          await storage.updateStreamingMessage("a1", { parts: [{ type: "text", text: "часть" }] });
          await storage.finishMessage("a1", { status: "stopped", parts: [{ type: "text", text: "часть ответа" }] });
          expect(await storage.getMessage("a1")).toMatchObject({ status: "stopped", voiceCut: cut });
        });

        it("отметка одного сообщения не задевает другие", async (context) => {
          const storage = await voiceStorage(context);
          await chatWithAnswer(storage);
          await storage.setVoiceCut({ ownerId: "anna", chatId: chatInput.id, messageId: "a1", voiceCut: cut });
          expect((await storage.getMessage("u1"))?.voiceCut).toBeNull();
        });
      });

      describe("выбор голоса", () => {
        it("у человека без выбора — null", async (context) => {
          const storage = await voiceStorage(context, false);
          expect(await storage.getVoiceChoice("anna")).toBeNull();
        });

        it("запись, чтение и замена", async (context) => {
          const storage = await voiceStorage(context, false);
          await storage.setVoiceChoice("anna", "voice-a");
          expect(await storage.getVoiceChoice("anna")).toBe("voice-a");
          await storage.setVoiceChoice("anna", "voice-b");
          expect(await storage.getVoiceChoice("anna")).toBe("voice-b");
        });

        it("у каждого человека свой выбор", async (context) => {
          const storage = await voiceStorage(context, false);
          await storage.setVoiceChoice("anna", "voice-a");
          await storage.setVoiceChoice("boris", "voice-b");
          expect(await storage.getVoiceChoice("anna")).toBe("voice-a");
          expect(await storage.getVoiceChoice("boris")).toBe("voice-b");
          expect(await storage.getVoiceChoice("clara")).toBeNull();
        });

        it("не зависит от выбора модели (015) и от удаления чатов", async (context) => {
          const storage = await voiceStorage(context);
          await storage.setVoiceChoice("anna", "voice-a");
          await storage.saveUserModelChoice?.("anna", { modelId: "m", providerId: "p" });
          expect(await storage.getVoiceChoice("anna")).toBe("voice-a");
          if (storage.getUserModelChoice) expect(await storage.getUserModelChoice("anna")).toEqual({ modelId: "m", providerId: "p" });
          await storage.setVoiceChoice("anna", "voice-b");
          if (storage.getUserModelChoice) expect(await storage.getUserModelChoice("anna")).toEqual({ modelId: "m", providerId: "p" });
          await storage.deleteChat(chatInput.id);
          expect(await storage.getVoiceChoice("anna")).toBe("voice-b");
        });

        it("двадцать записей одновременно не ломают хранилище: остаётся одно из записанных значений", async (context) => {
          const storage = await voiceStorage(context, false);
          await Promise.all(Array.from({ length: 20 }, (_, index) => storage.setVoiceChoice("anna", `voice-${index}`)));
          expect(await storage.getVoiceChoice("anna")).toMatch(/^voice-\d+$/);
        });
      });
    });

    describe("состояние лимитов расходов (необязательные методы)", () => {
      async function storageWithLimitState(context: { skip: () => never }) {
        const storage = await createStorage();
        if (!storage.getSpendingLimitState || !storage.saveSpendingLimitState) {
          if (options.spendingLimitState === "required") throw new Error("У хранилища нет методов состояния лимитов расходов");
          context.skip();
        }
        return storage as ChatStorage & Required<Pick<ChatStorage, "getSpendingLimitState" | "saveSpendingLimitState">>;
      }

      it("нет записи — null; первая запись — только при expectedVersion null, версия 1", async (context) => {
        const storage = await storageWithLimitState(context);
        expect(await storage.getSpendingLimitState("user:anna")).toBeNull();
        expect(await storage.saveSpendingLimitState("user:anna", "{}", 1)).toBe(false);
        expect(await storage.getSpendingLimitState("user:anna")).toBeNull();
        expect(await storage.saveSpendingLimitState("user:anna", '{"a":1}', null)).toBe(true);
        expect(await storage.getSpendingLimitState("user:anna")).toEqual({ value: '{"a":1}', version: 1 });
      });

      it("запись по версии: верная — заменяет и растит версию, устаревшая или null при существующей — false и ничего", async (context) => {
        const storage = await storageWithLimitState(context);
        await storage.saveSpendingLimitState("k", "v1", null);
        expect(await storage.saveSpendingLimitState("k", "v2", 1)).toBe(true);
        expect(await storage.saveSpendingLimitState("k", "stale", 1)).toBe(false);
        expect(await storage.saveSpendingLimitState("k", "again", null)).toBe(false);
        expect(await storage.getSpendingLimitState("k")).toEqual({ value: "v2", version: 2 });
      });

      it("из двух одновременных записей с одной версией проходит одна", async (context) => {
        const storage = await storageWithLimitState(context);
        await storage.saveSpendingLimitState("k", "v1", null);
        const results = await Promise.all([storage.saveSpendingLimitState("k", "a", 1), storage.saveSpendingLimitState("k", "b", 1)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await storage.getSpendingLimitState("k"))!.version).toBe(2);
      });

      it("ключи независимы; длинная строка с юникодом хранится как есть; чаты не трогает", async (context) => {
        const storage = await storageWithLimitState(context);
        const long = JSON.stringify({ note: "лимит ✓", items: Array.from({ length: 2000 }, (_, index) => index) });
        await storage.saveSpendingLimitState("service", long, null);
        await storage.saveSpendingLimitState("user:boris", "b", null);
        expect(await storage.getSpendingLimitState("service")).toEqual({ value: long, version: 1 });
        expect(await storage.getSpendingLimitState("user:boris")).toEqual({ value: "b", version: 1 });
        expect(await storage.listChats("anna")).toEqual([]);
      });

      it("удаление по ключам: стирает только названные, лишние ключи и пустой список — не ошибка", async (context) => {
        const storage = await storageWithLimitState(context);
        if (!storage.deleteSpendingLimitStates) {
          if (options.spendingLimitState === "required") throw new Error("У хранилища нет метода deleteSpendingLimitStates");
          context.skip();
        }
        const keys = ["window:chat:c1:day", "window:chat:c1:week", "window:chat:c1:day:x", "window:chat:чат:day", "window:user:anna:day"];
        for (const key of keys) await storage.saveSpendingLimitState(key, "v", null);
        await storage.deleteSpendingLimitStates!(["window:chat:c1:day", "window:chat:c1:week", "window:chat:чат:day", "нет-такого"]);
        await storage.deleteSpendingLimitStates!([]);
        const left = [];
        for (const key of keys) if (await storage.getSpendingLimitState(key)) left.push(key);
        expect(left).toEqual(["window:chat:c1:day:x", "window:user:anna:day"]);
        expect(await storage.saveSpendingLimitState("window:chat:c1:day", "new", null)).toBe(true);
      });
    });

    describe("запомненный выбор модели (необязательные методы)", () => {
      /** Хранилище без этих методов договор не нарушает: ядро тогда ведёт себя как раньше. */
      async function storageWithChoiceMemory(context: { skip: () => never }) {
        const storage = await createStorage();
        if (!storage.getUserModelChoice || !storage.saveUserModelChoice) {
          if (options.choiceMemory === "required") throw new Error("У хранилища нет методов запомненного выбора модели");
          context.skip();
        }
        return storage as ChatStorage & Required<Pick<ChatStorage, "getUserModelChoice" | "saveUserModelChoice">>;
      }

      it("у человека без выбора — null", async (context) => {
        const storage = await storageWithChoiceMemory(context);
        expect(await storage.getUserModelChoice("anna")).toBeNull();
      });

      it("хранит модель, провайдера и уровень рассуждений; без уровня — без уровня", async (context) => {
        const storage = await storageWithChoiceMemory(context);
        await storage.saveUserModelChoice("anna", { modelId: "m", providerId: "p", reasoning: "high" });
        expect(await storage.getUserModelChoice("anna")).toEqual({ modelId: "m", providerId: "p", reasoning: "high" });

        await storage.saveUserModelChoice("anna", { modelId: "m2", providerId: "p2" });
        const replaced = await storage.getUserModelChoice("anna");
        expect(replaced).toEqual({ modelId: "m2", providerId: "p2" });
        expect(replaced).not.toHaveProperty("reasoning");
      });

      it("у каждого человека свой выбор", async (context) => {
        const storage = await storageWithChoiceMemory(context);
        await storage.saveUserModelChoice("anna", { modelId: "a", providerId: "p" });
        await storage.saveUserModelChoice("boris", { modelId: "b", providerId: "p", reasoning: "low" });
        expect(await storage.getUserModelChoice("anna")).toEqual({ modelId: "a", providerId: "p" });
        expect(await storage.getUserModelChoice("boris")).toEqual({ modelId: "b", providerId: "p", reasoning: "low" });
        expect(await storage.getUserModelChoice("clara")).toBeNull();
      });

      it("не трогает чаты и не зависит от их удаления", async (context) => {
        const storage = await storageWithChoiceMemory(context);
        await storage.createChat(chatInput);
        await storage.saveUserModelChoice("anna", { modelId: "other", providerId: "fireworks" });
        expect(await storage.getChat(chatInput.id)).toMatchObject({ modelId: chatInput.modelId, providerId: chatInput.providerId });
        await storage.deleteChat(chatInput.id);
        expect(await storage.getUserModelChoice("anna")).toEqual({ modelId: "other", providerId: "fireworks" });
      });

      it("двадцать записей одновременно не ломают хранилище: остаётся одно из записанных значений", async (context) => {
        const storage = await storageWithChoiceMemory(context);
        await Promise.all(Array.from({ length: 20 }, (_, index) => storage.saveUserModelChoice("anna", { modelId: `m${index}`, providerId: "p" })));
        const saved = await storage.getUserModelChoice("anna");
        expect(saved?.modelId).toMatch(/^m\d+$/);
      });
    });

    describe("долгая память (необязательные методы)", () => {
      type MemoryStorage = ChatStorage &
        Required<
          Pick<ChatStorage, "listMemoryNotes" | "insertMemoryNotes" | "updateMemoryNote" | "deleteMemoryNote" | "clearMemoryNotes">
        >;

      /** Хранилище без этих методов договор не нарушает: приложение тогда не подключает пакет памяти. */
      async function storageWithMemory(context: { skip: () => never }): Promise<MemoryStorage> {
        const storage = await createStorage();
        const present =
          storage.listMemoryNotes &&
          storage.insertMemoryNotes &&
          storage.updateMemoryNote &&
          storage.deleteMemoryNote &&
          storage.clearMemoryNotes;
        if (!present) {
          if (options.memory === "required") throw new Error("У хранилища нет методов долгой памяти");
          context.skip();
        }
        return storage as MemoryStorage;
      }

      const note = (content: string, ...categories: string[]): MemoryNoteInput => ({
        categories: categories.length > 0 ? categories : ["О себе"],
        content,
      });

      /** Порядок списка по договору: `updatedAt`, затем `createdAt`, затем `id` — новее и больше первыми. */
      function expectedOrder(notes: MemoryNote[]): string[] {
        return [...notes]
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              right.createdAt.localeCompare(left.createdAt) ||
              (right.id > left.id ? 1 : right.id < left.id ? -1 : 0),
          )
          .map((item) => item.id);
      }

      /** Ждёт, пока часы уйдут вперёд хотя бы на миллисекунду: пауза до условия, а не по таймеру. */
      async function untilClockMoves(): Promise<void> {
        const start = Date.now();
        while (Date.now() <= start) await new Promise((resolve) => setTimeout(resolve, 1));
      }

      it("у человека без записей список пуст", async (context) => {
        const storage = await storageWithMemory(context);
        expect(await storage.listMemoryNotes("anna")).toEqual([]);
      });

      it("вставка выдаёт записи с id, версией 1 и временем; список читает их; владельца в записи нет", async (context) => {
        const storage = await storageWithMemory(context);
        const created = await storage.insertMemoryNotes("anna", [note("Пишет на TypeScript", "О себе", "Работа"), note("Отвечай на «ты»", "Правила")]);
        expect(created).toHaveLength(2);
        expect(new Set(created.map((item) => item.id)).size).toBe(2);
        for (const item of created) {
          expect(item.id).toEqual(expect.any(String));
          expect(item.version).toBe(1);
          expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
          expect(item.updatedAt).toBe(item.createdAt);
          expect(item).not.toHaveProperty("ownerId");
        }
        expect(created.find((item) => item.content === "Пишет на TypeScript")?.categories).toEqual(["О себе", "Работа"]);

        const listed = await storage.listMemoryNotes("anna");
        expect(listed).toHaveLength(2);
        expect(listed.map((item) => item.id).sort()).toEqual(created.map((item) => item.id).sort());
        for (const item of listed) expect(item).not.toHaveProperty("ownerId");
      });

      it("пустой пакет — пустой ответ, ничего не создаётся", async (context) => {
        const storage = await storageWithMemory(context);
        expect(await storage.insertMemoryNotes("anna", [])).toEqual([]);
        expect(await storage.listMemoryNotes("anna")).toEqual([]);
      });

      it("пакет — всё или ничего: одна негодная запись не оставляет и остальных", async (context) => {
        const storage = await storageWithMemory(context);
        await storage.insertMemoryNotes("anna", [note("Уже была")]);
        const broken = { categories: ["О себе"], content: null } as unknown as MemoryNoteInput;
        await expect(storage.insertMemoryNotes("anna", [note("Хорошая первая"), broken, note("Хорошая третья")])).rejects.toBeInstanceOf(Error);
        const listed = await storage.listMemoryNotes("anna");
        expect(listed.map((item) => item.content)).toEqual(["Уже была"]);
      });

      it("у каждого человека своя память: чужие записи не видны", async (context) => {
        const storage = await storageWithMemory(context);
        await storage.insertMemoryNotes("anna", [note("Записка Анны")]);
        await storage.insertMemoryNotes("boris", [note("Записка Бориса"), note("Ещё одна Бориса")]);
        expect((await storage.listMemoryNotes("anna")).map((item) => item.content)).toEqual(["Записка Анны"]);
        expect(await storage.listMemoryNotes("boris")).toHaveLength(2);
        expect(await storage.listMemoryNotes("clara")).toEqual([]);
      });

      it("чужая запись — not_found при правке и удалении, сама запись цела", async (context) => {
        const storage = await storageWithMemory(context);
        const [annas] = await storage.insertMemoryNotes("anna", [note("Записка Анны")]);
        expect(await storage.updateMemoryNote("boris", annas!.id, 1, note("Подмена"))).toBe("not_found");
        expect(await storage.deleteMemoryNote("boris", annas!.id, 1)).toBe("not_found");
        expect(await storage.listMemoryNotes("anna")).toEqual([annas]);
      });

      it("правка меняет разделы и текст, поднимает версию на 1, createdAt не трогает, updatedAt не уменьшает", async (context) => {
        const storage = await storageWithMemory(context);
        const [created] = await storage.insertMemoryNotes("anna", [note("Пишет на JavaScript", "О себе")]);
        await untilClockMoves();
        const updated = await storage.updateMemoryNote("anna", created!.id, 1, note("Пишет на TypeScript", "О себе", "Работа"));
        expect(updated).toMatchObject({
          id: created!.id,
          version: 2,
          content: "Пишет на TypeScript",
          categories: ["О себе", "Работа"],
          createdAt: created!.createdAt,
        });
        expect((updated as MemoryNote).updatedAt > created!.updatedAt).toBe(true);
        expect(await storage.listMemoryNotes("anna")).toEqual([updated]);

        const again = await storage.updateMemoryNote("anna", created!.id, 2, note("Пишет на Rust", "О себе"));
        expect(again).toMatchObject({ version: 3, content: "Пишет на Rust" });
      });

      it("правка с устаревшей версией — stale_version, запись не меняется", async (context) => {
        const storage = await storageWithMemory(context);
        const [created] = await storage.insertMemoryNotes("anna", [note("Первая редакция")]);
        await storage.updateMemoryNote("anna", created!.id, 1, note("Вторая редакция"));
        expect(await storage.updateMemoryNote("anna", created!.id, 1, note("Опоздавшая правка"))).toBe("stale_version");
        expect(await storage.updateMemoryNote("anna", created!.id, 3, note("Версия из будущего"))).toBe("stale_version");
        const [kept] = await storage.listMemoryNotes("anna");
        expect(kept).toMatchObject({ version: 2, content: "Вторая редакция" });
      });

      it("удаление: с верной версией — ok, с устаревшей — stale_version и запись остаётся, повтор — not_found", async (context) => {
        const storage = await storageWithMemory(context);
        const [created] = await storage.insertMemoryNotes("anna", [note("Временная")]);
        await storage.updateMemoryNote("anna", created!.id, 1, note("Временная, правка"));
        expect(await storage.deleteMemoryNote("anna", created!.id, 1)).toBe("stale_version");
        expect(await storage.listMemoryNotes("anna")).toHaveLength(1);
        expect(await storage.deleteMemoryNote("anna", created!.id, 2)).toBe("ok");
        expect(await storage.listMemoryNotes("anna")).toEqual([]);
        expect(await storage.deleteMemoryNote("anna", created!.id, 2)).toBe("not_found");
      });

      it("правка и удаление неизвестной записи — not_found", async (context) => {
        const storage = await storageWithMemory(context);
        expect(await storage.updateMemoryNote("anna", "missing", 1, note("Нет такой"))).toBe("not_found");
        expect(await storage.deleteMemoryNote("anna", "missing", 1)).toBe("not_found");
      });

      it("две правки с одной версией одновременно: проходит одна, вторая — stale_version", async (context) => {
        const storage = await storageWithMemory(context);
        const [created] = await storage.insertMemoryNotes("anna", [note("Исходная")]);
        const results = await Promise.all([
          storage.updateMemoryNote("anna", created!.id, 1, note("Правка А")),
          storage.updateMemoryNote("anna", created!.id, 1, note("Правка Б")),
        ]);
        expect(results.filter((result) => result === "stale_version")).toHaveLength(1);
        expect(results.filter((result) => typeof result === "object")).toHaveLength(1);
        const [kept] = await storage.listMemoryNotes("anna");
        expect(kept?.version).toBe(2);
      });

      it("порядок списка: новейшие по updatedAt первыми, при равенстве по createdAt, затем по id", async (context) => {
        const storage = await storageWithMemory(context);
        const batch = await storage.insertMemoryNotes("anna", [note("Первая"), note("Вторая"), note("Третья")]);
        await untilClockMoves();
        const [later] = await storage.insertMemoryNotes("anna", [note("Позже")]);
        let listed = await storage.listMemoryNotes("anna");
        expect(listed.map((item) => item.id)).toEqual(expectedOrder(listed));
        expect(listed[0]?.id).toBe(later!.id);

        // Правка поднимает запись на первое место.
        await untilClockMoves();
        await storage.updateMemoryNote("anna", batch[0]!.id, 1, note("Первая, правка"));
        listed = await storage.listMemoryNotes("anna");
        expect(listed.map((item) => item.id)).toEqual(expectedOrder(listed));
        expect(listed[0]?.id).toBe(batch[0]!.id);
      });

      it("удаление чата память не трогает", async (context) => {
        const storage = await storageWithMemory(context);
        await storage.createChat(chatInput);
        await storage.insertMemoryNotes(chatInput.ownerId, [note("Переживёт чат")]);
        await storage.deleteChat(chatInput.id);
        expect((await storage.listMemoryNotes(chatInput.ownerId)).map((item) => item.content)).toEqual(["Переживёт чат"]);
      });

      it("стирание убирает всю память своего человека, возвращает число и не трогает чужую", async (context) => {
        const storage = await storageWithMemory(context);
        await storage.insertMemoryNotes("anna", [note("Один"), note("Два"), note("Три")]);
        await storage.insertMemoryNotes("boris", [note("Борисов")]);
        expect(await storage.clearMemoryNotes("anna")).toBe(3);
        expect(await storage.listMemoryNotes("anna")).toEqual([]);
        expect(await storage.listMemoryNotes("boris")).toHaveLength(1);
        expect(await storage.clearMemoryNotes("anna")).toBe(0);
        expect(await storage.clearMemoryNotes("clara")).toBe(0);
      });

      it("отданные записи — копии: правка ответа не меняет хранилище", async (context) => {
        const storage = await storageWithMemory(context);
        const [created] = await storage.insertMemoryNotes("anna", [note("Оригинал", "О себе")]);
        created!.content = "Испорчено";
        created!.categories.push("Лишний");
        const [listed] = await storage.listMemoryNotes("anna");
        expect(listed).toMatchObject({ content: "Оригинал", categories: ["О себе"] });
        listed!.categories.push("Ещё лишний");
        expect((await storage.listMemoryNotes("anna"))[0]?.categories).toEqual(["О себе"]);
      });

      describe("проверка внутри операции", () => {
        type CheckedStorage = MemoryStorage & Required<Pick<ChatStorage, "insertMemoryNotesChecked" | "updateMemoryNoteChecked">>;

        async function checkedStorage(context: { skip: () => never }): Promise<CheckedStorage> {
          const storage = await storageWithMemory(context);
          if (!storage.insertMemoryNotesChecked || !storage.updateMemoryNoteChecked) {
            if (options.memory === "required") throw new Error("У хранилища нет методов записи с проверкой внутри операции");
            context.skip();
          }
          return storage as CheckedStorage;
        }

        const refuse: MemoryError = { kind: "limit_reached", message: "Хватит" };
        /** Пускает, пока у человека меньше `max` записей. */
        const atMost =
          (max: number): MemoryWriteGuard =>
          (existing) =>
            existing.length >= max ? refuse : null;

        it("вставка: проверка видит записи только своего человека, ничего ещё не записано; без ошибки записи появляются", async (context) => {
          const storage = await checkedStorage(context);
          await storage.insertMemoryNotes("anna", [note("Первая"), note("Вторая")]);
          await storage.insertMemoryNotes("boris", [note("Борисова")]);
          const seen: string[][] = [];
          const created = await storage.insertMemoryNotesChecked("anna", [note("Третья")], (existing) => {
            seen.push(existing.map((item) => item.content));
            return null;
          });
          expect(seen).toHaveLength(1);
          expect([...seen[0]!].sort()).toEqual(["Вторая", "Первая"]);
          expect(created).toEqual([expect.objectContaining({ content: "Третья", version: 1 })]);
          expect(await storage.listMemoryNotes("anna")).toHaveLength(3);
        });

        it("вставка: ошибка проверки отдаётся как есть и ничего не записывает", async (context) => {
          const storage = await checkedStorage(context);
          await storage.insertMemoryNotes("anna", [note("Первая")]);
          expect(await storage.insertMemoryNotesChecked("anna", [note("Вторая"), note("Третья")], () => refuse)).toEqual(refuse);
          expect((await storage.listMemoryNotes("anna")).map((item) => item.content)).toEqual(["Первая"]);
        });

        it("вставка: параллельные вставки не обходят проверку — проходят ровно те, что помещаются", async (context) => {
          const storage = await checkedStorage(context);
          await storage.insertMemoryNotes("anna", [note("Одна"), note("Другая")]);
          const results = await Promise.all(Array.from({ length: 6 }, (_, index) => storage.insertMemoryNotesChecked("anna", [note(`Новая ${index}`)], atMost(5))));
          expect(results.filter(Array.isArray)).toHaveLength(3);
          expect(results.filter((result) => !Array.isArray(result))).toEqual([refuse, refuse, refuse]);
          expect(await storage.listMemoryNotes("anna")).toHaveLength(5);
        });

        it("правка: проверка видит все записи человека, включая заменяемую; без ошибки запись меняется", async (context) => {
          const storage = await checkedStorage(context);
          const [first] = await storage.insertMemoryNotes("anna", [note("Первая"), note("Вторая")]);
          let seen: string[] = [];
          const updated = await storage.updateMemoryNoteChecked("anna", first!.id, 1, note("Новая"), (existing) => {
            seen = existing.map((item) => item.content);
            return null;
          });
          expect(seen.sort()).toEqual(["Вторая", "Первая"]);
          expect(updated).toMatchObject({ content: "Новая", version: 2 });
        });

        it("правка: ошибка проверки отдаётся как есть, запись не меняется, а проверка идёт раньше версии", async (context) => {
          const storage = await checkedStorage(context);
          const [first] = await storage.insertMemoryNotes("anna", [note("Первая")]);
          expect(await storage.updateMemoryNoteChecked("anna", first!.id, 7, note("Новая"), () => refuse)).toEqual(refuse);
          expect(await storage.listMemoryNotes("anna")).toEqual([first]);
        });

        it("правка: чужая запись и старая версия — как у обычной правки, если проверка пропустила", async (context) => {
          const storage = await checkedStorage(context);
          const [first] = await storage.insertMemoryNotes("anna", [note("Первая")]);
          expect(await storage.updateMemoryNoteChecked("anna", first!.id, 7, note("Новая"), () => null)).toBe("stale_version");
          expect(await storage.updateMemoryNoteChecked("boris", first!.id, 1, note("Новая"), () => null)).toBe("not_found");
          expect(await storage.updateMemoryNoteChecked("anna", "missing", 1, note("Новая"), () => null)).toBe("not_found");
        });

        it("правка: параллельные правки не обходят проверку", async (context) => {
          const storage = await checkedStorage(context);
          const [first, second] = await storage.insertMemoryNotes("anna", [note("Первая"), note("Вторая")]);
          const sameTextTaken: MemoryWriteGuard = (existing) => (existing.some((item) => item.content === "Общий текст") ? { kind: "duplicate", message: "Повтор" } : null);
          const results = await Promise.all([
            storage.updateMemoryNoteChecked("anna", first!.id, 1, note("Общий текст"), sameTextTaken),
            storage.updateMemoryNoteChecked("anna", second!.id, 1, note("Общий текст"), sameTextTaken),
          ]);
          expect(results.filter((result) => typeof result === "object" && "content" in result)).toHaveLength(1);
          expect((await storage.listMemoryNotes("anna")).filter((item) => item.content === "Общий текст")).toHaveLength(1);
        });
      });
    });
    describe("оптимизация дублей (необязательные методы)", () => {
      type OptimizerStorage = ChatStorage &
        Required<
          Pick<
            ChatStorage,
            | "listMemoryNotes"
            | "insertMemoryNotes"
            | "updateMemoryNote"
            | "deleteMemoryNote"
            | "clearMemoryNotes"
            | "claimMemoryOptimizationRun"
            | "finishMemoryOptimizationRun"
            | "applyMemoryMerge"
            | "revertMemoryMerge"
            | "listMemoryOptimizationRuns"
            | "listMergedMemoryNotes"
          >
        >;

      const MINUTE = 60_000;
      const rules: MemoryOptimizationRules = { minIntervalMs: 24 * 60 * MINUTE, retryAfterFailureMs: 60 * MINUTE, leaseMs: 3 * MINUTE };
      /** Время запуска: минуты от условного начала; хранилище берёт часы у вызывающего. */
      const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1) + minutes * MINUTE).toISOString();

      async function storageWithOptimizer(context: { skip: () => never }): Promise<OptimizerStorage> {
        const storage = await createStorage();
        const present =
          storage.listMemoryNotes &&
          storage.insertMemoryNotes &&
          storage.updateMemoryNote &&
          storage.deleteMemoryNote &&
          storage.clearMemoryNotes &&
          storage.claimMemoryOptimizationRun &&
          storage.finishMemoryOptimizationRun &&
          storage.applyMemoryMerge &&
          storage.revertMemoryMerge &&
          storage.listMemoryOptimizationRuns &&
          storage.listMergedMemoryNotes;
        if (!present) {
          if (options.memoryOptimization === "required") throw new Error("У хранилища нет методов оптимизации дублей");
          context.skip();
        }
        return storage as OptimizerStorage;
      }

      const note = (content: string, ...categories: string[]): MemoryNoteInput => ({
        categories: categories.length > 0 ? categories : ["О себе"],
        content,
      });

      async function claimed(storage: OptimizerStorage, ownerId = "anna", minutes = 0) {
        const run = await storage.claimMemoryOptimizationRun(ownerId, rules, at(minutes));
        expect(run).not.toBeNull();
        return run!;
      }

      /** Три записи и запуск: то, с чего начинается слияние двух из них. */
      async function withRun(storage: OptimizerStorage) {
        const [first, second, third] = await storage.insertMemoryNotes("anna", [
          note("Пишет на TypeScript", "О себе", "Работа"),
          note("Работает с TypeScript", "О себе", "Работа"),
          note("Любит чай", "О себе"),
        ]);
        const run = await claimed(storage);
        const merge = (finishedAt = at(5)) => ({
          runId: run.id,
          finishedAt,
          merges: [
            {
              result: note("Пишет на TypeScript на работе", "О себе", "Работа"),
              originals: [
                { id: first!.id, version: first!.version },
                { id: second!.id, version: second!.version },
              ],
            },
          ],
        });
        return { first: first!, second: second!, third: third!, run, merge };
      }

      describe("взятие запуска", () => {
        it("без запусков берёт новый: идёт, начат в назначенное время, склеек и ошибки нет", async (context) => {
          const storage = await storageWithOptimizer(context);
          const run = await storage.claimMemoryOptimizationRun("anna", rules, at(0));
          expect(run).toMatchObject({ status: "running", startedAt: at(0), finishedAt: null, groups: [], error: null, usageRecordId: null });
          expect(typeof run?.id).toBe("string");
          expect(await storage.listMemoryOptimizationRuns("anna")).toEqual([run]);
        });

        it("пока запуск идёт, второй не берётся", async (context) => {
          const storage = await storageWithOptimizer(context);
          await claimed(storage, "anna", 0);
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(2))).toBeNull();
          expect(await storage.listMemoryOptimizationRuns("anna")).toHaveLength(1);
        });

        it("просроченный запуск становится неудачным с концом в момент истечения; повтор — после паузы неудачи", async (context) => {
          const storage = await storageWithOptimizer(context);
          const lost = await claimed(storage, "anna", 0);
          // Срок аренды вышел, но пауза после неудачи (час от конца запуска) — ещё нет.
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(10))).toBeNull();
          const [expired] = await storage.listMemoryOptimizationRuns("anna");
          expect(expired).toMatchObject({ id: lost.id, status: "failed", error: "lease_expired", finishedAt: at(3) });
          // Пауза считается от конца запуска (минута 3), а не от того, когда о нём узнали.
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(3 + 59))).toBeNull();
          const next = await storage.claimMemoryOptimizationRun("anna", rules, at(3 + 60));
          expect(next).toMatchObject({ status: "running", startedAt: at(3 + 60) });
          expect(next?.id).not.toBe(lost.id);
        });

        it("после законченного запуска следующий — не раньше срока между запусками", async (context) => {
          const storage = await storageWithOptimizer(context);
          const run = await claimed(storage, "anna", 0);
          expect(await storage.finishMemoryOptimizationRun("anna", run.id, { status: "no_changes", finishedAt: at(1) })).toBe("ok");
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(1 + 24 * 60 - 1))).toBeNull();
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(1 + 24 * 60))).toMatchObject({ status: "running" });
        });

        it("после неудачи повтор — не раньше чем через час, и суточный срок его не ждёт", async (context) => {
          const storage = await storageWithOptimizer(context);
          const run = await claimed(storage, "anna", 0);
          await storage.finishMemoryOptimizationRun("anna", run.id, { status: "failed", finishedAt: at(1), error: "model_error" });
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(1 + 59))).toBeNull();
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(1 + 60))).toMatchObject({ status: "running" });
        });

        it("неудачи подряд растят паузу (1 ч → 6 ч → 24 ч), а законченный запуск начинает счёт заново", async (context) => {
          const storage = await storageWithOptimizer(context);
          const ladder: MemoryOptimizationRules = { ...rules, retryAfterFailureMs: [60 * MINUTE, 360 * MINUTE, 1440 * MINUTE] };
          const HOUR = 60;
          async function failAt(start: number) {
            const run = await storage.claimMemoryOptimizationRun("anna", ladder, at(start));
            expect(run).not.toBeNull();
            await storage.finishMemoryOptimizationRun("anna", run!.id, { status: "failed", finishedAt: at(start + 1), error: "model_error" });
            return start + 1;
          }
          let end = await failAt(0);
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(end + HOUR - 1))).toBeNull();
          end = await failAt(end + HOUR);
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(end + 6 * HOUR - 1))).toBeNull();
          end = await failAt(end + 6 * HOUR);
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(end + 24 * HOUR - 1))).toBeNull();
          end = await failAt(end + 24 * HOUR);
          // Дальше пауза остаётся суточной.
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(end + 24 * HOUR - 1))).toBeNull();
          const success = await storage.claimMemoryOptimizationRun("anna", ladder, at(end + 24 * HOUR));
          await storage.finishMemoryOptimizationRun("anna", success!.id, { status: "no_changes", finishedAt: at(end + 24 * HOUR + 1) });
          // После законченного запуска первая же неудача снова ждёт только час.
          const restart = end + 24 * HOUR + 1 + 24 * HOUR;
          const again = await storage.claimMemoryOptimizationRun("anna", ladder, at(restart));
          await storage.finishMemoryOptimizationRun("anna", again!.id, { status: "failed", finishedAt: at(restart + 1), error: "model_error" });
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(restart + 1 + HOUR - 1))).toBeNull();
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(restart + 1 + HOUR))).toMatchObject({ status: "running" });
        });

        it("просроченный запуск тоже считается неудачей подряд", async (context) => {
          const storage = await storageWithOptimizer(context);
          const ladder: MemoryOptimizationRules = { ...rules, retryAfterFailureMs: [60 * MINUTE, 360 * MINUTE] };
          await storage.claimMemoryOptimizationRun("anna", ladder, at(0));
          // Аренда вышла в минуту 3, пауза первой неудачи — до минуты 63.
          const second = await storage.claimMemoryOptimizationRun("anna", ladder, at(3 + 60));
          expect(second).not.toBeNull();
          await storage.finishMemoryOptimizationRun("anna", second!.id, { status: "failed", finishedAt: at(65), error: "model_error" });
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(65 + 359))).toBeNull();
          expect(await storage.claimMemoryOptimizationRun("anna", ladder, at(65 + 360))).toMatchObject({ status: "running" });
        });

        it("слитый и отменённый запуски тоже считаются законченными", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { merge, run } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge(at(5)));
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(60))).toBeNull();
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("ok");
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(60))).toBeNull();
          expect(await storage.claimMemoryOptimizationRun("anna", rules, at(5 + 24 * 60))).toMatchObject({ status: "running" });
        });

        it("запуски разных людей не мешают друг другу", async (context) => {
          const storage = await storageWithOptimizer(context);
          await claimed(storage, "anna", 0);
          expect(await storage.claimMemoryOptimizationRun("boris", rules, at(0))).toMatchObject({ status: "running" });
          expect(await storage.listMemoryOptimizationRuns("boris")).toHaveLength(1);
        });

        it("несколько одновременных попыток дают ровно один запуск", async (context) => {
          const storage = await storageWithOptimizer(context);
          const results = await Promise.all(Array.from({ length: 6 }, () => storage.claimMemoryOptimizationRun("anna", rules, at(0))));
          expect(results.filter((run) => run !== null)).toHaveLength(1);
          expect(await storage.listMemoryOptimizationRuns("anna")).toHaveLength(1);
        });
      });

      describe("закрытие запуска без слияния", () => {
        it("«нечего сливать» и «не удалось» записывают конец, ошибку и расход", async (context) => {
          const storage = await storageWithOptimizer(context);
          const first = await claimed(storage, "anna", 0);
          expect(
            await storage.finishMemoryOptimizationRun("anna", first.id, { status: "no_changes", finishedAt: at(1), usageRecordId: "usage-1" }),
          ).toBe("ok");
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]).toMatchObject({
            id: first.id,
            status: "no_changes",
            finishedAt: at(1),
            error: null,
            usageRecordId: "usage-1",
          });
          const second = await claimed(storage, "anna", 2000);
          await storage.finishMemoryOptimizationRun("anna", second.id, { status: "failed", finishedAt: at(2001), error: "invalid_proposal" });
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]).toMatchObject({ id: second.id, status: "failed", error: "invalid_proposal" });
        });

        it("чужой, отсутствующий и уже закрытый запуск — not_found и не меняется", async (context) => {
          const storage = await storageWithOptimizer(context);
          const run = await claimed(storage, "anna", 0);
          expect(await storage.finishMemoryOptimizationRun("boris", run.id, { status: "failed", finishedAt: at(1), error: "x" })).toBe("not_found");
          expect(await storage.finishMemoryOptimizationRun("anna", "missing", { status: "failed", finishedAt: at(1), error: "x" })).toBe("not_found");
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.status).toBe("running");
          await storage.finishMemoryOptimizationRun("anna", run.id, { status: "no_changes", finishedAt: at(1) });
          expect(await storage.finishMemoryOptimizationRun("anna", run.id, { status: "failed", finishedAt: at(2), error: "x" })).toBe("not_found");
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]).toMatchObject({ status: "no_changes", finishedAt: at(1) });
        });
      });

      describe("слияние", () => {
        it("вставляет результат (версия 1), прячет оригиналы, закрывает запуск как слитый со склейкой", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, second, third, run, merge } = await withRun(storage);
          const applied = await storage.applyMemoryMerge("anna", merge(at(5)));
          expect(typeof applied).toBe("object");
          const visible = await storage.listMemoryNotes("anna");
          expect(visible.map((item) => item.content).sort()).toEqual(["Любит чай", "Пишет на TypeScript на работе"]);
          const result = visible.find((item) => item.content === "Пишет на TypeScript на работе")!;
          expect(result).toMatchObject({ version: 1, categories: ["О себе", "Работа"] });
          expect(applied).toEqual({
            id: run.id,
            startedAt: run.startedAt,
            finishedAt: at(5),
            status: "applied",
            groups: [{ resultId: result.id, originalIds: [first.id, second.id], resultVersion: 1 }],
            error: null,
            usageRecordId: null,
          });
          expect(await storage.listMemoryOptimizationRuns("anna")).toEqual([applied]);
          expect(visible.find((item) => item.id === third.id)).toEqual(third);
        });

        it("скрытые оригиналы читаются отдельным списком с id результата и прежними версией и временем", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, second, merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          const [result] = (await storage.listMemoryNotes("anna")).filter((item) => item.content.endsWith("на работе"));
          const hidden = await storage.listMergedMemoryNotes("anna");
          expect(hidden.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
          for (const item of hidden) {
            expect(item.mergedInto).toBe(result!.id);
            expect(item).toMatchObject({ version: 1, categories: ["О себе", "Работа"] });
          }
          expect(await storage.listMergedMemoryNotes("boris")).toEqual([]);
        });

        it("оригинал, изменённый за время работы модели, — stale_version, и ничего не меняется", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, run, merge } = await withRun(storage);
          await storage.updateMemoryNote("anna", first.id, 1, note("Пишет на Rust", "О себе"));
          const before = await storage.listMemoryNotes("anna");
          expect(await storage.applyMemoryMerge("anna", merge())).toBe("stale_version");
          expect(await storage.listMemoryNotes("anna")).toEqual(before);
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]).toMatchObject({ id: run.id, status: "running", groups: [] });
        });

        it("оригинал удалён — stale_version", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { second, merge } = await withRun(storage);
          await storage.deleteMemoryNote("anna", second.id, 1);
          expect(await storage.applyMemoryMerge("anna", merge())).toBe("stale_version");
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
        });

        it("оригинал чужой — stale_version, чужая запись цела", async (context) => {
          const storage = await storageWithOptimizer(context);
          const [theirs] = await storage.insertMemoryNotes("boris", [note("Чужая")]);
          const run = await claimed(storage, "anna", 0);
          const merge = { runId: run.id, finishedAt: at(1), merges: [{ result: note("Присвоено"), originals: [{ id: theirs!.id, version: 1 }] }] };
          expect(await storage.applyMemoryMerge("anna", merge)).toBe("stale_version");
          expect(await storage.listMemoryNotes("boris")).toEqual([theirs]);
          expect(await storage.listMemoryNotes("anna")).toEqual([]);
        });

        it("уже скрытый оригинал вторым слиянием не берётся — stale_version", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          const again = await storage.claimMemoryOptimizationRun("anna", { ...rules, minIntervalMs: 0 }, at(10));
          expect(again).not.toBeNull();
          const second = { runId: again!.id, finishedAt: at(11), merges: [{ result: note("Ещё раз"), originals: [{ id: first.id, version: 1 }] }] };
          expect(await storage.applyMemoryMerge("anna", second)).toBe("stale_version");
        });

        it("несколько склеек — все или ни одной", async (context) => {
          const storage = await storageWithOptimizer(context);
          const [a, b, c, d] = await storage.insertMemoryNotes("anna", [note("Кот Барсик"), note("Кот по имени Барсик"), note("Живёт на Бали"), note("Живёт на Бали в Чангу")]);
          await storage.updateMemoryNote("anna", d!.id, 1, note("Живёт на Бали, Чангу"));
          const run = await claimed(storage);
          const before = await storage.listMemoryNotes("anna");
          const outcome = await storage.applyMemoryMerge("anna", {
            runId: run.id,
            finishedAt: at(1),
            merges: [
              { result: note("Кот Барсик"), originals: [{ id: a!.id, version: 1 }, { id: b!.id, version: 1 }] },
              { result: note("Живёт на Бали в Чангу"), originals: [{ id: c!.id, version: 1 }, { id: d!.id, version: 1 }] },
            ],
          });
          expect(outcome).toBe("stale_version");
          expect(await storage.listMemoryNotes("anna")).toEqual(before);
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
        });

        it("запуск, которого нет, чужой или уже закрытый, — run_not_active", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, run, merge } = await withRun(storage);
          expect(await storage.applyMemoryMerge("anna", { ...merge(), runId: "missing" })).toBe("run_not_active");
          expect(await storage.applyMemoryMerge("boris", merge())).toBe("run_not_active");
          await storage.finishMemoryOptimizationRun("anna", run.id, { status: "failed", finishedAt: at(1), error: "x" });
          expect(await storage.applyMemoryMerge("anna", merge())).toBe("run_not_active");
          expect((await storage.listMemoryNotes("anna")).find((item) => item.id === first.id)).toBeDefined();
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
        });

        it("негодный вызов — исключение, и ничего не меняется", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, second, run } = await withRun(storage);
          const before = await storage.listMemoryNotes("anna");
          const original = (item: MemoryNote) => ({ id: item.id, version: item.version });
          const bad = [
            { runId: run.id, finishedAt: at(1), merges: [] },
            { runId: run.id, finishedAt: at(1), merges: [{ result: note("Пусто"), originals: [] }] },
            {
              runId: run.id,
              finishedAt: at(1),
              merges: [
                { result: note("Раз"), originals: [original(first), original(second)] },
                { result: note("Два"), originals: [original(first)] },
              ],
            },
            {
              runId: run.id,
              finishedAt: at(1),
              merges: [{ result: { categories: ["О себе"], content: null } as unknown as MemoryNoteInput, originals: [original(first), original(second)] }],
            },
          ];
          for (const merge of bad) await expect(storage.applyMemoryMerge("anna", merge)).rejects.toBeInstanceOf(Error);
          expect(await storage.listMemoryNotes("anna")).toEqual(before);
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.status).toBe("running");
        });
      });

      describe("скрытые записи", () => {
        it("правка и удаление скрытой записи — not_found; список её не показывает", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { first, merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          expect(await storage.updateMemoryNote("anna", first.id, 1, note("Правка скрытой"))).toBe("not_found");
          expect(await storage.deleteMemoryNote("anna", first.id, 1)).toBe("not_found");
          expect((await storage.listMemoryNotes("anna")).some((item) => item.id === first.id)).toBe(false);
          expect((await storage.listMergedMemoryNotes("anna")).some((item) => item.id === first.id && item.content === "Пишет на TypeScript")).toBe(true);
        });

        it("удаление результата удаляет и скрытые оригиналы; устаревшая версия ничего не удаляет", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { third, merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          const result = (await storage.listMemoryNotes("anna")).find((item) => item.content.endsWith("на работе"))!;
          expect(await storage.deleteMemoryNote("anna", result.id, 7)).toBe("stale_version");
          expect(await storage.listMergedMemoryNotes("anna")).toHaveLength(2);
          expect(await storage.deleteMemoryNote("anna", result.id, 1)).toBe("ok");
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
          expect((await storage.listMemoryNotes("anna")).map((item) => item.id)).toEqual([third.id]);
        });

        it("стирание памяти убирает скрытые оригиналы и запуски, считает только видимые, чужое не трогает", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          await storage.insertMemoryNotes("boris", [note("Борисова")]);
          const boris = await claimed(storage, "boris", 0);
          // Видны: результат и «Любит чай»; скрытых двое — они не считаются.
          expect(await storage.clearMemoryNotes("anna")).toBe(2);
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
          expect(await storage.listMemoryOptimizationRuns("anna")).toEqual([]);
          expect(await storage.listMemoryNotes("boris")).toHaveLength(1);
          expect(await storage.listMemoryOptimizationRuns("boris")).toEqual([expect.objectContaining({ id: boris.id })]);
        });
      });

      describe("возврат слияния", () => {
        it("возвращает оригиналы как были, убирает результат, запуск становится отменённым", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { run, merge } = await withRun(storage);
          const before = await storage.listMemoryNotes("anna");
          const applied = (await storage.applyMemoryMerge("anna", merge())) as { groups: unknown };
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("ok");
          expect(await storage.listMemoryNotes("anna")).toEqual(before);
          expect(await storage.listMergedMemoryNotes("anna")).toEqual([]);
          const [reverted] = await storage.listMemoryOptimizationRuns("anna");
          expect(reverted).toMatchObject({ id: run.id, status: "reverted", groups: applied.groups });
          expect(reverted?.finishedAt).toBe(at(5));
        });

        it("результат менялся — conflict, ничего не меняется", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { run, merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          const result = (await storage.listMemoryNotes("anna")).find((item) => item.content.endsWith("на работе"))!;
          await storage.updateMemoryNote("anna", result.id, 1, note("Пишет на TypeScript в компании", "О себе", "Работа"));
          const visible = await storage.listMemoryNotes("anna");
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("conflict");
          expect(await storage.listMemoryNotes("anna")).toEqual(visible);
          expect(await storage.listMergedMemoryNotes("anna")).toHaveLength(2);
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.status).toBe("applied");
        });

        it("результат удалён (вместе с оригиналами) — conflict", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { run, merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          const result = (await storage.listMemoryNotes("anna")).find((item) => item.content.endsWith("на работе"))!;
          await storage.deleteMemoryNote("anna", result.id, 1);
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("conflict");
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.status).toBe("applied");
        });

        it("запуск, которого нет, чужой, идущий, без слияния или уже отменённый, — not_found", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { run, merge } = await withRun(storage);
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("not_found");
          expect(await storage.revertMemoryMerge("anna", "missing")).toBe("not_found");
          await storage.applyMemoryMerge("anna", merge());
          expect(await storage.revertMemoryMerge("boris", run.id)).toBe("not_found");
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("ok");
          expect(await storage.revertMemoryMerge("anna", run.id)).toBe("not_found");
          const quiet = await storageWithOptimizer(context);
          const idle = await claimed(quiet);
          await quiet.finishMemoryOptimizationRun("anna", idle.id, { status: "no_changes", finishedAt: at(1) });
          expect(await quiet.revertMemoryMerge("anna", idle.id)).toBe("not_found");
        });

        describe("проверка пределов при возврате", () => {
          /** Слияние применено; результат — «… на работе». Гарды пишут, что видели. */
          async function applied(storage: OptimizerStorage) {
            const setup = await withRun(storage);
            await storage.applyMemoryMerge("anna", setup.merge());
            return setup;
          }

          it("проверка видит записи без результатов слияния и оригиналы, что вернутся; пропустила — возврат выполнен", async (context) => {
            const storage = await storageWithOptimizer(context);
            const { run, first, second } = await applied(storage);
            const seen: { remaining: string[]; restored: string[] }[] = [];
            const result = await storage.revertMemoryMerge("anna", run.id, (remaining, restored) => {
              seen.push({ remaining: remaining.map((item) => item.content), restored: restored.map((item) => item.id).sort() });
              return null;
            });
            expect(result).toBe("ok");
            expect(seen).toEqual([{ remaining: ["Любит чай"], restored: [first.id, second.id].sort() }]);
            expect(await storage.listMemoryNotes("anna")).toHaveLength(3);
          });

          for (const kind of ["limit_reached", "duplicate"] as const) {
            it(`ошибка проверки ${kind} — тот же результат, ничего не изменено, запуск остаётся слитым`, async (context) => {
              const storage = await storageWithOptimizer(context);
              const { run } = await applied(storage);
              const visible = await storage.listMemoryNotes("anna");
              const hidden = await storage.listMergedMemoryNotes("anna");
              expect(await storage.revertMemoryMerge("anna", run.id, () => ({ kind, message: "Нельзя" }))).toBe(kind);
              expect(await storage.listMemoryNotes("anna")).toEqual(visible);
              expect(await storage.listMergedMemoryNotes("anna")).toEqual(hidden);
              expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.status).toBe("applied");
              // Место освободили — тот же возврат теперь проходит.
              expect(await storage.revertMemoryMerge("anna", run.id, () => null)).toBe("ok");
            });
          }

          it("проверка не зовётся, если возврат невозможен: конфликт, чужой или несуществующий запуск", async (context) => {
            const storage = await storageWithOptimizer(context);
            const { run } = await applied(storage);
            const result = (await storage.listMemoryNotes("anna")).find((item) => item.content.endsWith("на работе"))!;
            await storage.updateMemoryNote("anna", result.id, 1, note("Пишет на TypeScript в компании", "О себе", "Работа"));
            let calls = 0;
            const guard = () => {
              calls += 1;
              return null;
            };
            expect(await storage.revertMemoryMerge("anna", run.id, guard)).toBe("conflict");
            expect(await storage.revertMemoryMerge("boris", run.id, guard)).toBe("not_found");
            expect(await storage.revertMemoryMerge("anna", "missing", guard)).toBe("not_found");
            expect(calls).toBe(0);
          });
        });
      });

      describe("список запусков", () => {
        it("новейшие первыми, с отбором по состоянию и числу; чужих нет", async (context) => {
          const storage = await storageWithOptimizer(context);
          const day = 24 * 60;
          const oldest = await claimed(storage, "anna", 0);
          await storage.finishMemoryOptimizationRun("anna", oldest.id, { status: "no_changes", finishedAt: at(1) });
          const middle = await claimed(storage, "anna", 2 * day);
          await storage.finishMemoryOptimizationRun("anna", middle.id, { status: "failed", finishedAt: at(2 * day + 1), error: "x" });
          const newest = await claimed(storage, "anna", 4 * day);
          await claimed(storage, "boris", 0);
          expect((await storage.listMemoryOptimizationRuns("anna")).map((run) => run.id)).toEqual([newest.id, middle.id, oldest.id]);
          expect((await storage.listMemoryOptimizationRuns("anna", { limit: 2 })).map((run) => run.id)).toEqual([newest.id, middle.id]);
          expect((await storage.listMemoryOptimizationRuns("anna", { status: ["failed", "no_changes"] })).map((run) => run.id)).toEqual([middle.id, oldest.id]);
          expect(await storage.listMemoryOptimizationRuns("anna", { status: ["reverted"] })).toEqual([]);
          expect(await storage.listMemoryOptimizationRuns("clara")).toEqual([]);
        });

        it("отданные запуски и скрытые записи — копии", async (context) => {
          const storage = await storageWithOptimizer(context);
          const { merge } = await withRun(storage);
          await storage.applyMemoryMerge("anna", merge());
          const [run] = await storage.listMemoryOptimizationRuns("anna");
          run!.groups[0]!.originalIds.push("лишний");
          run!.groups.push({ resultId: "x", originalIds: [], resultVersion: 1 });
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.groups).toHaveLength(1);
          expect((await storage.listMemoryOptimizationRuns("anna"))[0]?.groups[0]?.originalIds).toHaveLength(2);
          const [hidden] = await storage.listMergedMemoryNotes("anna");
          hidden!.categories.push("Лишний");
          expect((await storage.listMergedMemoryNotes("anna"))[0]?.categories).toEqual(["О себе", "Работа"]);
        });
      });
    });
  });
}

/** Модель для проверок виджета: первый запрос в каждом чате — вызов ask_choice, дальше — короткий текст. */
function widgetModel() {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } };
  const finish = (reason: "stop" | "tool-calls") => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
  const asked = (prompt: unknown) => JSON.stringify(prompt).includes('"tool-result"');
  return {
    specificationVersion: "v4",
    provider: "contract",
    modelId: "contract-v1",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("Проверкам виджета doGenerate не нужен");
    },
    doStream: async ({ prompt }: { prompt: unknown }) => {
      const parts = asked(prompt)
        ? [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Готово" }, { type: "text-end", id: "t" }, finish("stop")]
        : [{ type: "tool-call", toolCallId: "w1", toolName: "ask_choice", input: JSON.stringify({ question: "Какой тариф?", options: ["Базовый", "Про"] }) }, finish("tool-calls")];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of [{ type: "stream-start", warnings: [] }, ...parts]) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}

const widgetQuestion = (id = "u1") => ({ id, role: "user" as const, parts: [{ type: "text" as const, text: "помоги выбрать тариф" }] });

/** Служба чата с базовыми виджетами на этом хранилище: как отдельная копия сервера. */
function widgetService(storage: ChatStorage): ChatService {
  const model = widgetModel();
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [
      {
        id: "contract",
        displayName: "contract",
        apiKeyEnv: "CONTRACT_API_KEY",
        createLanguageModel: () => model as never,
        requestOptions: () => ({}),
      },
    ],
    addModels: [
      {
        id: "contract-model",
        displayName: "Contract Model",
        contextWindowTokens: 100_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { contract: "contract-v1" },
      },
    ],
  });
  return createChatService({
    storage,
    catalog,
    defaultChoice: { modelId: "contract-model", providerId: "contract" },
    agent: { instructions: "Ты помощник.", widgets: { basic: true } },
    env: { CONTRACT_API_KEY: "не-настоящий-ключ" },
    logError: () => {},
  });
}

/** Служба с инструментом поиска: первый шаг ответа вызывает `find`, второй — пишет текст. Запросы к модели копятся в `prompts`. */
function editAnswerService(storage: ChatStorage, lockedToolOutputs?: readonly string[]): { service: ChatService; prompts: unknown[] } {
  const prompts: unknown[] = [];
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
  const finish = (reason: "stop" | "tool-calls") => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
  const text = (id: string, delta: string) => [{ type: "text-start", id }, { type: "text-delta", id, delta }, { type: "text-end", id }];
  const model = {
    specificationVersion: "v4",
    provider: "contract",
    modelId: "contract-v1",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("Проверкам правки ответа doGenerate не нужен");
    },
    doStream: async ({ prompt }: { prompt: readonly { role: string }[] }) => {
      prompts.push(prompt);
      const parts =
        prompt.at(-1)?.role === "tool"
          ? [...text("t2", "Нашёл отчёт."), finish("stop")]
          : [...text("t1", "Ищу отчёт."), { type: "tool-call", toolCallId: prompts.length === 1 ? "f1" : `f${prompts.length}`, toolName: "find", input: JSON.stringify({ name: "отчёт" }) }, finish("tool-calls")];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of [{ type: "stream-start", warnings: [] }, ...parts]) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [
      {
        id: "contract",
        displayName: "contract",
        apiKeyEnv: "CONTRACT_API_KEY",
        createLanguageModel: () => model as never,
        requestOptions: () => ({}),
      },
    ],
    addModels: [
      {
        id: "contract-model",
        displayName: "Contract Model",
        contextWindowTokens: 100_000,
        acceptsImages: false,
        reasoning: { replayPastTurns: true },
        providerModelIds: { contract: "contract-v1" },
      },
    ],
  });
  const find = {
    description: "Найти файл",
    inputSchema: jsonSchema<{ name: string }>({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }),
    execute: async () => "нашёл: отчёт.pdf",
  };
  const service = createChatService({
    storage,
    catalog,
    defaultChoice: { modelId: "contract-model", providerId: "contract" },
    agent: { instructions: "Ты помощник.", tools: { find } },
    env: { CONTRACT_API_KEY: "не-настоящий-ключ" },
    logError: () => {},
    ...(lockedToolOutputs && { lockedToolOutputs }),
  });
  return { service, prompts };
}

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}
