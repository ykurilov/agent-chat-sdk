import { APICallError } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { resolveChatCapabilities } from "../../src/index";
import type { AgentChatMessage, ChatCapabilities } from "../../src/index";
import { controlledModel, mockEnv, mockModelId, readAll } from "./support/mock-model";
import { noticeService, userMessage } from "./support/notice-chat";

/** OpenRouter: у ключа кончился месячный бюджет; в теле ключ из окружения и адрес с токеном. */
const keyLimit = () =>
  new APICallError({
    message: "ответ 403",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 403,
    responseBody: `{"error":{"message":"Key limit exceeded (monthly limit). $10.00 of $10.00 used; resets 2026-11-01. Key ${mockEnv.MOCK_API_KEY}, see https://openrouter.ai/settings/keys?token=t0p-s3cret","code":403,"metadata":{"limit_source":"openrouter_key_limit"}}}`,
  });

/** Часы службы до 01.11.2026: дата обнуления принимается только в будущем. */
const now = () => new Date("2026-10-18T12:00:00Z");

const failing = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw keyLimit();
    },
  });

function setup(given?: Partial<ChatCapabilities>) {
  return noticeService(failing(), { now, agent: { providerFallback: false }, ...(given && { chatCapabilities: () => given }) });
}

const errorsOfChunks = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => {
    const error = (chunk as { messageMetadata?: { error?: unknown } }).messageMetadata?.error;
    return error === undefined ? [] : [error];
  });

const lastError = (messages: AgentChatMessage[]) => messages.at(-1)?.metadata?.error;

describe("право errorDetails: подробности сбоя провайдера уходят в браузер только тому, кому приложение разрешило", () => {
  it("по умолчанию выключено: в потоке и истории только вид сбоя; хранилище держит подробности", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    expect(errorsOfChunks(chunks)).toEqual([{ kind: "insufficient_funds" }]);
    for (const history of [await service.getHistory("anna", chat.id), await service.peekHistory("anna", chat.id)]) {
      expect(lastError(history.messages)).toEqual({ kind: "insufficient_funds" });
      expect(history.capabilities.errorDetails).toBe(false);
    }
    const stored = (await storage.listMessages(chat.id)).at(-1)!;
    expect(stored.error).toMatchObject({ kind: "insufficient_funds", details: { providerId: "mock", statusCode: 403, resetsAt: "2026-11-01T00:00:00.000Z" } });
  });

  it("обычный человек (права без errorDetails) — подробностей нет нигде", async () => {
    const { service } = setup({ edit: false });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    expect(JSON.stringify(chunks)).not.toContain("details");
    expect(JSON.stringify(chunks)).not.toContain("Key limit exceeded");
    const history = await service.getHistory("anna", chat.id);
    expect(JSON.stringify(history.messages)).not.toContain("Key limit exceeded");
  });

  it("админ (errorDetails: true) — подробности в потоке и истории: провайдер, модель, причина, дата обнуления; без секретов", async () => {
    const { service } = setup({ errorDetails: true });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    const history = await service.getHistory("anna", chat.id);
    const expected = {
      kind: "insufficient_funds",
      details: {
        providerId: "mock",
        modelId: mockModelId,
        statusCode: 403,
        reason: expect.stringContaining("Key limit exceeded (monthly limit)"),
        resetsAt: "2026-11-01T00:00:00.000Z",
      },
    };
    expect(errorsOfChunks(chunks)).toEqual([expected]);
    expect(lastError(history.messages)).toEqual(expected);
    for (const shown of [JSON.stringify(chunks), JSON.stringify(history.messages)]) {
      expect(shown).not.toContain(mockEnv.MOCK_API_KEY);
      expect(shown).not.toContain("t0p-s3cret");
    }
  });

  it("переподключение посреди хода: повтор кусков — по тем же правам", async () => {
    const live = controlledModel();
    const { service } = noticeService(live.model, { now, agent: { providerFallback: false }, chatCapabilities: () => ({}) });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    await live.opened;
    const resumed = await service.subscribe("anna", chat.id);
    live.push({ type: "error", error: { code: 403, message: "Key limit exceeded (monthly limit).", metadata: { limit_source: "openrouter_key_limit" } } });
    live.end();
    for (const chunks of [await readAll(resumed!), await reading]) expect(errorsOfChunks(chunks)).toEqual([{ kind: "insufficient_funds" }]);
  });

  it("errorDetails: true при modelDetails: false — выключено: подробности называют модель и провайдера", () => {
    expect(resolveChatCapabilities({ errorDetails: true, modelDetails: false }).errorDetails).toBe(false);
    expect(resolveChatCapabilities({}).errorDetails).toBe(false);
    expect(resolveChatCapabilities({ errorDetails: true }).errorDetails).toBe(true);
  });

  it("errorDetails: true при modelDetails: false от приложения — одно предупреждение в журнал на службу", async () => {
    const logged: string[] = [];
    const { service } = noticeService(failing(), {
      now,
      agent: { providerFallback: false },
      chatCapabilities: () => ({ errorDetails: true, modelDetails: false }),
      logError: (line) => logged.push(line),
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    await service.getHistory("anna", chat.id);
    await service.getHistory("anna", chat.id);
    expect(logged.filter((line) => line.includes("errorDetails: true при modelDetails: false"))).toHaveLength(1);
  });
});
