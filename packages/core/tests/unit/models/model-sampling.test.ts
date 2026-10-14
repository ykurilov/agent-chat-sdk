import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../../src/chat-service";
import type { ChatServiceOptions } from "../../../src/chat-service";
import type { LongTermMemory } from "../../../src/memory/long-term-memory";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { createModelCatalog, findModel, resolveLanguageModel } from "../../../src/models/model-catalog";
import type { ModelCatalog, ModelProfile } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";

const env = { DEEPSEEK_API_KEY: "k", TOGETHER_API_KEY: "k", OPENROUTER_API_KEY: "k", FIREWORKS_API_KEY: "k" };
const DEEPSEEK = "deepseek-4.1-flash";

/** Ответ в духе OpenAI: потоком, если запрос просит поток, иначе целым. */
function answer(stream: boolean): Response {
  if (!stream) {
    const body = {
      id: "c-1", object: "chat.completion", created: 1, model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "Ок" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  const chunk = { id: "c-1", object: "chat.completion.chunk", created: 1, model: "m" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Ок" } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Тела запросов к модели, разобранные. */
function recordBodies(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return answer(body.stream === true);
  }));
  return bodies;
}

function service(providerId: string, extra: Partial<ChatServiceOptions> = {}, catalog: ModelCatalog = standardCatalog) {
  return createChatService({
    storage: createInMemoryChatStorage(),
    catalog,
    defaultChoice: { modelId: DEEPSEEK, providerId },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env,
    ...extra,
  });
}

async function oneTurnBody(providerId: string, catalog?: ModelCatalog): Promise<Record<string, unknown>> {
  const bodies = recordBodies();
  const chat = service(providerId, {}, catalog);
  const created = await chat.createChat("owner");
  const stream = await chat.sendMessage("owner", created.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] });
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
  return bodies[0]!;
}

function deepseekProfile(): ModelProfile {
  return standardCatalog.models.find((model) => model.id === DEEPSEEK)!;
}

afterEach(() => vi.unstubAllGlobals());

describe("параметры выборки из профиля модели (min_p у DeepSeek 4.1 Flash)", () => {
  it("в профиле DeepSeek 4.1 Flash обрезка хвоста 0,05", () => {
    expect(deepseekProfile().sampling).toEqual({ minP: 0.05 });
  });

  it.each(["together", "openrouter"])("ход через %s несёт min_p 0,05", async (providerId) => {
    expect((await oneTurnBody(providerId)).min_p).toBe(0.05);
  });

  it.each(["deepseek", "fireworks"])("провайдеру без поддержки (%s) min_p не уходит", async (providerId) => {
    const body = await oneTurnBody(providerId);
    expect(body).not.toHaveProperty("min_p");
    expect(JSON.stringify(body)).not.toContain("min_p");
  });

  it("у OpenRouter запрет хозяев из профиля остаётся рядом с min_p", async () => {
    const body = await oneTurnBody("openrouter");
    expect(body.provider).toMatchObject({ ignore: expect.arrayContaining(["deepinfra"]) });
  });

  it("модель без параметров выборки шлёт запрос без min_p", async () => {
    const bodies = recordBodies();
    const model = resolveLanguageModel(findModel(standardCatalog, "gpt-6-luna", "openrouter"), env);
    await generateText({ model, prompt: "Привет" });
    expect(bodies[0]).not.toHaveProperty("min_p");
  });

  it("модель из каталога несёт min_p и без сборки запроса ядра (служебные вызовы с готовой моделью)", async () => {
    const bodies = recordBodies();
    const model = resolveLanguageModel(findModel(standardCatalog, DEEPSEEK, "together"), env);
    await generateText({ model, prompt: "Привет" });
    expect(bodies[0]!.min_p).toBe(0.05);
  });

  it("склейка памяти после ответа (модель Together) несёт min_p", async () => {
    const bodies = recordBodies();
    const afterAnswer = vi.fn<NonNullable<LongTermMemory["afterAnswer"]>>(async ({ model }) => {
      await generateText({ model, prompt: "Найди дубли" });
    });
    const memory: LongTermMemory = { instructions: "Память.", tools: () => ({}), toolNames: [], snapshot: async () => null, afterAnswer };
    const chat = service("together", { memory });
    const created = await chat.createChat("owner");
    const stream = await chat.sendMessage("owner", created.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] });
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
      // ход дочитывается до конца
    }
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.messages).toEqual([{ role: "user", content: "Найди дубли" }]);
    expect(bodies[1]!.min_p).toBe(0.05);
  });

  it("ход на пачку сообщений (sendBurstMessage) несёт min_p", async () => {
    const bodies = recordBodies();
    const chat = service("together");
    const created = await chat.createChat("owner");
    const sent = await chat.sendBurstMessage("owner", created.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, { quietMs: 0 });
    const stream = await sent.turn;
    const reader = stream!.getReader();
    while (!(await reader.read()).done) {
      // ход дочитывается до конца
    }
    expect(bodies[0]!.min_p).toBe(0.05);
  });

  it("служебный запрос askModel (судья, проверки) несёт min_p", async () => {
    const bodies = recordBodies();
    const chat = service("together");
    const created = await chat.createChat("owner");
    await chat.askModel({ ownerId: "owner", chatId: created.id, model: { modelId: DEEPSEEK, providerId: "together" }, prompt: "Оцени", source: "judge" });
    expect(bodies[0]!.min_p).toBe(0.05);
  });

  it("приложение выключает обрезку своим профилем без sampling", async () => {
    const { sampling: _off, ...withoutSampling } = deepseekProfile();
    const catalog = extendCatalog(standardCatalog, { addModels: [withoutSampling] });
    expect(await oneTurnBody("together", catalog)).not.toHaveProperty("min_p");
  });

  it("приложение задаёт своё значение для всех провайдеров", async () => {
    const catalog = extendCatalog(standardCatalog, { addModels: [{ ...deepseekProfile(), sampling: { minP: 0.1 } }] });
    expect((await oneTurnBody("openrouter", catalog)).min_p).toBe(0.1);
  });

  it("опция провайдера в профиле главнее общего значения: можно переопределить одного провайдера", async () => {
    const profile = deepseekProfile();
    const catalog = extendCatalog(standardCatalog, {
      addModels: [{ ...profile, providerOptions: { ...profile.providerOptions, togetherai: { min_p: 0 } } }],
    });
    expect((await oneTurnBody("together", catalog)).min_p).toBe(0);
    expect((await oneTurnBody("openrouter", catalog)).min_p).toBe(0.05);
  });

  it.each([0, 1, -0.1, Number.NaN])("каталог отказывает на min_p вне (0; 1): %s", (minP) => {
    expect(() => createModelCatalog({ ...standardCatalog, models: [{ ...deepseekProfile(), sampling: { minP } }] })).toThrow(/minP/);
  });
});
