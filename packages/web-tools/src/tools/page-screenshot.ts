import { toolImageFallbackText } from "@ykurilov/agent-chat-core";
import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import { assertPublicWebAddress } from "../page-address";
import { createImageCache } from "../image-cache";
import type { HostResolver } from "../page-address";
import { downloadScreenshot } from "../screenshot-download";
import { formatPage } from "../result-text";
import { callService } from "../service-call";
import type { PageScreenshotService } from "../services";

export interface ScreenshotRecord {
  pageUrl: string;
  screenshotUrl: string;
  /** Текст страницы, если служба отдала его вместе со снимком: его получит модель, которой картинка не дойдёт. */
  text?: string;
}

function isScreenshotRecord(value: unknown): value is ScreenshotRecord {
  const record = value as Partial<ScreenshotRecord> | null;
  return typeof record?.pageUrl === "string" && typeof record.screenshotUrl === "string";
}

/** Ссылки Firecrawl живут около суток; час хватает для длинной беседы, а память занимает не больше 20 МБ. */
const screenshotCacheLimits = { maxEntries: 20, maxBytes: 20 * 1024 * 1024, ttlMs: 60 * 60 * 1000 };

function unavailable(pageUrl: string, text?: string): { type: "text"; value: string } {
  const note = `Снимок страницы ${pageUrl} больше недоступен: ссылка на него устарела или не открылась.`;
  return { type: "text", value: text ? `${note} Текст страницы:\n\n${text}` : note };
}

/**
 * В историю попадают два адреса и текст страницы, если служба его отдала. Картинку модель получает при сборке каждого
 * запроса: снимок скачивается заново, а если ссылка устарела, вместо картинки уходит текст. Текст страницы идёт
 * запасным (`toolImageFallbackText`): модели, которой ядро картинку не отправит, он уйдёт вместо неё.
 * Описание и схема неизменны при любых настройках и службах: от них зависит кэш модели.
 */
export function pageScreenshotTool(
  screenshots: PageScreenshotService,
  fetchImplementation: typeof globalThis.fetch,
  resolveHost: HostResolver,
  characterLimit: number,
): Tool<{ url: string }, ScreenshotRecord> {
  // Запрос к модели собирается на каждом ходе: без кэша один и тот же снимок качался бы заново.
  const cache = createImageCache(screenshotCacheLimits);
  return tool({
    // Чужой текст из интернета: чат с ним не запускает живые демонстрации. Модели пометка не уходит — кэш цел.
    metadata: { externalContent: true },
    description:
      "Делает снимок экрана веб-страницы и показывает его тебе как картинку. " +
      "Используй, когда важен внешний вид страницы: вёрстка, график, оформление. Для чтения текста используй read_page.",
    inputSchema: z.object({
      url: z.string().describe("Полный адрес страницы, начинающийся с http:// или https://."),
    }),
    execute: async ({ url }, { abortSignal }) => {
      const address = assertPublicWebAddress(url.trim());
      const shot = await callService(abortSignal, () =>
        screenshots.takeScreenshot(address.href, { ...(abortSignal && { signal: abortSignal }) }),
      );
      return { pageUrl: address.href, screenshotUrl: shot.imageUrl, ...(shot.page && { text: formatPage(shot.page, characterLimit) }) };
    },
    toModelOutput: async ({ output }) => {
      if (!isScreenshotRecord(output)) return unavailable("(адрес неизвестен)");
      const image =
        cache.get(output.screenshotUrl) ?? (await downloadScreenshot(output.screenshotUrl, fetchImplementation, { resolveHost }));
      if (!image) return unavailable(output.pageUrl, output.text);
      cache.set(output.screenshotUrl, image);
      return {
        type: "content",
        value: [
          { type: "text", text: `Снимок страницы ${output.pageUrl}` },
          { type: "file", data: { type: "data", data: image.bytes }, mediaType: image.mediaType },
          ...(output.text ? [toolImageFallbackText(output.text)] : []),
        ],
      };
    },
  });
}
