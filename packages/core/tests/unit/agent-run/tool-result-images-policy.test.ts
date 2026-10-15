import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { APICallError, streamText } from "ai";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { modelMaySeeToolResultImages, toolImageFallbackText } from "../../../src/agent-run/tool-result-images-policy";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelCatalog, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { streamOf, textParts, streamStart, finishPart } from "../support/mock-model";

const PIXEL = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function provider(id: string, model: MockLanguageModelV4, toolResultImages?: boolean): ProviderDescription {
  return {
    id,
    displayName: id,
    apiKeyEnv: "MOCK_API_KEY",
    createLanguageModel: () => model,
    requestOptions: () => ({}),
    ...(toolResultImages !== undefined && { toolResultImages }),
  };
}

/** Каталог: «vision» передаёт картинки инструментов, «plain» — нет, «blind» передаёт, но модель там не видит (помечено). */
function catalogWith(models: { vision?: MockLanguageModelV4; plain?: MockLanguageModelV4; blind?: MockLanguageModelV4 }, acceptsImages = true): ModelCatalog {
  const unused = new MockLanguageModelV4();
  return extendCatalog(standardCatalog, {
    addProviders: [provider("vision", models.vision ?? unused, true), provider("plain", models.plain ?? unused), provider("blind", models.blind ?? unused, true)],
    addModels: [
      {
        id: "eye",
        displayName: "Eye",
        contextWindowTokens: 1000,
        acceptsImages,
        reasoning: { replayPastTurns: true },
        providerModelIds: { vision: "eye-1", plain: "eye-1", blind: "eye-1" },
        blindToolResultImageProviders: ["blind"],
      },
    ],
  });
}

const answer = () => ({ stream: streamOf([streamStart, ...textParts(["ок"]), finishPart()]) });

function recordingModel(handler?: (options: LanguageModelV4CallOptions, call: number) => Promise<ReturnType<typeof answer>>) {
  const prompts: LanguageModelV4Prompt[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt);
      return handler ? handler(options, prompts.length) : answer();
    },
  });
  return { model, prompts };
}

/** История: вызов инструмента и его результат со снимком и запасным текстом страницы. */
function messagesWithShot(fallback = true): ModelMessage[] {
  return [
    { role: "user", content: "Посмотри мой сайт" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "page_screenshot", input: { url: "https://a.ru" } }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "page_screenshot",
          output: {
            type: "content",
            value: [
              { type: "text", text: "Снимок страницы https://a.ru" },
              { type: "file-data", data: Buffer.from(PIXEL).toString("base64"), mediaType: "image/png" },
              ...(fallback ? [toolImageFallbackText("# Студия Светы\nМаникюр и педикюр")] : []),
            ],
          },
        },
      ],
    },
  ];
}

async function runTurn(
  catalog: ModelCatalog,
  providerId: string,
  options: { fallback?: boolean; logError?: (line: string) => void; onError?: (error: unknown) => void } = {},
) {
  const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];
  const request = await buildModelRequest({
    catalog,
    modelId: "eye",
    providerId,
    chatId: "chat-1",
    instructions: "Ты помощник.",
    history,
    env: { MOCK_API_KEY: "k" },
    ...(options.logError && { logError: options.logError }),
  });
  const result = streamText({
    model: request.model,
    messages: messagesWithShot(options.fallback ?? true),
    maxRetries: 0,
    ...(options.onError && { onError: ({ error }: { error: unknown }) => options.onError!(error) }),
  });
  return result.text;
}

function refusal(statusCode: number, responseBody?: string) {
  return new APICallError({ message: "Bad Request", url: "u", requestBodyValues: {}, statusCode, ...(responseBody && { responseBody }), isRetryable: false });
}

const types = (prompt: LanguageModelV4Prompt) => (toolOutput(prompt) as { value: Array<{ type: string }> }).value.map((item) => item.type);
const sentImage = (prompt: LanguageModelV4Prompt) => types(prompt).includes("file");

function toolOutput(prompt: LanguageModelV4Prompt) {
  const tool = prompt.find((message) => message.role === "tool");
  const part = tool?.content.find((item) => item.type === "tool-result");
  return part && "output" in part ? part.output : undefined;
}

describe("картинка в результате инструмента: картинкой или текстом страницы", () => {
  it("провайдер передаёт картинки — уходит снимок, запасного текста нет", async () => {
    const { model, prompts } = recordingModel();
    await runTurn(catalogWith({ vision: model }), "vision");
    const output = toolOutput(prompts[0]!);
    expect(output).toMatchObject({ type: "content" });
    const value = (output as { value: Array<{ type: string; text?: string; mediaType?: string }> }).value;
    expect(value.some((item) => item.type === "file" && item.mediaType === "image/png")).toBe(true);
    expect(JSON.stringify(value)).not.toContain("Студия Светы");
    expect(JSON.stringify(value)).not.toContain("agentChat");
  });

  it("провайдер не умеет картинку в результате инструмента — уходит текст страницы, а не base64", async () => {
    const { model, prompts } = recordingModel();
    await runTurn(catalogWith({ plain: model }), "plain");
    const value = (toolOutput(prompts[0]!) as { value: Array<{ type: string; text?: string }> }).value;
    expect(value.every((item) => item.type === "text")).toBe(true);
    expect(value.map((item) => item.text).join("\n")).toContain("Студия Светы");
    expect(JSON.stringify(prompts[0])).not.toContain(Buffer.from(PIXEL).toString("base64"));
  });

  it("запасного текста нет — вместо картинки постоянная пометка", async () => {
    const { model, prompts } = recordingModel();
    await runTurn(catalogWith({ plain: model }), "plain", { fallback: false });
    const value = (toolOutput(prompts[0]!) as { value: Array<{ type: string; text?: string }> }).value;
    expect(value.every((item) => item.type === "text")).toBe(true);
    expect(value.map((item) => item.text).join("\n")).toMatch(/Картинка не показана/);
  });

  it("у провайдера модель помечена «не видит» — текст страницы", async () => {
    const { model, prompts } = recordingModel();
    await runTurn(catalogWith({ blind: model }), "blind");
    const value = (toolOutput(prompts[0]!) as { value: Array<{ type: string }> }).value;
    expect(value.every((item) => item.type === "text")).toBe(true);
  });

  it("модель не видит картинок вообще — текст страницы", async () => {
    const { model, prompts } = recordingModel();
    await runTurn(catalogWith({ vision: model }, false), "vision");
    const value = (toolOutput(prompts[0]!) as { value: Array<{ type: string }> }).value;
    expect(value.every((item) => item.type === "text")).toBe(true);
  });

  it("явный отказ провайдера из-за картинки — тот же вызов уходит текстом, строка в журнал, дальше сразу текст", async () => {
    const { model, prompts } = recordingModel(async (options, call) => {
      if (call === 1) {
        throw new APICallError({
          message: "Bad Request",
          url: "https://p.example/v1/chat/completions",
          requestBodyValues: {},
          statusCode: 400,
          responseBody: '{"error":{"message":"image_url is not supported for tool messages"}}',
          isRetryable: false,
        });
      }
      return answer();
    });
    const catalog = catalogWith({ vision: model });
    const logError = vi.fn();
    await expect(runTurn(catalog, "vision", { logError })).resolves.toBe("ок");
    expect(prompts).toHaveLength(2);
    expect((toolOutput(prompts[1]!) as { value: Array<{ type: string }> }).value.every((item) => item.type === "text")).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toMatch(/eye.*vision|vision.*eye/);

    // Тот же каталог (та же служба) — следующий ход сразу текстом, без нового отказа
    await runTurn(catalog, "vision", { logError });
    expect(prompts).toHaveLength(3);
    expect((toolOutput(prompts[2]!) as { value: Array<{ type: string }> }).value.every((item) => item.type === "text")).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("отказ запомнен только для своей службы: другой каталог снова пробует картинку", async () => {
    let refuse = true;
    const { model, prompts } = recordingModel(async () => {
      if (refuse) {
        refuse = false;
        throw refusal(400, "image_url is not supported");
      }
      return answer();
    });
    await runTurn(catalogWith({ vision: model }), "vision");
    const { model: other, prompts: otherPrompts } = recordingModel();
    await runTurn(catalogWith({ vision: other }), "vision");
    expect(prompts).toHaveLength(2);
    expect((toolOutput(otherPrompts[0]!) as { value: Array<{ type: string }> }).value.some((item) => item.type === "file")).toBe(true);
  });

  it("отказ по ключу (401) — не отказ из-за картинки: ошибка идёт дальше, текстом не повторяется", async () => {
    const { model, prompts } = recordingModel(async () => {
      throw new APICallError({ message: "Unauthorized", url: "u", requestBodyValues: {}, statusCode: 401, isRetryable: false });
    });
    const logError = vi.fn();
    await expect(runTurn(catalogWith({ vision: model }), "vision", { logError })).rejects.toThrow();
    expect(prompts.every((prompt) => (toolOutput(prompt) as { value: Array<{ type: string }> }).value.some((item) => item.type === "file"))).toBe(true);
    expect(logError.mock.calls.some(([line]) => /картинк/i.test(String(line)))).toBe(false);
  });

  it("отказ 400 на запрос без картинок — не повод для отката", async () => {
    const { model, prompts } = recordingModel(async () => {
      throw new APICallError({ message: "Bad Request", url: "u", requestBodyValues: {}, statusCode: 400, isRetryable: false });
    });
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];
    const request = await buildModelRequest({ catalog: catalogWith({ vision: model }), modelId: "eye", providerId: "vision", chatId: "c", instructions: "И", history, env: { MOCK_API_KEY: "k" } });
    await expect(streamText({ model: request.model, messages: request.messages, maxRetries: 0 }).text).rejects.toThrow();
    expect(prompts).toHaveLength(1);
  });

  it("без картинок в результатах инструментов запрос не меняется", async () => {
    const { model, prompts } = recordingModel();
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }];
    const request = await buildModelRequest({ catalog: catalogWith({ plain: model }), modelId: "eye", providerId: "plain", chatId: "c", instructions: "И", history, env: { MOCK_API_KEY: "k" } });
    await streamText({ model: request.model, messages: request.messages }).text;
    expect(prompts[0]).toEqual([{ role: "user", content: [{ type: "text", text: "Привет" }] }]);
  });
});

describe("ложный откат: отказ не из-за картинки пару не выключает", () => {
  it("неверная схема инструмента (400 без слов о картинке) — ошибка идёт дальше, повтора текстом нет, пара не запомнена", async () => {
    let call = 0;
    const { model, prompts } = recordingModel(async () => {
      call += 1;
      if (call === 1) throw refusal(400, '{"error":{"message":"Invalid schema for function \'page_screenshot\'"}}');
      return answer();
    });
    const catalog = catalogWith({ vision: model });
    const logError = vi.fn();
    await expect(runTurn(catalog, "vision", { logError })).rejects.toThrow();
    expect(prompts).toHaveLength(1);
    await runTurn(catalog, "vision", { logError });
    expect(sentImage(prompts[1]!)).toBe(true);
    expect(logError.mock.calls.some(([line]) => /картинки инструментов/.test(String(line)))).toBe(false);
  });

  it("отказ похож на картинку, но и текстовый повтор упал (400) — ошибка повтора, пара не запомнена", async () => {
    let call = 0;
    const { model, prompts } = recordingModel(async () => {
      call += 1;
      if (call === 1) throw refusal(400, "image content is not supported");
      if (call === 2) throw refusal(400, "Invalid schema for function 'x'");
      return answer();
    });
    const catalog = catalogWith({ vision: model });
    const errors: unknown[] = [];
    await expect(runTurn(catalog, "vision", { onError: (error) => errors.push(error) })).rejects.toThrow();
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(errors.map((error) => (error as APICallError).responseBody))).toContain("Invalid schema");
    await runTurn(catalog, "vision");
    expect(sentImage(prompts[2]!)).toBe(true);
  });

  it("переполнение контекста (400) — не отказ картинки: без повтора, пара не запомнена", async () => {
    let call = 0;
    const { model, prompts } = recordingModel(async () => {
      call += 1;
      if (call === 1) throw refusal(400, "This model's maximum context length is 65536 tokens; your messages resulted in 70000 tokens (including image)");
      return answer();
    });
    const catalog = catalogWith({ vision: model });
    await expect(runTurn(catalog, "vision")).rejects.toThrow();
    expect(prompts).toHaveLength(1);
    await runTurn(catalog, "vision");
    expect(sentImage(prompts[1]!)).toBe(true);
  });

  it("413 (запрос слишком велик) — этот запрос уходит текстом, но пара не запомнена: следующий снова с картинкой", async () => {
    let call = 0;
    const { model, prompts } = recordingModel(async () => {
      call += 1;
      if (call === 1) throw refusal(413, "Request Entity Too Large");
      return answer();
    });
    const catalog = catalogWith({ vision: model });
    await expect(runTurn(catalog, "vision")).resolves.toBe("ок");
    expect(prompts).toHaveLength(2);
    expect(sentImage(prompts[1]!)).toBe(false);
    await runTurn(catalog, "vision");
    expect(sentImage(prompts[2]!)).toBe(true);
  });
});

describe("совместимость: провайдер из toolResultImageProviders профиля", () => {
  it("проверенный вживую провайдер без пометки toolResultImages получает картинку", async () => {
    const { model, prompts } = recordingModel();
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [provider("own", model)],
      addModels: [
        { id: "eye", displayName: "Eye", contextWindowTokens: 1000, acceptsImages: true, reasoning: { replayPastTurns: true }, providerModelIds: { own: "eye-1" }, toolResultImageProviders: ["own"] },
      ],
    });
    await runTurn(catalog, "own");
    expect(sentImage(prompts[0]!)).toBe(true);
  });
});

describe("modelMaySeeToolResultImages", () => {
  it("видит, если модель видит картинки и провайдер не помечен «не видит»; проверки вживую не требуется", () => {
    const profile = { acceptsImages: true, blindToolResultImageProviders: ["blind"] };
    expect(modelMaySeeToolResultImages(profile, "vision")).toBe(true);
    expect(modelMaySeeToolResultImages(profile, "untested")).toBe(true);
    expect(modelMaySeeToolResultImages(profile, "blind")).toBe(false);
    expect(modelMaySeeToolResultImages({ acceptsImages: false }, "vision")).toBe(false);
    expect(modelMaySeeToolResultImages({ acceptsImages: true, acceptsImagesByProvider: { together: false } }, "together")).toBe(false);
  });
});

describe("встроенные провайдеры передают картинку в результате инструмента", () => {
  it("deepseek, together, fireworks, openrouter и маршруты OpenRouter помечены", () => {
    const flagged = standardCatalog.providers.filter((item) => item.toolResultImages === true).map((item) => item.id);
    expect(flagged).toEqual(expect.arrayContaining(["deepseek", "together", "fireworks", "openrouter"]));
  });
});
