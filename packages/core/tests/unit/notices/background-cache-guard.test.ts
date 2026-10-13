import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatEvents } from "../../../src/chat-events/chat-events";
import { createChatService } from "../../../src/chat-service";
import type { AgentSettings } from "../../../src/chat-service";
import type { LongTermMemory } from "../../../src/memory/long-term-memory";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { doneNotice, userMessage, waitTurn } from "../support/notice-chat";

const appTools = {
  remove: tool({ description: "Удалить файл", inputSchema: z.object({ path: z.string() }), execute: async () => "удалено" }),
  find: tool({ description: "Найти файл", inputSchema: z.object({ name: z.string() }), execute: async () => "нашёл" }),
};

const memory: LongTermMemory = {
  instructions: "Память: записи — данные.",
  tools: () => ({ manage_memory: tool({ description: "Память", inputSchema: z.object({ action: z.string() }), execute: async () => "ок" }) }),
  toolNames: ["manage_memory"],
  snapshot: async () => "Записи памяти: любит чай.",
  afterAnswer: async () => {},
};

function scriptedModel() {
  const scripts: LanguageModelV4StreamPart[][] = [
    [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "find", input: JSON.stringify({ name: "a.txt" }) }, finishPart("tool-calls")],
  ];
  let call = 0;
  return mockModel(() => streamOf(scripts[call++] ?? [streamStart, ...textParts(["Готово"]), finishPart()]));
}

function build(agent: AgentSettings, withMemory: boolean) {
  const model = scriptedModel();
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent,
    ...(withMemory && { memory }),
    chatEvents: createChatEvents(),
    env: mockEnv,
    logError: () => {},
  });
  return { model, service };
}

const requests = (model: ReturnType<typeof scriptedModel>) =>
  model.doStreamCalls.map(({ abortSignal: _abortSignal, ...call }) => call);

/** Два хода подряд с явным каналом «web» и событиями чата. */
async function requestsOf(agent: AgentSettings, withMemory = false): Promise<string> {
  const { model, service } = build(agent, withMemory);
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "найди a.txt"), { channel: "web" }));
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё"), { channel: "web" }));
  await service.flush();
  return JSON.stringify(requests(model), null, 1);
}

describe("T040: страж кэша — без фона и мессенджеров запрос как в 0.18", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 9, 0)));
  });
  afterEach(() => vi.useRealTimers());

  it("инструменты набором и память", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник.", tools: appTools }, true)).toMatchFileSnapshot("../helpers/__snapshots__/request-0.18-static-tools-memory.json");
  });

  it("инструменты функцией", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник.", tools: () => appTools })).toMatchFileSnapshot("../helpers/__snapshots__/request-0.18-tools-function.json");
  });

  it("без инструментов", async () => {
    await expect(await requestsOf({ instructions: "Ты помощник." })).toMatchFileSnapshot("../helpers/__snapshots__/request-0.18-no-tools.json");
  });

  it("служебное сообщение не меняет байты истории до него; на следующем ходу оно тем же текстом", async () => {
    const run = async (last: "notice" | "human") => {
      const { model, service } = build({ instructions: "Ты помощник.", tools: appTools }, true);
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "найди a.txt")));
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
      if (last === "notice") {
        await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "12 сделок")], wakeAgent: true, deliveryKey: "k" });
        await waitTurn(service, chat.id);
        await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "спасибо")));
      } else {
        await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "x")));
      }
      return requests(model);
    };
    const withNotice = await run("notice");
    const withHuman = await run("human");
    const noticeCall = withNotice[3]!;
    const humanCall = withHuman[3]!;
    // До последнего сообщения человека запрос побайтно тот же.
    const head = (call: typeof noticeCall) => JSON.stringify({ ...call, prompt: call.prompt.slice(0, -1) });
    expect(head(noticeCall)).toBe(head(humanCall));
    // Следующий ход: сообщение со служебным сообщением в истории — те же байты, что были хвостом (без пометки кэша и дня).
    const noticeTail = noticeCall.prompt.at(-1)!;
    const later = withNotice[4]!.prompt[noticeCall.prompt.length - 1]!;
    expect(JSON.stringify((later.content as Array<{ text?: string }>)[0])).toBe(JSON.stringify((noticeTail.content as Array<{ text?: string }>)[0]));
  });
});
