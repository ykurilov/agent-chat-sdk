import { createAttachments, createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { createInMemoryChatStorage, extendCatalog } from "@ykurilov/agent-chat-core";
import type { AgentToolsModel, ChatStorage, ModelCatalog, SpendingLimits, StoredMessage, TurnResult, UsageRecord } from "@ykurilov/agent-chat-core";
import { createLongTermMemory } from "@ykurilov/agent-chat-memory";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { ModelStep } from "./support/sandbox-setup";
import { catalogWithModel, mockModelId, setupSandbox } from "./support/sandbox-setup";

/** Настоящая картинка PNG 1×1: вложения её читают и ужимают. */
const pngBytes = () => Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

const people = [
  { id: "vera", name: "Вера Петрова", hint: "vera@example.com" },
  { id: "gleb", name: "Глеб" },
];

type Setup = ReturnType<typeof setupSandbox>;

/**
 * Песочница с людьми: Вера (`vera`) — обычный человек приложения со своими чатами. Инструмент `who_am_i` показывает,
 * какую модель хода получили инструменты приложения.
 */
function withPeople(options: { steps?: ModelStep[]; attachments?: boolean; people?: "find" | "manual" | "none"; storage?: ChatStorage; memory?: ReturnType<typeof createLongTermMemory>; catalog?: ModelCatalog; afterTurn?: boolean } = {}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const usage: UsageRecord[] = [];
  const insertUsageRecord = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    usage.push(record);
    await insertUsageRecord(record);
  };
  const toolModels: AgentToolsModel[] = [];
  const turns: TurnResult[] = [];
  const attachments = options.attachments ? createAttachments({ storage: createMemoryAttachmentStorage() }) : undefined;
  const limitChecks: string[] = [];
  const limits = {
    assertWithinLimit: async ({ userId }: { userId: string }) => void limitChecks.push(userId),
    status: async () => ({ state: "ok" }),
  } as unknown as SpendingLimits;
  const find = vi.fn(async (query: string) => people.filter((person) => person.name.toLowerCase().includes(query.toLowerCase())));
  const setup = setupSandbox({
    storage,
    steps: options.steps,
    chat: {
      ...(options.catalog && { catalog: options.catalog }),
      ...(attachments && { attachments }),
      ...(options.memory && { memory: options.memory }),
      ...(options.afterTurn && { afterTurn: (turn: TurnResult) => void turns.push(turn) }),
      agent: {
        instructions: "Ты помощник.",
        tools: (model) => {
          toolModels.push(model);
          return {
            who_am_i: tool({
              description: "Кто я.",
              inputSchema: jsonSchema({ type: "object", properties: {} }),
              execute: async () => ({ ownerId: model.ownerId, staff: model.staff ?? null }),
            }),
          };
        },
      },
    },
    sandbox: { limits, ...({ find: { people: { find } }, manual: { people: true as const }, none: {} } as const)[options.people ?? "find"] },
  });
  return { setup, storage, usage, toolModels, turns, attachments, limitChecks, find };
}

/** Ход Веры в боевом чате: дочитывает поток. */
async function sendAsPerson(setup: Setup, chatId: string, text: string, parts: unknown[] = [], user = "vera"): Promise<void> {
  const response = await setup.callBattle("POST", `/${chatId}/messages`, {
    user,
    body: { message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }, ...parts] } },
  });
  if (response.status !== 200) throw new Error(`ход не принят: ${response.status} ${await response.text()}`);
  await response.text();
  await setup.battle.handler.flush();
}

/** Боевой чат Веры с одним вопросом и ответом. */
async function personChat(setup: Setup, text = "Как дела?", user = "vera"): Promise<string> {
  const created = await setup.callBattle("POST", "", { user, body: {} });
  const { id } = (await created.json()) as { id: string };
  await sendAsPerson(setup, id, text, [], user);
  return id;
}

/** Чат `chatId` человека `ownerId` с теми же сообщениями, что `source`: id чата задаёт тест. */
async function chatWithMessages(storage: ChatStorage, source: StoredMessage[], ownerId: string, chatId: string): Promise<void> {
  await storage.createChat({ id: chatId, ownerId, modelId: mockModelId, providerId: "mock" });
  const ids = new Map(source.map((message) => [message.id, crypto.randomUUID()]));
  for (const message of source) {
    await storage.insertMessage({ ...message, id: ids.get(message.id)!, chatId, parentId: message.parentId && ids.get(message.parentId)! });
  }
}

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  return (await (await response).json()) as T;
}

/** Что видит сам человек: история чата и список чатов. */
async function personView(setup: Setup, chatId: string, user = "vera") {
  return {
    history: await json(setup.callBattle("GET", `/${chatId}`, { user })),
    chats: await json(setup.callBattle("GET", "", { user })),
  };
}

async function copyChat(setup: Setup, person: string, chatId: string, user = "anna"): Promise<string> {
  const response = await setup.call("POST", `/people/${person}/${chatId}/staff-copy`, { user });
  if (response.status !== 201) throw new Error(`копия не создана: ${response.status} ${await response.text()}`);
  return (await json<{ id: string }>(response)).id;
}

describe("чаты людей: доступ только админу песочницы (T060)", () => {
  it("не-админ, гость и отказ приложения получают 404 на всех новых адресах", async () => {
    const { setup, find } = withPeople();
    const chatId = await personChat(setup);
    const paths: Array<[string, string]> = [
      ["GET", "/people?query=вера"],
      ["GET", "/people/vera/chats"],
      ["GET", `/people/vera/${chatId}`],
      ["GET", "/people/vera/models"],
      ["GET", `/people/vera/${chatId}/attachments/${crypto.randomUUID()}`],
      ["POST", `/people/vera/${chatId}/staff-copy`],
    ];
    for (const [method, path] of paths) {
      for (const user of ["vera", null]) {
        const response = await setup.call(method, path, { user });
        expect(response.status, `${method} ${path} от ${user}`).toBe(404);
        expect(await response.json()).toEqual({ error: { kind: "not_found" } });
      }
    }
    expect(find).not.toHaveBeenCalled();
  });

  it("отказ приложения в доступе (resolveUser с отказом) — тоже 404", async () => {
    const { setup } = withPeople();
    const chatId = await personChat(setup);
    setup.chat.resolveUser = async () => ({ refused: { code: "blocked", message: "Нет доступа" } });
    expect((await setup.call("GET", `/people/vera/${chatId}`)).status).toBe(404);
    expect((await setup.call("POST", `/people/vera/${chatId}/staff-copy`)).status).toBe(404);
  });
});

describe("чаты людей: поиск человека", () => {
  it("с `people.find` — поиск приложением", async () => {
    const { setup, find } = withPeople();
    const body = await json(setup.call("GET", "/people?query=вера"));
    expect(body).toEqual({ search: true, people: [people[0]] });
    expect(find).toHaveBeenCalledWith("вера");
  });

  it("`people: true` — поиска нет, экран вводит id вручную", async () => {
    const { setup } = withPeople({ people: "manual" });
    expect(await json(setup.call("GET", "/people?query=вера"))).toEqual({ search: false, people: [] });
    const chatId = await personChat(setup);
    expect((await setup.call("GET", `/people/vera/${chatId}`)).status).toBe(200);
  });

  it("без `people` — как до раздела: адресов `/people…` нет", async () => {
    const { setup } = withPeople({ people: "none" });
    const chatId = await personChat(setup);
    for (const [method, path] of [
      ["GET", "/people?query=вера"],
      ["GET", "/people/vera/chats"],
      ["GET", `/people/vera/${chatId}`],
      ["POST", `/people/vera/${chatId}/staff-copy`],
    ] as const) {
      expect((await setup.call(method, path)).status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("чаты людей: только чтение", () => {
  it("список чатов человека — вместе с чатами объектов, без данных объекта", async () => {
    const { setup } = withPeople();
    const plain = await personChat(setup);
    const subject = await setup.battle.service.openSubjectChat({ ownerId: "vera", key: "lesson:7", data: { secret: "только серверу" }, title: "Урок 7" });
    const { chats } = await json<{ chats: Array<{ id: string; subjectKey?: string }> }>(setup.call("GET", "/people/vera/chats"));
    expect(chats.map((chat) => chat.id).sort()).toEqual([plain, subject.chat.id].sort());
    expect(chats.find((chat) => chat.id === subject.chat.id)?.subjectKey).toBe("lesson:7");
    expect(JSON.stringify(chats)).not.toContain("только серверу");
  });

  it("история чата человека — как у него самого, без данных объекта", async () => {
    const { setup } = withPeople();
    const { chat } = await setup.battle.service.openSubjectChat({ ownerId: "vera", key: "lesson:8", data: { secret: "только серверу" } });
    await sendAsPerson(setup, chat.id, "Объясни урок");
    const view = await json<{ messages: unknown[]; chat: Record<string, unknown> }>(setup.call("GET", `/people/vera/${chat.id}`));
    const own = await json<{ messages: unknown[] }>(setup.callBattle("GET", `/${chat.id}`, { user: "vera" }));
    expect(view.messages).toEqual(own.messages);
    expect(view.messages).toHaveLength(2);
    expect(view.chat).not.toHaveProperty("subjectData");
    expect(JSON.stringify(view)).not.toContain("только серверу");
  });

  it("чужой чат, песочный владелец и неизвестный адрес — 404", async () => {
    const { setup } = withPeople();
    const glebChat = await personChat(setup, "Привет", "gleb");
    const sandboxChat = await setup.createChat("boris");
    expect((await setup.call("GET", `/people/vera/${glebChat}`)).status).toBe(404);
    expect((await setup.call("GET", "/people/sandbox:boris/chats")).status).toBe(404);
    expect((await setup.call("GET", `/people/sandbox:boris/${sandboxChat}`)).status).toBe(404);
    expect((await setup.call("GET", "/people/sandbox%3Aboris/chats")).status).toBe(404);
    expect((await setup.call("GET", `/people/sandbox%3Aboris/${sandboxChat}`)).status).toBe(404);
    expect((await setup.call("GET", `/people/vera/${glebChat}/watch`)).status).toBe(404);
  });

  it("ни одна запись в чат человека через песочницу невозможна, его чат не меняется", async () => {
    const { setup } = withPeople();
    const chatId = await personChat(setup);
    const before = await personView(setup, chatId);
    const message = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "от админа" }] };
    const attempts: Array<[string, string, unknown?]> = [
      ["POST", `/people/vera/${chatId}/messages`, { message }],
      ["POST", `/people/vera/${chatId}/regenerate`, {}],
      ["PATCH", `/people/vera/${chatId}`, { title: "Новое" }],
      ["DELETE", `/people/vera/${chatId}`],
      ["POST", `/people/vera/${chatId}/branch`, { messageId: "x" }],
      ["POST", `/people/vera/${chatId}/attachments`, {}],
      ["PUT", `/people/vera/${chatId}/model`, { modelId: "mock-model", providerId: "mock" }],
    ];
    for (const [method, path, body] of attempts) {
      expect((await setup.call(method, path, body === undefined ? {} : { body })).status, `${method} ${path}`).toBe(404);
    }
    expect(await personView(setup, chatId)).toEqual(before);
  });

  it("просмотр пустого чата не пишет в него запомненный выбор модели человека", async () => {
    // Две модели: последний выбор Веры — вторая, а пустой чат стоит на первой.
    const catalog = extendCatalog(catalogWithModel(new MockLanguageModelV4()), {
      addModels: [{ id: "mock-second", displayName: "Mock Second", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { mock: "mock-v2" } }],
    });
    const { setup, storage } = withPeople({ catalog });
    await storage.saveUserModelChoice!("vera", { modelId: "mock-second", providerId: "mock" });
    const chat = await storage.createChat({ id: crypto.randomUUID(), ownerId: "vera", modelId: mockModelId, providerId: "mock" });
    const before = await storage.getChat(chat.id);
    expect((await setup.call("GET", `/people/vera/${chat.id}`)).status).toBe(200);
    expect(await storage.getChat(chat.id)).toEqual(before);
  });

  it("просмотр чата с брошенным ответом не прерывает ответ: хранилище не меняется", async () => {
    const { setup, storage } = withPeople();
    const template = (await storage.listMessages(await personChat(setup))).find((message) => message.role === "user")!;
    // Ответ брошен давно и единственный в ветке: обычный `getHistory` прервал бы его.
    const { id: chatId } = await storage.createChat({ id: crypto.randomUUID(), ownerId: "vera", modelId: mockModelId, providerId: "mock" });
    const question: StoredMessage = { ...template, id: crypto.randomUUID(), chatId, parentId: null, createdAt: "2020-01-01T00:00:00.000Z" };
    const abandoned: StoredMessage = {
      ...question, id: crypto.randomUUID(), role: "assistant", parentId: question.id, parts: [{ type: "text", text: "Начал отвечать" }],
      status: "streaming", createdAt: "2020-01-01T00:00:01.000Z",
    };
    await storage.insertMessage(question);
    await storage.insertMessage(abandoned);
    const before = await storage.listMessages(chatId);
    const view = await json<{ detachedAnswer: boolean }>(setup.call("GET", `/people/vera/${chatId}`));
    expect(view.detachedAnswer).toBe(true);
    expect(await storage.listMessages(chatId)).toEqual(before);
  });

  it("файл вложения человека открывается на чтение; из чужого чата — 404", async () => {
    const { setup, attachments } = withPeople({ attachments: true });
    const created = await setup.callBattle("POST", "", { user: "vera", body: {} });
    const { id: chatId } = (await created.json()) as { id: string };
    const ingested = await attachments!.ingestFile({ userId: "vera", chatId, bytes: pngBytes(), name: "фото.png" });
    if (!ingested.ok) throw new Error(ingested.reason);
    const fileId = ingested.attachment.id;
    await sendAsPerson(setup, chatId, "что на фото?", [{ type: "file", url: `attachment:${fileId}`, mediaType: "image/png", filename: "фото.png" }]);

    const file = await setup.call("GET", `/people/vera/${chatId}/attachments/${fileId}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    const otherChat = await personChat(setup, "привет", "gleb");
    expect((await setup.call("GET", `/people/gleb/${otherChat}/attachments/${fileId}`)).status).toBe(404);
    expect((await setup.call("DELETE", `/people/vera/${chatId}/attachments/${fileId}`)).status).toBe(404);
  });
});

describe("проверка в копии", () => {
  it("копия текущей ветки — песочный чат админа с ключом копии и заголовком «Копия: …»", async () => {
    const { setup } = withPeople({ steps: [{ text: "Хорошо" }, { text: "Отлично" }, { text: "Иначе" }] });
    const chatId = await personChat(setup, "Как дела?");
    await sendAsPerson(setup, chatId, "А погода?");
    // Правка второго вопроса: у Веры две ветки, текущая — с «А завтра?».
    const history = await json<{ messages: Array<{ id: string; role: string }> }>(setup.callBattle("GET", `/${chatId}`, { user: "vera" }));
    const secondQuestion = history.messages[2]!.id;
    const edited = await setup.callBattle("POST", `/${chatId}/edit`, {
      user: "vera",
      body: { editedMessageId: secondQuestion, message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "А завтра?" }] } },
    });
    expect(edited.status).toBe(200);
    await edited.text();
    await setup.battle.handler.flush();
    const before = await personView(setup, chatId);

    const copyId = await copyChat(setup, "vera", chatId);
    const copy = await setup.storage.getChat(copyId);
    expect(copy).toMatchObject({ ownerId: "sandbox:anna", subjectKey: `staff-copy:vera:${chatId}:1`, title: "Копия: Как дела?" });
    const copied = await json<{ messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> }>(setup.call("GET", `/${copyId}`));
    expect(copied.messages.map((message) => [message.role, message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")])).toEqual([
      ["user", "Как дела?"],
      ["assistant", "Хорошо"],
      ["user", "А завтра?"],
      ["assistant", "Иначе"],
    ]);

    // Копия видна в списке песочницы админа, вторая копия получает следующий номер.
    const { chats } = await json<{ chats: Array<{ id: string }> }>(setup.call("GET", ""));
    expect(chats.map((chat) => chat.id)).toContain(copyId);
    const secondCopy = await copyChat(setup, "vera", chatId);
    expect((await setup.storage.getChat(secondCopy))?.subjectKey).toBe(`staff-copy:vera:${chatId}:2`);
    // Второй админ копии первого не видит.
    expect((await setup.call("GET", `/${copyId}`, { user: "boris" })).status).toBe(404);

    expect(await personView(setup, chatId)).toEqual(before);
  });

  it("номер копии считается только по копиям того же человека и чата: `x` / `x:y` не путаются", async () => {
    const { setup, storage } = withPeople();
    const source = await storage.listMessages(await personChat(setup));
    // Чат `y` человека `x` и чат человека `x:y`: начало ключа копии второго совпадает с ключом копии первого.
    await chatWithMessages(storage, source, "x:y", "c");
    await chatWithMessages(storage, source, "x", "y");
    await copyChat(setup, encodeURIComponent("x:y"), "c");
    const copyId = await copyChat(setup, "x", "y");
    expect((await storage.getChat(copyId))?.subjectKey).toBe("staff-copy:x:y:1");
  });

  it("пять копий одного чата одновременно — у всех разные номера, без ошибок", async () => {
    const { setup, storage } = withPeople();
    const chatId = await personChat(setup);
    const copies = await Promise.all([1, 2, 3, 4, 5].map(() => copyChat(setup, "vera", chatId)));
    const keys = await Promise.all(copies.map(async (copyId) => (await storage.getChat(copyId))?.subjectKey));
    expect(keys.sort()).toEqual([1, 2, 3, 4, 5].map((number) => `staff-copy:vera:${chatId}:${number}`));
  });

  it("картинки копируются через вложения: файл копии принадлежит песочнице, не человеку", async () => {
    const { setup, attachments } = withPeople({ attachments: true });
    const created = await setup.callBattle("POST", "", { user: "vera", body: {} });
    const { id: chatId } = (await created.json()) as { id: string };
    const ingested = await attachments!.ingestFile({ userId: "vera", chatId, bytes: pngBytes(), name: "фото.png" });
    if (!ingested.ok) throw new Error(ingested.reason);
    await sendAsPerson(setup, chatId, "что на фото?", [{ type: "file", url: `attachment:${ingested.attachment.id}`, mediaType: "image/png", filename: "фото.png" }]);

    const copyId = await copyChat(setup, "vera", chatId);
    const copied = await json<{ messages: Array<{ parts: Array<{ type: string; url?: string; mediaType?: string }> }> }>(setup.call("GET", `/${copyId}`));
    const file = copied.messages[0]!.parts.find((part) => part.type === "file");
    expect(file).toMatchObject({ mediaType: "image/png" });
    const copiedFileId = file!.url!.replace("attachment:", "");
    expect(copiedFileId).not.toBe(ingested.attachment.id);
    expect((await setup.call("GET", `/${copyId}/attachments/${copiedFileId}`)).status).toBe(200);
    expect((await setup.callBattle("GET", `/${chatId}/attachments/${copiedFileId}`, { user: "vera" })).status).toBe(404);
  });

  it("без вложений картинка в копии становится текстовой пометкой", async () => {
    const storage = createInMemoryChatStorage();
    const { setup } = withPeople({ storage });
    const chatId = await personChat(setup, "Смотри");
    // Картинка, записанная, когда вложения у приложения ещё были.
    const listMessages = storage.listMessages.bind(storage);
    storage.listMessages = async (id) =>
      (await listMessages(id)).map((message, index) =>
        id === chatId && index === 0
          ? { ...message, parts: [...message.parts, { type: "file" as const, url: `attachment:${crypto.randomUUID()}`, mediaType: "image/png", filename: "схема.png" }] }
          : message,
      );
    const copyId = await copyChat(setup, "vera", chatId);
    const copied = await json<{ messages: Array<{ parts: Array<{ type: string; text?: string }> }> }>(setup.call("GET", `/${copyId}`));
    expect(copied.messages[0]!.parts).toEqual([
      { type: "text", text: "Смотри" },
      { type: "text", text: "[картинка: схема.png]" },
    ]);
  });

  it("копия чужого или несуществующего чата — 404", async () => {
    const { setup } = withPeople();
    const glebChat = await personChat(setup, "Привет", "gleb");
    expect((await setup.call("POST", `/people/vera/${glebChat}/staff-copy`)).status).toBe(404);
    expect((await setup.call("POST", `/people/vera/${crypto.randomUUID()}/staff-copy`)).status).toBe(404);
  });
});

describe("ход в копии", () => {
  it("инструменты получают id человека и `staff` админа; расход и лимиты — песочного владельца; журнал пишется", async () => {
    const { setup, usage, toolModels, limitChecks } = withPeople({
      steps: [{ text: "Хорошо" }, { toolCall: { id: "w1", name: "who_am_i", input: {} } }, { text: "готово" }],
    });
    const chatId = await personChat(setup, "Как дела?");
    const before = await personView(setup, chatId);
    usage.length = 0;
    limitChecks.length = 0;
    toolModels.length = 0;

    const copyId = await copyChat(setup, "vera", chatId);
    await setup.send(copyId, "Кто я?");

    const toolEntry = (await setup.journal.listForChat(copyId)).find((entry) => entry.kind === "tool");
    const details = await setup.journal.getCall(toolEntry!.id);
    expect(details?.kind === "tool" && details.output?.content).toEqual({ ownerId: "vera", staff: { id: "anna" } });
    expect(toolModels.every((model) => model.ownerId === "vera" && model.staff?.id === "anna")).toBe(true);
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((record) => record.ownerId === "sandbox:anna" && record.chatId === copyId)).toBe(true);
    expect(limitChecks.length).toBeGreaterThan(0);
    expect(new Set(limitChecks)).toEqual(new Set(["sandbox:anna"]));

    expect(await personView(setup, chatId)).toEqual(before);
  });

  it("копия чата урока: инструменты и итог хода видят исходный объект человека, а не ключ копии", async () => {
    const { setup, toolModels, turns } = withPeople({ afterTurn: true, steps: [{ text: "Хорошо" }, { toolCall: { id: "w1", name: "who_am_i", input: {} } }, { text: "готово" }] });
    const { chat } = await setup.battle.service.openSubjectChat({ ownerId: "vera", key: "lesson:42", data: { lessonId: 42 } });
    await sendAsPerson(setup, chat.id, "Объясни урок");
    toolModels.length = 0;
    const copyId = await copyChat(setup, "vera", chat.id);
    await setup.send(copyId, "Объясни ещё раз");

    const lesson = { key: "lesson:42", data: { lessonId: 42 } };
    expect(toolModels.length).toBeGreaterThan(0);
    expect(toolModels.every((model) => model.ownerId === "vera" && model.staff?.id === "anna")).toBe(true);
    expect(toolModels.map((model) => model.subject)).toEqual(toolModels.map(() => lesson));
    const copyTurns = turns.filter((turn) => turn.chatId === copyId);
    expect(copyTurns).toHaveLength(1);
    expect(copyTurns[0]).toMatchObject({ ownerId: "vera", actorId: "anna", staff: { id: "anna" }, subject: lesson });
    expect(JSON.stringify([toolModels, copyTurns])).not.toContain("staff-copy:");
  });

  it("копия чата без объекта: `subject` нет ни у инструментов, ни у итога хода", async () => {
    const { setup, toolModels, turns } = withPeople({ afterTurn: true, steps: [{ text: "Хорошо" }, { toolCall: { id: "w1", name: "who_am_i", input: {} } }, { text: "готово" }] });
    const chatId = await personChat(setup);
    toolModels.length = 0;
    const copyId = await copyChat(setup, "vera", chatId);
    await setup.send(copyId, "Кто я?");

    expect(toolModels.length).toBeGreaterThan(0);
    expect(toolModels.every((model) => model.subject === undefined && model.staff?.id === "anna")).toBe(true);
    const [turn] = turns.filter((result) => result.chatId === copyId);
    expect(turn).toMatchObject({ ownerId: "vera", staff: { id: "anna" } });
    expect(turn).not.toHaveProperty("subject");
  });

  it("копия обычного чата с данными: инструменты и итог хода видят `data` человека, `subject` нет, служебной обёртки нет", async () => {
    const { setup, toolModels, turns } = withPeople({ afterTurn: true, steps: [{ text: "Хорошо" }, { toolCall: { id: "w1", name: "who_am_i", input: {} } }, { text: "готово" }] });
    const data = { formId: "form-secret-77", mode: "test" };
    const { id } = await setup.battle.service.createChat("vera", { data });
    await sendAsPerson(setup, id, "Привет");
    toolModels.length = 0;
    const copyId = await copyChat(setup, "vera", id);
    await setup.send(copyId, "Кто я?");

    expect(toolModels.length).toBeGreaterThan(0);
    expect(toolModels.every((model) => model.subject === undefined && model.chat?.data?.formId === "form-secret-77" && model.chat.data.mode === "test")).toBe(true);
    const [turn] = turns.filter((result) => result.chatId === copyId);
    expect(turn).toMatchObject({ ownerId: "vera", staff: { id: "anna" }, chatData: data });
    expect(turn).not.toHaveProperty("subject");
    expect(JSON.stringify([toolModels, turn])).not.toContain("staffCopyOf");
    // В браузер админа данные копии не уходят.
    expect(JSON.stringify(await json(setup.call("GET", `/${copyId}`)))).not.toContain("form-secret-77");
  });

  it("копия чата объекта с данными: `subject` — исходный объект, `chat.data` — его данные", async () => {
    const { setup, toolModels, turns } = withPeople({ afterTurn: true, steps: [{ text: "Хорошо" }, { toolCall: { id: "w1", name: "who_am_i", input: {} } }, { text: "готово" }] });
    const { chat } = await setup.battle.service.openSubjectChat({ ownerId: "vera", key: "lesson:43", data: { lessonId: 43 } });
    await sendAsPerson(setup, chat.id, "Привет");
    toolModels.length = 0;
    const copyId = await copyChat(setup, "vera", chat.id);
    await setup.send(copyId, "Ещё");
    expect(toolModels.every((model) => model.subject?.key === "lesson:43" && model.chat?.data?.lessonId === 43)).toBe(true);
    const [turn] = turns.filter((result) => result.chatId === copyId);
    expect(turn).toMatchObject({ subject: { key: "lesson:43", data: { lessonId: 43 } }, chatData: { lessonId: 43 } });
  });

  it("в обычном песочном чате `afterTurn` приложения не зовётся, как и `beforeTurn`", async () => {
    const { setup, turns } = withPeople({ afterTurn: true });
    const chatId = await setup.createChat();
    await setup.send(chatId, "Привет");
    expect(turns.filter((turn) => turn.chatId === chatId)).toEqual([]);
  });

  it("в обычном песочном чате `staff` нет, инструменты получают id админа", async () => {
    const { setup, toolModels } = withPeople({ steps: [{ toolCall: { id: "w1", name: "who_am_i", input: {} } }, { text: "готово" }] });
    const chatId = await setup.createChat();
    await setup.send(chatId, "Кто я?");
    expect(toolModels.length).toBeGreaterThan(0);
    expect(toolModels.every((model) => model.ownerId === "anna" && model.staff === undefined)).toBe(true);
  });

  it("память человека в копии — только на чтение: заметка видна, запись отклонена, память не меняется", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage, optimizer: false });
    await memory.create("vera", { categories: ["О себе"], content: "Вера любит зелёный чай" });
    await memory.create("anna", { categories: ["О себе"], content: "Анна любит кофе" });
    const { setup } = withPeople({
      storage,
      memory,
      steps: [
        { text: "Хорошо" },
        { toolCall: { id: "s1", name: "manage_memory", input: { action: "search", query: "чай" } } },
        { toolCall: { id: "c1", name: "manage_memory", input: { action: "create", notes: [{ categories: ["О себе"], content: "Вера любит кофе" }] } } },
        { text: "готово" },
      ],
    });
    const chatId = await personChat(setup, "Как дела?");
    const notesBefore = (await memory.list("vera")).notes;
    const callsBefore = setup.model.doStreamCalls.length;

    const copyId = await copyChat(setup, "vera", chatId);
    await setup.send(copyId, "Что я люблю?");

    const prompt = JSON.stringify(setup.model.doStreamCalls[callsBefore]!.prompt);
    expect(prompt).toContain("Вера любит зелёный чай");
    expect(prompt).not.toContain("Анна любит кофе");
    const outputs: unknown[] = [];
    for (const entry of await setup.journal.listForChat(copyId)) {
      const details = entry.kind === "tool" ? await setup.journal.getCall(entry.id) : null;
      if (details?.kind === "tool") outputs.push(details.output?.content);
    }
    expect(JSON.stringify(outputs[0])).toContain("Вера любит зелёный чай");
    expect(outputs[1]).toEqual({ error: { kind: "invalid", message: "в песочнице память только для чтения" } });
    expect((await memory.list("vera")).notes).toEqual(notesBefore);
    expect((await memory.list("sandbox:anna")).notes).toEqual([]);
  });
});

describe("копии чатов людей: закрытый чат", () => {
  it("копию закрыли в песочнице — новая копия открыта, в ней можно продолжать; чат человека открыт", async () => {
    const { setup } = withPeople();
    const chatId = await personChat(setup);
    const first = await copyChat(setup, "vera", chatId);
    await setup.storage.setChatClosed!(first, { code: "form_completed", message: "Заявка отправлена." });
    const second = await copyChat(setup, "vera", chatId);
    expect(second).not.toBe(first);
    const history = await json<{ chat: { closed?: unknown } }>(setup.call("GET", `/${second}`));
    expect(history.chat.closed).toBeUndefined();
    await setup.send(second, "Продолжаю");
    expect((await setup.storage.getChat(chatId))!.closed).toBeUndefined();
  });
});
