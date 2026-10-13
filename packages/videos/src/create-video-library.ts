import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { timeLabel } from "./time-label";
import { parseVideoUrl } from "./video-address";
import type { VideoProvider } from "./video-address";
import { MAX_FOUND, checkVideoCatalog, checkVideoEntry, searchVideos } from "./video-catalog";
import type { VideoEntry } from "./video-catalog";

/** Кто спрашивает: по нему функции приложения могут учитывать права человека. */
export interface VideoContext {
  ownerId: string;
  chatId: string;
}

/** Каталог функциями — для большой базы или своего поиска. Записи проверяются на каждом вызове. */
export interface VideoSource {
  search(query: string, context: VideoContext): VideoEntry[] | Promise<VideoEntry[]>;
  get(id: string, context: VideoContext): VideoEntry | undefined | Promise<VideoEntry | undefined>;
}

export type CreateVideoLibraryOptions = ({ videos: VideoEntry[]; source?: never } | { source: VideoSource; videos?: never }) & {
  /** Куда писать о негодных записях из функций приложения. По умолчанию — `console.error`. */
  logError?: (message: string) => void;
};

/** Выбранная модель хода: ядро передаёт в `agent.tools(model)` и того, чей ход, и чат. */
export interface VideoLibraryModel {
  ownerId?: string;
  chatId?: string;
}

export interface VideoLibrary {
  /** `{ find_videos, show_video }` для `agent.tools`; без `ownerId` и `chatId` — пустой набор. */
  tools(model: VideoLibraryModel): ToolSet;
}

/** Результат `show_video`: хранится в сообщении и целиком нужен карточке — даже если видео потом убрали из каталога. */
export type ShownVideo =
  | {
      видео: { id: string; название: string; площадка: VideoProvider; код: string; длительность?: number; обложка?: string; начало?: number };
    }
  | { отказ: string };

const MAX_DESCRIPTION = 300;
const NOT_IN_CATALOG = "Такого видео нет в каталоге. Найди его через find_videos и передай id оттуда.";
const CATALOG_UNAVAILABLE = "Каталог видео сейчас недоступен. Скажи об этом человеку и не пробуй снова в этом ответе.";
const CATALOG_UNAVAILABLE_MARK: unique symbol = Symbol("каталог недоступен");
const NOTHING_FOUND = "Ничего не нашлось. Попробуй другие слова: тему или ключевое понятие, а не название целиком.";

// Описания и схемы постоянные при любом каталоге: начало запроса к модели не меняется, кэш модели цел (SC-003).
const findVideosDescription =
  "Ищет видео в каталоге приложения: уроки, лекции, записи. Отдаёт до 8 подходящих с id, названием, описанием, " +
  "длительностью и главами. Вызывай, когда человек просит видео, урок или запись по теме, и перед show_video.";
const showVideoDescription =
  "Показывает человеку видео из каталога карточкой с плеером. Передай id из результата find_videos — другие id не подойдут. " +
  "startSeconds — с какой секунды начать, если нужна конкретная глава (возьми «секунда» из глав). " +
  "Ссылку на видео в ответ не вставляй: карточка уже на экране. Назови видео одной фразой.";

const findVideosInput = z.object({
  query: z.string().min(1).max(200).describe("Слова для поиска: тема или понятие, о котором видео."),
});
const showVideoInput = z.object({
  id: z.string().min(1).max(200).describe("id видео из результата find_videos."),
  startSeconds: z.number().int().min(0).optional().describe("С какой секунды начать. Не указывай, чтобы начать с начала."),
});

function forModel(video: VideoEntry) {
  const description = video.description?.trim();
  return {
    id: video.id,
    название: video.title,
    ...(description && { описание: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description }),
    ...(video.durationSeconds !== undefined && { длительность: timeLabel(video.durationSeconds) }),
    ...(video.chapters?.length && {
      главы: video.chapters.map((chapter) => ({ название: chapter.title, начало: timeLabel(chapter.startSeconds), секунда: chapter.startSeconds })),
    }),
  };
}

function shown(video: VideoEntry, startSeconds: number | undefined): ShownVideo {
  const address = parseVideoUrl(video.url)!;
  return {
    видео: {
      id: video.id,
      название: video.title,
      площадка: address.provider,
      код: address.code,
      ...(video.durationSeconds !== undefined && { длительность: video.durationSeconds }),
      ...(video.poster !== undefined && { обложка: video.poster }),
      ...(startSeconds && { начало: startSeconds }),
    },
  };
}

const shortId = (id: unknown) => (typeof id === "string" ? id.slice(0, 200) : "(без id)");

/** Инструменты видео поверх каталога приложения: модель ищет и показывает, сервер принимает только id из каталога. */
export function createVideoLibrary(options: CreateVideoLibraryOptions): VideoLibrary {
  const logError = options.logError ?? ((message: string) => console.error(message));
  const catalog = options.videos ? [...options.videos] : undefined;
  if (catalog) checkVideoCatalog(catalog);
  const byId = new Map(catalog?.map((video) => [video.id, video]));

  /** Негодная запись из базы приложения пропускается; в журнал — только id и причина. */
  const usable = (video: VideoEntry | null | undefined): video is VideoEntry => {
    if (video === undefined || video === null) return false;
    const reason = checkVideoEntry(video);
    if (reason) logError(`Видео «${shortId(video?.id)}» из каталога приложения пропущено: ${reason}.`);
    return !reason;
  };

  /** Сбой функции приложения — в журнал сервера; модели только нейтральное «недоступен», без текста исключения. */
  const unavailable = (what: string, reason: unknown): typeof CATALOG_UNAVAILABLE_MARK => {
    logError(`Каталог видео приложения: ${what} — ${reason instanceof Error ? reason.message : String(reason)}.`);
    return CATALOG_UNAVAILABLE_MARK;
  };

  async function find(query: string, context: VideoContext): Promise<VideoEntry[] | typeof CATALOG_UNAVAILABLE_MARK> {
    if (catalog) return searchVideos(catalog, query);
    let found: unknown;
    try {
      found = await options.source!.search(query, context);
    } catch (error) {
      return unavailable("search упал", error);
    }
    if (!Array.isArray(found)) return unavailable("search вернул не список", found === null ? "null" : typeof found);
    return (found as VideoEntry[]).filter(usable).slice(0, MAX_FOUND);
  }

  async function get(id: string, context: VideoContext): Promise<VideoEntry | undefined | typeof CATALOG_UNAVAILABLE_MARK> {
    if (catalog) return byId.get(id);
    let video: VideoEntry | null | undefined;
    try {
      video = await options.source!.get(id, context);
    } catch (error) {
      return unavailable("get упал", error);
    }
    return usable(video) && video.id === id ? video : undefined;
  }

  const findVideos = (context: VideoContext) =>
    tool({
      description: findVideosDescription,
      inputSchema: findVideosInput,
      execute: async ({ query }) => {
        const result = await find(query, context);
        if (result === CATALOG_UNAVAILABLE_MARK) return { отказ: CATALOG_UNAVAILABLE };
        const found = result.map(forModel);
        return found.length > 0 ? { найдено: found } : { найдено: [], совет: NOTHING_FOUND };
      },
    });

  const showVideo = (context: VideoContext) =>
    tool({
      description: showVideoDescription,
      inputSchema: showVideoInput,
      execute: async ({ id, startSeconds }): Promise<ShownVideo> => {
        const video = await get(id, context);
        if (video === CATALOG_UNAVAILABLE_MARK) return { отказ: CATALOG_UNAVAILABLE };
        if (!video) return { отказ: NOT_IN_CATALOG };
        if (startSeconds !== undefined && video.durationSeconds !== undefined && startSeconds >= video.durationSeconds) {
          return { отказ: `Начало ${timeLabel(startSeconds)} за концом видео: оно длится ${timeLabel(video.durationSeconds)}.` };
        }
        return shown(video, startSeconds);
      },
      // Модели — коротко, что показано; карточке — весь результат.
      toModelOutput: ({ output }) => {
        if (output && "видео" in output) {
          const { название, начало } = output.видео;
          return { type: "json", value: { показано: название, ...(начало && { с: timeLabel(начало) }) } };
        }
        return { type: "json", value: { отказ: output?.отказ ?? NOT_IN_CATALOG } };
      },
    });

  return {
    tools(model): ToolSet {
      if (!model.ownerId || !model.chatId) return {};
      const context = { ownerId: model.ownerId, chatId: model.chatId };
      return { find_videos: findVideos(context), show_video: showVideo(context) };
    },
  };
}
