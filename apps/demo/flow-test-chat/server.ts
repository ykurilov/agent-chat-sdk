import { serve } from "@hono/node-server";
import { MockLanguageModelV4 } from "ai/test";
import { extendCatalog, standardCatalog, createInMemoryChatStorage, type ChatCapabilitiesHandler } from "@ykurilov/agent-chat-core";
import { createAgentFlow, FlowTestClockError, flowTestChatData, memoryFlowStore, testChatOffset } from "@ykurilov/agent-chat-flows";
import { createChatServer } from "@ykurilov/agent-chat-server";
import { mountChat } from "@ykurilov/agent-chat-server/hono";
import { Hono } from "hono";

/*
 * Сервер стенда тестового чата (этап 10 плана 058): чат со сценарием на модели-заглушке, в памяти. Платных запросов
 * нет: модель отвечает «Понял: <вопрос>», судья ходит на закрытый порт и молча падает («не проверено»).
 * POST /api/flow-test/start { flow } — новый тестовый чат по сценарию из редактора; POST /api/flow-test/advance
 * { chatId, ms } или { chatId, to: "next_day_start" | "next_first_message" } — перемотка его часов (на мс, до начала
 * следующего дня сценария или к следующему сообщению сценария; впереди ничего — 409 { code: "nothing_scheduled" }); POST /api/flow-test/run { chatId } — место чата для доски (посетителю оно не
 * уходит). Эндпоинты закрыты: только тестовые чаты автора — в приложении это права редактора.
 */

const port = Number(process.env.FLOW_TEST_API_PORT ?? 8951);
const USER = "author";

const lastQuestion = (prompt: Array<{ role: string; content: unknown }>) => {
  const message = prompt.findLast((item) => item.role === "user");
  const parts = Array.isArray(message?.content) ? (message.content as Array<{ type: string; text?: string }>) : [];
  // Первая часть — слова человека; дальше служебные вставки чата (дата, состояние сценария).
  return (parts.find((part) => part.type === "text")?.text ?? "").trim();
};

const model = new MockLanguageModelV4({
  doStream: async ({ prompt }) => {
    const text = `Понял: ${lastQuestion(prompt as never).slice(0, 80)}`;
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: text });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } });
          controller.close();
        },
      }),
    };
  },
});

const catalog = extendCatalog(standardCatalog, {
  addProviders: [{ id: "stand", displayName: "Стенд", apiKeyEnv: "FLOW_TEST_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
  addModels: [{ id: "stand-model", displayName: "Заглушка", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { stand: "stand-v1" } }],
});
const choice = { modelId: "stand-model", providerId: "stand" };

/** Сценарий тестового чата — тот, что был в редакторе при запуске. */
const flows = new Map<string, unknown>();

const flow = createAgentFlow({
  loadFlow: async ({ chat }) => (flows.has(chat.id) ? { flowId: "test", versionId: chat.id, flow: flows.get(chat.id) } : null),
  store: memoryFlowStore(),
  judge: { fallback: choice, openrouter: { apiKey: "stand", baseUrl: "http://127.0.0.1:9/api/v1" }, timeoutMs: 500 },
  // Тихие часы выключены: тест не зависит от времени суток на машине.
  firstMessages: { quietHours: { from: "00:00", to: "00:00" }, maxPerDay: 100 },
  timers: { tickMs: 1_000 },
});

const storage = createInMemoryChatStorage();
const { handler, service } = createChatServer(
  flow.withChat({
    basePath: "/api/chat",
    storage,
    resolveUser: async () => ({ id: USER }),
    catalog,
    defaultChoice: choice,
    env: { FLOW_TEST_KEY: "stand" },
    agent: { instructions: "Ты помощник стенда.", timeZone: "Europe/Moscow" },
    // Пометки «агент написал первым» видны только автору в тестовом чате; клиент в боевом чате их не видит.
    chatCapabilities: (({ chat }) => ({ appNotices: testChatOffset(chat.data) !== null })) satisfies ChatCapabilitiesHandler,
  }),
);
flow.attach(service);
flow.start();

const app = new Hono();
app.get("/api/flow-test/health", (c) => c.text("ok"));
app.post("/api/flow-test/start", async (c) => {
  const { flow: json } = await c.req.json<{ flow: unknown }>();
  const chat = await service.createChat(USER, { data: flowTestChatData() });
  flows.set(chat.id, json);
  return c.json({ chatId: chat.id });
});
/** Чат автора с отметкой тестового (`flowTestChatData`); чужой или обычный — эндпоинт отвечает 404. */
const ownTestChat = async (chatId: string) => {
  const data = await service.getChatData(USER, chatId).catch(() => null);
  return data !== null && testChatOffset(data) !== null;
};
app.post("/api/flow-test/advance", async (c) => {
  const { chatId, ms, to } = await c.req.json<{ chatId: string; ms?: number; to?: "next_day_start" | "next_first_message" }>();
  if (!(await ownTestChat(chatId))) return c.json({ error: "not_found" }, 404);
  const clock = to === "next_day_start" || to === "next_first_message" ? { to } : { ms: Number(ms) };
  try {
    return c.json(await flow.advanceTestClock({ ownerId: USER, chatId, ...clock }));
  } catch (error) {
    if (error instanceof FlowTestClockError) return c.json({ error: error.message, code: error.code }, 409);
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
app.post("/api/flow-test/run", async (c) => {
  const { chatId } = await c.req.json<{ chatId: string }>();
  if (!(await ownTestChat(chatId))) return c.json({ error: "not_found" }, 404);
  return c.json(await flow.readRun(USER, chatId));
});
mountChat(app, handler);

serve({ fetch: app.fetch, port }, () => console.log(`Стенд тестового чата: http://localhost:${port}`));
