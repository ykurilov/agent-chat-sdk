import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentChatMessage, ChatCapabilities, ChatCapabilitiesHandler } from "../../src/index";
import { newStoredMessage } from "../../src/conversation/types";
import { defineWidget } from "../../src/widgets/define-widget";
import { finishPart, readAll, reasoningParts, streamStart, textParts } from "./support/mock-model";
import { noticeService, scriptedModel, userMessage } from "./support/notice-chat";

const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()).min(2) }),
  answerSchema: z.object({ slot: z.string() }),
});

/** Шаг: мысль, служебный поиск и карточка для экрана. */
const thinkAndCall: LanguageModelV4StreamPart[] = [
  streamStart,
  ...reasoningParts("секретная мысль"),
  { type: "tool-call", toolCallId: "c-lookup", toolName: "lookup", input: JSON.stringify({ q: "цены" }) },
  { type: "tool-call", toolCallId: "c-card", toolName: "show_card", input: JSON.stringify({ title: "Тариф" }) },
  finishPart("tool-calls"),
];
const thinkAndSay: LanguageModelV4StreamPart[] = [streamStart, ...reasoningParts("ещё мысль", "reasoning-1"), ...textParts(["Готово"]), finishPart()];

function tools(gate?: Promise<void>) {
  return {
    lookup: tool({
      description: "Служебный поиск",
      inputSchema: z.object({ q: z.string() }),
      execute: async () => {
        await gate;
        return "внутренние цены";
      },
    }),
    show_card: tool({
      description: "Карточка на экране",
      inputSchema: z.object({ title: z.string() }),
      metadata: { showOnScreen: true },
      execute: async () => "показана",
    }),
  };
}

function rights(initial: Partial<ChatCapabilities>) {
  const state = { value: initial };
  const calls: string[] = [];
  const chatCapabilities: ChatCapabilitiesHandler = ({ userId }) => {
    calls.push(userId);
    return state.value;
  };
  return { state, calls, chatCapabilities };
}

function setup(given: Partial<ChatCapabilities> | undefined, gate?: Promise<void>, scripts = [thinkAndCall, thinkAndSay], toolsByModel = false) {
  const model = scriptedModel(scripts);
  const access = rights(given ?? {});
  const { service, storage } = noticeService(model, {
    ...(given && { chatCapabilities: access.chatCapabilities }),
    agent: { tools: toolsByModel ? () => tools(gate) : tools(gate), widgets: { custom: [pickSlot] } },
  });
  return { model, service, storage, access };
}

const PUBLIC: Partial<ChatCapabilities> = { reasoning: false, toolDetails: false };

const toolCallIdsOf = (chunks: UIMessageChunk[]) =>
  new Set(chunks.flatMap((chunk) => ("toolCallId" in chunk && typeof chunk.toolCallId === "string" ? [chunk.toolCallId] : [])));
const partTypes = (message: AgentChatMessage | undefined) => (message?.parts ?? []).map((part) => part.type);

function expectHiddenChunks(chunks: UIMessageChunk[]) {
  expect(chunks.some((chunk) => chunk.type.startsWith("reasoning"))).toBe(false);
  expect(toolCallIdsOf(chunks).has("c-lookup")).toBe(false);
  expect(toolCallIdsOf(chunks).has("c-card")).toBe(true);
  expect(JSON.stringify(chunks)).not.toContain("секретная мысль");
  expect(JSON.stringify(chunks)).not.toContain("внутренние цены");
  expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Готово")).toBe(true);
  for (const chunk of chunks) {
    if ((chunk.type === "message-metadata" || chunk.type === "finish" || chunk.type === "start") && chunk.messageMetadata) {
      expect(chunk.messageMetadata).not.toHaveProperty("reasoningDurationsMs");
    }
  }
}

describe("скрытие частей ответа от браузера (права reasoning и toolDetails)", () => {
  it("по умолчанию всё видно: мысли и все инструменты в потоке и в истории", async () => {
    const { service } = setup(undefined);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?")));
    expect(chunks.some((chunk) => chunk.type === "reasoning-delta")).toBe(true);
    expect(toolCallIdsOf(chunks).has("c-lookup")).toBe(true);
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1);
    expect(partTypes(answer)).toEqual(expect.arrayContaining(["reasoning", "tool-lookup", "tool-show_card"]));
    expect(answer?.metadata?.reasoningDurationsMs).toBeDefined();
  });

  it("запрет: поток без мыслей и служебного инструмента, видимый инструмент и текст остаются", async () => {
    const { service } = setup(PUBLIC);
    const chat = await service.createChat("anna");
    expectHiddenChunks(await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?"))));
  });

  it("запрет: история без мыслей и служебного инструмента; хранилище и модель получают всё", async () => {
    const { service, storage, model } = setup(PUBLIC);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?")));
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1);
    expect(partTypes(answer)).not.toContain("reasoning");
    expect(partTypes(answer)).not.toContain("tool-lookup");
    expect(partTypes(answer)).toContain("tool-show_card");
    expect(answer?.metadata).not.toHaveProperty("reasoningDurationsMs");
    expect((await service.peekHistory("anna", chat.id)).messages.at(-1)?.parts.map((part) => part.type)).not.toContain("tool-lookup");

    const stored = (await storage.listMessages(chat.id)).at(-1)!;
    expect(stored.parts.map((part) => part.type)).toEqual(expect.arrayContaining(["reasoning", "tool-lookup", "tool-show_card"]));
    // Второй шаг видит результат служебного инструмента.
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("внутренние цены");
  });

  it("переподключение посреди хода: повтор прошлых кусков и новые — тоже без скрытого", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup(PUBLIC, gate);
    const chat = await service.createChat("anna");
    const first = await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?"));
    const reading = readAll(first);
    // Ждём, пока ход дойдёт до служебного инструмента: его вход уже в буфере.
    await expect.poll(async () => (await service.peekHistory("anna", chat.id)).running).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const resumed = await service.subscribe("anna", chat.id);
    release();
    expectHiddenChunks(await readAll(resumed!));
    expectHiddenChunks(await reading);
  });

  it("права считаются на зрителя в момент открытия потока", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service, access } = setup({}, gate);
    const chat = await service.createChat("anna");
    const first = await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?"));
    const reading = readAll(first);
    await new Promise((resolve) => setTimeout(resolve, 20));
    access.state.value = PUBLIC;
    access.calls.length = 0;
    const resumed = await service.subscribe("anna", chat.id);
    expect(access.calls).toEqual(["anna"]);
    release();
    expectHiddenChunks(await readAll(resumed!));
    // Первый поток открыт, когда всё было видно.
    expect((await reading).some((chunk) => chunk.type === "reasoning-delta")).toBe(true);
  });

  it("виджет остаётся на экране при запрете служебных инструментов", async () => {
    const widgetCall: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "w1", toolName: "pick_slot", input: JSON.stringify({ slots: ["10:00", "11:00"] }) },
      finishPart("tool-calls"),
    ];
    const { service } = setup(PUBLIC, undefined, [widgetCall]);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Запиши меня")));
    expect(toolCallIdsOf(chunks).has("w1")).toBe(true);
    expect(partTypes((await service.getHistory("anna", chat.id)).messages.at(-1))).toContain("tool-pick_slot");
  });

  it("набор инструментов функцией от модели: пометка в описании работает так же", async () => {
    const { service } = setup(PUBLIC, undefined, [thinkAndCall, thinkAndSay], true);
    const chat = await service.createChat("anna");
    expectHiddenChunks(await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?"))));
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1);
    expect(partTypes(answer)).toContain("tool-show_card");
    expect(partTypes(answer)).not.toContain("tool-lookup");
  });

  it("метка лежит в самом вызове: вызов без неё (записан до пометки) при запрете скрыт", async () => {
    const { service, storage } = setup(PUBLIC);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сколько стоит?")));
    const stored = (await storage.listMessages(chat.id)).at(-1)!;
    expect(stored.parts.find((part) => part.type === "tool-show_card")).toMatchObject({ toolMetadata: { showOnScreen: true } });
    // Тот же ответ, но вызов карточки без метки — как записанный до появления пометки.
    const unmarked = stored.parts.map((part) => (part.type === "tool-show_card" ? { ...part, toolMetadata: undefined } : part));
    const old = await service.createChat("anna");
    await storage.insertMessage(newStoredMessage({ id: "old-q", chatId: old.id, role: "user", parts: [{ type: "text", text: "Сколько стоит?" }] }));
    await storage.insertMessage({ ...stored, id: "old-a", chatId: old.id, parentId: "old-q", parts: unmarked as typeof stored.parts });
    const answer = (await service.getHistory("anna", old.id)).messages.at(-1);
    expect(answer?.id).toBe("old-a");
    expect(partTypes(answer)).not.toContain("tool-show_card");
  });
});

describe("скрытие служебных инструментов: запрос подтверждения", () => {
  const removeCalls: LanguageModelV4StreamPart[] = [
    streamStart,
    { type: "tool-call", toolCallId: "c-ask", toolName: "remove", input: JSON.stringify({ path: "a" }) },
    { type: "tool-call", toolCallId: "c-tmp", toolName: "remove", input: JSON.stringify({ path: "tmp" }) },
    finishPart("tool-calls"),
  ];

  function approvalSetup(scripts: LanguageModelV4StreamPart[][] = [removeCalls, [streamStart, ...textParts(["Удалил"]), finishPart()]]) {
    const model = scriptedModel(scripts);
    const access = rights(PUBLIC);
    const { service } = noticeService(model, {
      chatCapabilities: access.chatCapabilities,
      agent: {
        tools: {
          remove: tool({
            description: "Удалить",
            inputSchema: z.object({ path: z.string() }),
            // Временные файлы удаляются без вопроса.
            needsApproval: ({ path }) => path !== "tmp",
            execute: async ({ path }) => `удалено ${path}`,
          }),
        },
      },
    });
    return { service };
  }

  it("вызов с запросом подтверждения виден без пометки: вход, запрос, ответ; вызов без запроса скрыт", async () => {
    const { service } = approvalSetup();
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Удали")));
    expect(toolCallIdsOf(chunks).has("c-ask")).toBe(true);
    expect(toolCallIdsOf(chunks).has("c-tmp")).toBe(false);
    expect(chunks.some((chunk) => chunk.type === "tool-input-available" && chunk.toolCallId === "c-ask")).toBe(true);
    const request = chunks.find((chunk) => chunk.type === "tool-approval-request");
    expect(request).toMatchObject({ toolCallId: "c-ask" });

    const waiting = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    const askPart = waiting.parts.find((part) => "toolCallId" in part && part.toolCallId === "c-ask");
    expect(askPart).toMatchObject({ type: "tool-remove", state: "approval-requested" });
    expect(JSON.stringify(waiting.parts)).not.toContain("c-tmp");

    await service.answerApproval("anna", chat.id, (request as { approvalId: string }).approvalId, "allow");
    const resumed = await readAll((await service.subscribe("anna", chat.id))!);
    expect(resumed.some((chunk) => chunk.type === "tool-output-available" && chunk.toolCallId === "c-ask")).toBe(true);
    expect(toolCallIdsOf(resumed).has("c-tmp")).toBe(false);
    const done = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(done.parts.find((part) => "toolCallId" in part && part.toolCallId === "c-ask")).toMatchObject({ state: "output-available" });
    expect(JSON.stringify(done.parts)).not.toContain("c-tmp");
  });

  it("продолжение после подтверждения: новый вызов без запроса скрыт в потоке и в истории", async () => {
    const { service } = approvalSetup([
      [streamStart, { type: "tool-call", toolCallId: "c-ask", toolName: "remove", input: JSON.stringify({ path: "a" }) }, finishPart("tool-calls")],
      [streamStart, { type: "tool-call", toolCallId: "c-later", toolName: "remove", input: JSON.stringify({ path: "tmp" }) }, finishPart("tool-calls")],
      [streamStart, ...textParts(["Удалил"]), finishPart()],
    ]);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Удали")));
    const request = chunks.find((chunk) => chunk.type === "tool-approval-request") as { approvalId: string };
    await service.answerApproval("anna", chat.id, request.approvalId, "allow");
    const resumed = await readAll((await service.subscribe("anna", chat.id))!);
    expect(toolCallIdsOf(resumed).has("c-ask")).toBe(true);
    expect(toolCallIdsOf(resumed).has("c-later")).toBe(false);
    expect(JSON.stringify(resumed)).not.toContain("удалено tmp");
    expect(resumed.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Удалил")).toBe(true);
    const done = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(JSON.stringify(done.parts)).not.toContain("c-later");
    expect(done.parts.find((part) => "toolCallId" in part && part.toolCallId === "c-ask")).toMatchObject({ state: "output-available" });
  });
});
