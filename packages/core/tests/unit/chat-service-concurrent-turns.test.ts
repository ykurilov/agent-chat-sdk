import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { MessageAttachments } from "../../src/attachments/message-attachments";
import { createChatService, TooManyTurnsError } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { createRunningAnswerRegistry } from "../../src/running-answers/running-answer-registry";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamStart, textParts } from "./support/mock-model";

const user = (id: string, text = "Привет") => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

/** Модель держит ответы, пока тест не вызовет `release`; `hold` снова начинает держать следующие. */
function heldModel() {
  let release!: () => void;
  let released!: Promise<void>;
  const hold = () => {
    released = new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  hold();
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const gate = released;
      return {
        stream: new ReadableStream({
          async start(controller) {
            for (const part of [streamStart, ...textParts(["Ок"])]) controller.enqueue(part);
            await gate;
            controller.enqueue(finishPart());
            controller.close();
          },
        }),
      };
    },
  });
  return { model, release: () => release(), hold };
}

function setup(extra: Partial<ChatServiceOptions> = {}) {
  const held = heldModel();
  const storage = createInMemoryChatStorage();
  const registry = createRunningAnswerRegistry();
  const service = createChatService({
    storage,
    registry,
    catalog: mockCatalog({ mock: held.model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: mockEnv,
    logError: vi.fn(),
    ...extra,
  });
  return { service, storage, registry, ...held };
}

async function chats(service: ReturnType<typeof setup>["service"], count: number, owner = "anna") {
  return Promise.all(Array.from({ length: count }, () => service.createChat(owner)));
}

describe("служба чата: одновременные ответы одного человека", () => {
  it("20 отправок разом в 20 чатах — стартуют 3, остальным отказ, их вопросы не записаны", async () => {
    const { service, storage, model, release } = setup();
    const list = await chats(service, 20);
    const results = await Promise.allSettled(list.map((chat, index) => service.sendMessage("anna", chat.id, user(`u${index}`))));

    const started = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(started).toHaveLength(3);
    expect(refused).toHaveLength(17);
    for (const result of refused) {
      expect(result.reason).toBeInstanceOf(TooManyTurnsError);
      expect(result.reason).toMatchObject({ limit: 3 });
    }
    const written = await Promise.all(list.map((chat) => storage.listMessages(chat.id)));
    expect(written.filter((messages) => messages.length > 0)).toHaveLength(3);

    release();
    await Promise.all(started.map((result) => readAll((result as PromiseFulfilledResult<ReadableStream<unknown>>).value)));
    expect(model.doStreamCalls).toHaveLength(3);
  });

  it("ответ закончился — место освободилось, следующий ход стартует", async () => {
    const { service, registry, release } = setup({ maxConcurrentTurnsPerUser: 1 });
    const [first, second] = await chats(service, 2);
    const running = await service.sendMessage("anna", first!.id, user("u1"));
    await expect(service.sendMessage("anna", second!.id, user("u2"))).rejects.toBeInstanceOf(TooManyTurnsError);

    release();
    await readAll(running);
    await registry.finished(first!.id);
    await readAll(await service.sendMessage("anna", second!.id, user("u3")));
    expect((await service.getHistory("anna", second!.id)).messages.map((message) => message.id)).toContain("u3");
  });

  it("лимит у каждого свой: занятые места Анны не мешают Борису", async () => {
    const { service, release } = setup({ maxConcurrentTurnsPerUser: 1 });
    const [anna] = await chats(service, 1, "anna");
    const [boris] = await chats(service, 1, "boris");
    const annaTurn = await service.sendMessage("anna", anna!.id, user("u1"));
    const borisTurn = await service.sendMessage("boris", boris!.id, user("u2"));
    release();
    await Promise.all([readAll(annaTurn), readAll(borisTurn)]);
    expect((await service.getHistory("boris", boris!.id)).messages.map((message) => message.id)).toContain("u2");
  });

  it("отказ до записи (неверное сообщение, чат занят) место не держит", async () => {
    const { service, registry, release } = setup({ maxConcurrentTurnsPerUser: 1 });
    const [first, second] = await chats(service, 2);
    await expect(service.sendMessage("anna", first!.id, { id: "bad", role: "user", parts: [] })).rejects.toThrow();
    const running = await service.sendMessage("anna", first!.id, user("u1"));
    await expect(service.sendMessage("anna", first!.id, user("u2"))).rejects.toMatchObject({ name: "ChatBusyError" });
    release();
    await readAll(running);
    await registry.finished(first!.id);
    await readAll(await service.sendMessage("anna", second!.id, user("u3")));
    expect((await service.getHistory("anna", second!.id)).messages.map((message) => message.id)).toContain("u3");
  });

  it("повтор, переделка и правка тоже занимают место", async () => {
    const { service, registry, release, hold } = setup({ maxConcurrentTurnsPerUser: 1 });
    const [first, second] = await chats(service, 2);
    release();
    await readAll(await service.sendMessage("anna", first!.id, user("u1")));
    await registry.finished(first!.id);
    const answerId = (await service.getHistory("anna", first!.id)).messages.find((message) => message.role === "assistant")!.id;

    hold();
    const running = await service.sendMessage("anna", second!.id, user("u2"));
    await expect(service.regenerate("anna", first!.id, answerId)).rejects.toBeInstanceOf(TooManyTurnsError);
    await expect(service.editMessage("anna", first!.id, "u1", user("u1-edit"))).rejects.toBeInstanceOf(TooManyTurnsError);
    expect((await service.getHistory("anna", first!.id)).messages.map((message) => message.id)).not.toContain("u1-edit");
    release();
    await readAll(running);
    await registry.finished(second!.id);
    await readAll(await service.regenerate("anna", first!.id, answerId));
  });

  it("Infinity — без ограничения; 0, дробь и отрицательное — ошибка при создании", () => {
    expect(() => setup({ maxConcurrentTurnsPerUser: Number.POSITIVE_INFINITY })).not.toThrow();
    for (const wrong of [0, -1, 1.5, Number.NaN]) {
      expect(() => setup({ maxConcurrentTurnsPerUser: wrong })).toThrow(/maxConcurrentTurnsPerUser/);
    }
  });
});

const fileRef = { type: "file" as const, url: "attachment:f1", mediaType: "image/png", filename: "cat.png" };
const withFile = (id: string) => ({ id, role: "user" as const, parts: [fileRef, { type: "text" as const, text: "Что на фото?" }] });

function fakeAttachments(): MessageAttachments {
  return {
    acceptUserParts: vi.fn(async ({ parts }: Parameters<MessageAttachments["acceptUserParts"]>[0]) => parts.map(() => fileRef)),
    confirmUserParts: vi.fn(async () => undefined),
    prepareHistory: vi.fn(async ({ history }: Parameters<MessageAttachments["prepareHistory"]>[0]) => [...history]),
  };
}

describe("служба чата: отказ по месту — до приёма файлов", () => {
  it("мест нет: отправка и правка с файлом — TooManyTurnsError, файлы не принимались (не остаются ничьими)", async () => {
    const attachments = fakeAttachments();
    const { service, registry, release, hold } = setup({ maxConcurrentTurnsPerUser: 1, attachments });
    const [first, second] = await chats(service, 2);
    release();
    await readAll(await service.sendMessage("anna", first!.id, user("u1")));
    await registry.finished(first!.id);

    hold();
    const running = await service.sendMessage("anna", second!.id, user("u2"));
    await expect(service.sendMessage("anna", first!.id, withFile("u3"))).rejects.toBeInstanceOf(TooManyTurnsError);
    await expect(service.editMessage("anna", first!.id, "u1", withFile("u1-edit"))).rejects.toBeInstanceOf(TooManyTurnsError);
    expect(attachments.acceptUserParts).not.toHaveBeenCalled();
    release();
    await readAll(running);
  });

  it("чат занят: отправка с файлом — ChatBusyError, файлы не принимались", async () => {
    const attachments = fakeAttachments();
    const { service, release } = setup({ attachments });
    const [chat] = await chats(service, 1);
    const running = await service.sendMessage("anna", chat!.id, user("u1"));
    await expect(service.sendMessage("anna", chat!.id, withFile("u2"))).rejects.toMatchObject({ name: "ChatBusyError" });
    expect(attachments.acceptUserParts).not.toHaveBeenCalled();
    release();
    await readAll(running);
  });

  it("файлы отклонены — место не держится", async () => {
    const attachments = { ...fakeAttachments(), acceptUserParts: vi.fn(async () => Promise.reject(new Error("не тот файл"))) };
    const { service, release } = setup({ maxConcurrentTurnsPerUser: 1, attachments });
    const [first, second] = await chats(service, 2);
    await expect(service.sendMessage("anna", first!.id, withFile("u1"))).rejects.toThrow("не тот файл");
    release();
    await readAll(await service.sendMessage("anna", second!.id, user("u2")));
  });
});

/** Служба с одним местом на человека и моделью `model`. */
function oneSlotWith(model: MockLanguageModelV4) {
  const registry = createRunningAnswerRegistry();
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    registry,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: mockEnv,
    logError: vi.fn(),
    maxConcurrentTurnsPerUser: 1,
  });
  return { service, registry };
}

const answeringModel = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of [streamStart, ...textParts(["Ок"]), finishPart()]) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });

/** Ход закончился любым путём — следующий ход того же человека стартует. */
async function expectSlotFreed(service: ReturnType<typeof oneSlotWith>["service"], registry: ReturnType<typeof oneSlotWith>["registry"], chatId: string) {
  await registry.finished(chatId);
  const next = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", next.id, user("next")));
}

describe("служба чата: место освобождается на любом конце хода", () => {
  it("модель упала при открытии потока", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("ключ неверный"), { statusCode: 401 });
        return answeringModel().doStream(options);
      },
    });
    const { service, registry } = oneSlotWith(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, user("u1")));
    await expectSlotFreed(service, registry, chat.id);
  });

  it("поток модели оборвался ошибкой на середине", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls += 1;
        if (calls > 1) return answeringModel().doStream(options);
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const part of [streamStart, ...textParts(["Нача"])]) controller.enqueue(part);
              controller.error(new Error("связь с провайдером оборвалась"));
            },
          }),
        };
      },
    });
    const { service, registry } = oneSlotWith(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, user("u1")));
    await expectSlotFreed(service, registry, chat.id);
  });

  it("человек закрыл вкладку (поток ответа отменён): ход дорабатывает и отдаёт место", async () => {
    const { service, registry } = oneSlotWith(answeringModel());
    const chat = await service.createChat("anna");
    await (await service.sendMessage("anna", chat.id, user("u1"))).cancel();
    await expectSlotFreed(service, registry, chat.id);
  });

  it("модель молчит без конца: «Стоп» обрывает ход и отдаёт место", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls += 1;
        if (calls > 1) return answeringModel().doStream(options);
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(streamStart);
              options.abortSignal?.addEventListener("abort", () => controller.error(options.abortSignal!.reason));
            },
          }),
        };
      },
    });
    const { service, registry } = oneSlotWith(model);
    const chat = await service.createChat("anna");
    const running = await service.sendMessage("anna", chat.id, user("u1"));
    await service.stop("anna", chat.id);
    await readAll(running);
    await expectSlotFreed(service, registry, chat.id);
  });
});

