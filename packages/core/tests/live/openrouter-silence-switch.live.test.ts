// Живая проверка маршрутов OpenRouter и перехода посреди ответа: основной маршрут — только хозяин DeepSeek, запасной —
// только Fireworks. Ответ основного обрывается молчанием после первых кусков текста (поток держится открытым, кусков нет);
// шаг стирается (`data-step-reset`) и начинается заново у запасного маршрута.
// Тест платный (два коротких запроса). Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
// Запуск: `pnpm test:live openrouter-silence-switch`.
import { afterEach, describe, expect, it } from "vitest";
import { STEP_RESET_PART_TYPE } from "../../src/agent-run/step-reset";
import { createChatService } from "../../src/chat-service";
import { extendCatalog } from "../../src/models/catalog-changes";
import { createOpenRouterProvider } from "../../src/models/providers/openrouter";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Пишет поле `provider` тела запросов; первый ответ модели замолкает после первого куска с текстом. Ключ не пишется. */
function silenceFirstAnswer(): unknown[] {
  const routings: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const isChat = typeof init?.body === "string" && init.body.includes('"messages"');
    if (isChat) routings.push((JSON.parse(init.body as string) as { provider?: unknown }).provider);
    const response = await originalFetch(input, init);
    if (!isChat || routings.length !== 1 || !response.body) return response;
    const upstream = response.body.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (/"content":"[^"]/.test(seen)) {
          // Текст пошёл — дальше молчание до отмены запроса.
          await upstream.cancel().catch(() => undefined);
          await new Promise<void>((resolve) => init?.signal?.addEventListener("abort", () => resolve(), { once: true }));
          controller.error(init?.signal?.reason);
          return;
        }
        const { done, value } = await upstream.read();
        if (done) return controller.close();
        seen += decoder.decode(value, { stream: true });
        controller.enqueue(value);
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  };
  return routings;
}

describe("OpenRouter: маршруты и переход посреди ответа", () => {
  it("основной маршрут замолк посреди текста — шаг стёрт и начат заново у запасного маршрута", async () => {
    const routings = silenceFirstAnswer();
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: extendCatalog(standardCatalog, {
        addProviders: [
          createOpenRouterProvider({ id: "or-deepseek", displayName: "OpenRouter → DeepSeek", only: ["deepseek"], allowFallbacks: false }),
          createOpenRouterProvider({ id: "or-fireworks", displayName: "OpenRouter → Fireworks", only: ["fireworks"], allowFallbacks: false }),
        ],
      }),
      defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "or-deepseek" },
      agent: {
        instructions: "Отвечай по-русски.",
        modelSilenceTimeout: { firstChunkMs: 60_000, betweenChunksMs: 4_000 },
        providerFallback: { byModel: { "deepseek-4.1-flash": ["or-fireworks"] }, onSilence: "restart-step-on-next" },
      },
      compaction: false,
      env: process.env,
    });
    const chat = await service.createChat("live");
    const stream = await service.sendMessage("live", chat.id, { id: "q1", role: "user", parts: [{ type: "text", text: "Перечисли через запятую дни недели." }] });
    const types: string[] = [];
    const reader = stream.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) types.push((read.value as { type: string }).type);
    const answer = (await service.getHistory("live", chat.id)).messages.findLast((message) => message.role === "assistant")!;
    const text = answer.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

    console.log(`Маршруты: ${JSON.stringify(routings)}`);
    console.log(`Сброс шага в потоке: ${types.includes(STEP_RESET_PART_TYPE)}; статус ${answer.metadata?.status}; части ${answer.parts.map((part) => part.type).join(",")}`);
    console.log(`Ответ: ${text}`);
    expect(routings).toHaveLength(2);
    expect(routings[0]).toMatchObject({ only: ["deepseek"], allow_fallbacks: false });
    expect(routings[1]).toMatchObject({ only: ["fireworks"], allow_fallbacks: false });
    expect(types).toContain(STEP_RESET_PART_TYPE);
    expect(answer.metadata?.status).toBe("complete");
    expect(answer.parts.filter((part) => part.type === "step-start")).toHaveLength(1);
    expect(text).toMatch(/понедельник/i);
  }, 120_000);
});
