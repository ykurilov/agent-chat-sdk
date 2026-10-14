import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatService } from "../../../src/chat-service";
import { createChatService } from "../../../src/chat-service";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { readAll } from "../support/mock-model";
import { doneNotice, noticeService, scriptedModel, userMessage, waitTurn } from "../support/notice-chat";

/**
 * Ход человека, ход по служебному сообщению, закрытие и открытие чата из кода, снова ход человека. Запросы к модели —
 * без сигнала отмены, остальное как есть.
 */
async function playScenario(service: ChatService): Promise<void> {
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
  await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово")], wakeAgent: true, deliveryKey: "k1" });
  await waitTurn(service, chat.id);
  await service.closeChat({ ownerId: "anna", chatId: chat.id, code: "paused", message: "Пауза" });
  await service.reopenChat({ ownerId: "anna", chatId: chat.id });
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
  await service.flush();
}

async function requestsOf(): Promise<string> {
  const model = scriptedModel();
  await playScenario(noticeService(model, { agent: { timeZone: "Asia/Novosibirsk" } }).service);
  return JSON.stringify(
    model.doStreamCalls.map(({ abortSignal: _abortSignal, ...call }) => call),
    null,
    1,
  );
}

/** Тот же сценарий на Claude через OpenRouter: тела запросов с метками кэша (сеть подменена). */
async function claudeBodiesOf(): Promise<string> {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      bodies.push(JSON.parse(String(init?.body)));
      return openRouterText(`ответ ${bodies.length}`);
    }),
  );
  await playScenario(
    createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId: "claude-haiku-5.5", providerId: "openrouter" },
      agent: { instructions: "Ты помощник.", timeZone: "Asia/Novosibirsk" },
      env: { OPENROUTER_API_KEY: "test-key" },
      logError: () => {},
    }),
  );
  return JSON.stringify(bodies, null, 1);
}

function openRouterText(content: string): Response {
  const chunk = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("061: без новых настроек запрос к модели как в 0.48", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 14, 3, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Снимок записан кодом 0.48 до точек ядра 0.49: любое расхождение — сломанный кэш у приложений без сценариев.
  it("ход человека, ход по служебному сообщению, закрытие и открытие, снова ход", async () => {
    await expect(await requestsOf()).toMatchFileSnapshot("__snapshots__/request-0.48-notice-closure.json");
  });

  it("тот же сценарий на Claude: тела запросов с метками кэша", async () => {
    await expect(await claudeBodiesOf()).toMatchFileSnapshot("__snapshots__/request-0.48-claude-cache-marks.json");
  });
});
