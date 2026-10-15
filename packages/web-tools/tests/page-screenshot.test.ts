import { convertToModelMessages } from "ai";
import type { ToolSet, UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebTools } from "../src/create-web-tools";
import type { PageReaderService, PageScreenshotService, WebSearchService } from "../src/services";
import { WebToolError } from "../src/web-tool-error";
import { executeOptions, noImages, publicHost, sampleHits, samplePage } from "./support";


const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const shotUrl = "https://storage.example/shots/abc.png?sig=secret-signature";

function screenshotService() {
  return { takeScreenshot: vi.fn<PageScreenshotService["takeScreenshot"]>(async () => ({ imageUrl: shotUrl })) };
}

function parts(extra: Partial<Parameters<typeof createWebTools>[0]> = {}) {
  const search: WebSearchService = { search: async () => sampleHits };
  const reader: PageReaderService = { readPage: async () => samplePage };
  return { search, reader, screenshots: screenshotService(), resolveHost: publicHost, ...extra };
}

function imageFetch(body: BodyInit | null = pngBytes, init: ResponseInit = { headers: { "content-type": "image/png" } }) {
  return vi.fn(async () => new Response(body, init)) as unknown as typeof globalThis.fetch;
}

const seesImages = { profile: { acceptsImages: true, toolResultImageProviders: ["openai"] }, providerId: "openai" };

async function convert(tools: ToolSet, output: unknown) {
  const tool = tools.page_screenshot;
  if (!tool?.toModelOutput) throw new Error("у инструмента нет toModelOutput");
  return tool.toModelOutput({ toolCallId: "call-1", input: { url: "https://example.com" }, output });
}

afterEach(() => vi.useRealTimers());

describe("page_screenshot: когда инструмент есть в наборе", () => {
  it.each([
    { name: "видит картинки и видит их в результате инструмента у этого провайдера", acceptsImages: true, seenVia: ["openai"], providerId: "openai", expected: true },
    { name: "видит картинки, провайдер не проверен (не проверено — не значит «не умеет»)", acceptsImages: true, seenVia: ["openai"], providerId: "deepseek", expected: true },
    { name: "отметка есть, но модель не видит картинки", acceptsImages: false, seenVia: ["openai"], providerId: "openai", expected: false },
    { name: "отметки нет", acceptsImages: true, seenVia: undefined, providerId: "openai", expected: true },
    { name: "отметка пуста", acceptsImages: true, seenVia: [], providerId: "openai", expected: true },
    { name: "провайдер помечен «точно не видит»", acceptsImages: true, blindVia: ["openai"], providerId: "openai", expected: false },
    { name: "модель видит, но у этого провайдера картинок не видит", acceptsImages: true, byProvider: { openai: false }, seenVia: ["openai"], providerId: "openai", expected: false },
    { name: "модель не видит, но у этого провайдера видит", acceptsImages: false, byProvider: { openai: true }, seenVia: ["openai"], providerId: "openai", expected: true },
  ])("$name → инструмент есть: $expected", ({ acceptsImages, byProvider, seenVia, blindVia, providerId, expected }: {
    acceptsImages: boolean;
    byProvider?: Record<string, boolean>;
    seenVia?: string[];
    blindVia?: string[];
    providerId: string;
    expected: boolean;
  }) => {
    const tools = createWebTools(parts())({
      profile: {
        acceptsImages,
        ...(byProvider && { acceptsImagesByProvider: byProvider }),
        ...(seenVia && { toolResultImageProviders: seenVia }),
        ...(blindVia && { blindToolResultImageProviders: blindVia }),
      },
      providerId,
    });
    expect("page_screenshot" in tools).toBe(expected);
  });

  it("без службы снимков инструмента нет, даже если модель и провайдер подходят", () => {
    const { screenshots: _unused, ...withoutScreenshots } = parts();
    expect("page_screenshot" in createWebTools(withoutScreenshots)(seesImages)).toBe(false);
  });

  it("все веб-инструменты помечены как чужой текст (`metadata.externalContent`): чат с ними не запускает живые демонстрации", () => {
    const tools = createWebTools(parts())(seesImages);
    expect(Object.keys(tools).sort()).toEqual(["page_screenshot", "read_page", "web_search"]);
    for (const item of Object.values(tools)) expect(item.metadata).toEqual({ externalContent: true });
  });

  it("поиск и чтение остаются в наборе при любом решении про снимок", () => {
    const tools = createWebTools(parts())(noImages);
    expect(Object.keys(tools).sort()).toEqual(["read_page", "web_search"]);
  });

  it("описание и схема входа не зависят от настроек и службы", async () => {
    const { asSchema } = await import("ai");
    const describeTool = async (tools: ToolSet) => {
      const tool = tools.page_screenshot;
      if (!tool) throw new Error("инструмента нет");
      return [tool.description, await asSchema(tool.inputSchema).jsonSchema];
    };
    const first = createWebTools(parts({ pageCharacterLimit: 10 }))(seesImages);
    const second = createWebTools(parts({ searchResultLimit: 9, screenshots: { takeScreenshot: async () => ({ imageUrl: "x" }) } }))(seesImages);
    expect(await describeTool(first)).toEqual(await describeTool(second));
  });
});

describe("page_screenshot: запись в историю", () => {
  it("результат — только адрес страницы и адрес снимка, и он маленький", async () => {
    const service = screenshotService();
    const tools = createWebTools(parts({ screenshots: service }))(seesImages);
    const result = await tools.page_screenshot?.execute?.({ url: "https://example.com/a" } as never, executeOptions());

    expect(service.takeScreenshot).toHaveBeenCalledWith("https://example.com/a", expect.anything());
    expect(result).toEqual({ pageUrl: "https://example.com/a", screenshotUrl: shotUrl });
    expect(JSON.stringify(result).length).toBeLessThan(2048);
  });

  it("служба вернула и текст страницы — он в записи (по пределу), чтобы модели без картинки было что показать", async () => {
    const service = { takeScreenshot: vi.fn<PageScreenshotService["takeScreenshot"]>(async () => ({ imageUrl: shotUrl, page: { ...samplePage, markdown: "Абзац один.\n\nАбзац два длинный." } })) };
    const tools = createWebTools(parts({ screenshots: service, pageCharacterLimit: 12 }))(seesImages);
    const result = (await tools.page_screenshot?.execute?.({ url: "https://example.com/a" } as never, executeOptions())) as { text?: string };
    expect(result).toMatchObject({ pageUrl: "https://example.com/a", screenshotUrl: shotUrl });
    expect(result.text).toContain("Абзац один.");
    expect(result.text).not.toContain("Абзац два");
    expect(result.text).toMatch(/Текст обрезан/);
  });

  it("локальный адрес отклоняется до обращения к службе", async () => {
    const service = screenshotService();
    const tools = createWebTools(parts({ screenshots: service }))(seesImages);
    await expect(tools.page_screenshot?.execute?.({ url: "http://localhost:3000" } as never, executeOptions())).rejects.toThrowError(WebToolError);
    expect(service.takeScreenshot).not.toHaveBeenCalled();
  });

  it("чужая ошибка службы не выдаёт подробностей", async () => {
    const screenshots = { takeScreenshot: async () => Promise.reject(new Error("boom https://secret.example")) };
    const tools = createWebTools(parts({ screenshots }))(seesImages);
    const failure = tools.page_screenshot?.execute?.({ url: "https://example.com" } as never, executeOptions());
    await expect(failure).rejects.toThrowError(WebToolError);
    await expect(failure).rejects.not.toThrowError(/secret/);
  });
});

describe("page_screenshot: что получает модель", () => {
  const output = { pageUrl: "https://example.com", screenshotUrl: shotUrl };

  it("скачивает картинку и отдаёт её файлом вместе с подписью", async () => {
    const download = imageFetch();
    const tools = createWebTools(parts({ fetch: download }))(seesImages);
    const converted = await convert(tools, output);

    expect(download).toHaveBeenCalledWith(shotUrl, expect.anything());
    expect(converted.type).toBe("content");
    const value = (converted as { value: Array<Record<string, unknown>> }).value;
    expect(value[0]).toMatchObject({ type: "text", text: expect.stringContaining("https://example.com") });
    expect(value[1]).toMatchObject({ type: "file", mediaType: "image/png", data: { type: "data" } });
    const data = (value[1] as { data: { data: Uint8Array } }).data.data;
    expect(Array.from(data)).toEqual(Array.from(pngBytes));
  });

  it("есть текст страницы — он идёт запасным текстом после картинки: модель без картинки получит его, а не base64", async () => {
    const tools = createWebTools(parts({ fetch: imageFetch() }))(seesImages);
    const converted = (await convert(tools, { ...output, text: "# Студия\nМаникюр" })) as { value: Array<Record<string, unknown>> };
    expect(converted.value[1]).toMatchObject({ type: "file" });
    expect(converted.value[2]).toMatchObject({ type: "text", text: expect.stringContaining("Маникюр"), providerOptions: { agentChat: { toolImageFallback: true } } });
  });

  it("снимок не скачался, а текст страницы есть — модели уходит текст страницы", async () => {
    const tools = createWebTools(parts({ fetch: imageFetch("нет", { status: 404, headers: { "content-type": "text/plain" } }) }))(seesImages);
    const converted = (await convert(tools, { ...output, text: "# Студия\nМаникюр" })) as { type: string; value: string };
    expect(converted.type).toBe("text");
    expect(converted.value).toContain("больше недоступен");
    expect(converted.value).toContain("Маникюр");
  });

  it.each([
    ["ссылка не открывается (404)", () => imageFetch("нет", { status: 404, headers: { "content-type": "text/plain" } })],
    ["сеть оборвалась", () => vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof globalThis.fetch],
    ["это не картинка", () => imageFetch("<html>", { headers: { "content-type": "text/html" } })],
    ["файл больше 5 МБ (по заголовку)", () => imageFetch(pngBytes, { headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) } })],
    ["файл больше 5 МБ (по факту)", () => imageFetch(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } })],
  ])("%s → модели уходит текст, что снимок больше недоступен", async (_name, makeFetch) => {
    const tools = createWebTools(parts({ fetch: makeFetch() }))(seesImages);
    const converted = await convert(tools, output);

    expect(converted.type).toBe("text");
    const text = (converted as { value: string }).value;
    expect(text).toContain("https://example.com");
    expect(text).toContain("больше недоступен");
    expect(text).not.toContain("secret-signature");
  });

  it("зависшая загрузка обрывается через 20 секунд", async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof globalThis.fetch;
    const tools = createWebTools(parts({ fetch: hanging }))(seesImages);
    const pending = convert(tools, output);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).type).toBe("text");
  });

  it("адрес снимка не из http/https/data (например, файл на диске) не скачивается", async () => {
    const download = imageFetch();
    const tools = createWebTools(parts({ fetch: download }))(seesImages);
    const converted = await convert(tools, { pageUrl: "https://example.com", screenshotUrl: "file:///etc/passwd" });
    expect(converted.type).toBe("text");
    expect(download).not.toHaveBeenCalled();
  });

  it("адрес снимка во внутренней сети не скачивается", async () => {
    const download = imageFetch();
    const tools = createWebTools(parts({ fetch: download }))(seesImages);
    const converted = await convert(tools, { pageUrl: "https://example.com", screenshotUrl: "http://169.254.169.254/latest" });
    expect(converted.type).toBe("text");
    expect(download).not.toHaveBeenCalled();
  });

  it("повторный ход не качает тот же снимок заново", async () => {
    const download = imageFetch();
    const tools = createWebTools(parts({ fetch: download }))(seesImages);
    const first = await convert(tools, output);
    const second = await convert(tools, output);

    expect(download).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("другой снимок качается отдельно", async () => {
    const download = imageFetch();
    const tools = createWebTools(parts({ fetch: download }))(seesImages);
    await convert(tools, output);
    await convert(tools, { pageUrl: "https://example.com", screenshotUrl: "https://storage.example/shots/other.png" });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("неудача в кэш не попадает: в следующий раз пробуем снова", async () => {
    let attempt = 0;
    const flaky = vi.fn(async () =>
      ++attempt === 1 ? new Response("нет", { status: 404 }) : new Response(pngBytes, { headers: { "content-type": "image/png" } }),
    ) as unknown as typeof globalThis.fetch;
    const tools = createWebTools(parts({ fetch: flaky }))(seesImages);
    expect((await convert(tools, output)).type).toBe("text");
    expect((await convert(tools, output)).type).toBe("content");
  });

  it("запись в истории нетипичного вида (без адресов) не роняет сборку запроса", async () => {
    const tools = createWebTools(parts({ fetch: imageFetch() }))(seesImages);
    expect((await convert(tools, "старая запись")).type).toBe("text");
  });
});

describe("page_screenshot: история после смены модели", () => {
  const history: UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "сделай скриншот" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-page_screenshot",
          toolCallId: "call-1",
          state: "output-available",
          input: { url: "https://example.com" },
          output: { pageUrl: "https://example.com", screenshotUrl: shotUrl },
        },
        { type: "text", text: "Готово" },
      ],
    },
    { id: "u2", role: "user", parts: [{ type: "text", text: "а теперь ответь словами" }] },
  ];

  it("модель без инструмента снимка принимает историю с прежним вызовом: запись идёт текстом", async () => {
    const tools = createWebTools(parts())(noImages);
    expect("page_screenshot" in tools).toBe(false);

    const messages = await convertToModelMessages(history, { tools });
    const toolMessage = messages.find((message) => message.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(JSON.stringify(toolMessage)).toContain("pageUrl");
  });

  it("модель с инструментом снимка получает в истории картинку", async () => {
    const tools = createWebTools(parts({ fetch: imageFetch() }))(seesImages);
    const messages = await convertToModelMessages(history, { tools });
    const toolMessage = messages.find((message) => message.role === "tool");
    expect(JSON.stringify(toolMessage)).toContain("image/png");
  });
});
