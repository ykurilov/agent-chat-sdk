import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { MAX_FOUND, checkImageCatalog, checkImageEntry, searchImages } from "./image-catalog";
import type { ImageEntry } from "./image-catalog";
import { ImageLibraryError } from "./image-library-error";

/** Кто спрашивает: по нему функции приложения могут учитывать права человека. */
export interface ImageContext {
  ownerId: string;
  chatId: string;
}

/** Каталог живыми запросами — для большой базы или своего поиска. Записи проверяются на каждом вызове. */
export interface ImageSource {
  search(query: string, context: ImageContext): ImageEntry[] | Promise<ImageEntry[]>;
  get(id: string, context: ImageContext): ImageEntry | undefined | Promise<ImageEntry | undefined>;
}

export type CreateImageLibraryOptions = (
  | {
      /**
       * Массив — постоянный каталог, проверяется при создании. Функция — каталог, который меняется без перезапуска:
       * вызывается на каждом поиске и показе, новые записи видны сразу.
       */
      images: readonly ImageEntry[] | (() => readonly ImageEntry[] | Promise<readonly ImageEntry[]>);
      source?: never;
    }
  | { source: ImageSource; images?: never }
) & {
  /** Домены, с которых можно брать картинки по `https://…` (`["cdn.school.ru"]`). Пути `/…` своего сайта годятся всегда. */
  allowedHosts?: readonly string[];
  /** Куда писать о негодных записях и сбоях каталога. По умолчанию — `console.error`. */
  logError?: (message: string) => void;
};

/** Выбранная модель хода: ядро передаёт в `agent.tools(model)` и того, чей ход, и чат. */
export interface ImageLibraryModel {
  ownerId?: string;
  chatId?: string;
}

export interface ImageLibrary {
  /** `{ find_images, show_image }` для `agent.tools`; без `ownerId` и `chatId` — пустой набор. */
  tools(model: ImageLibraryModel): ToolSet;
}

/**
 * Результат `show_image`: хранится в сообщении и целиком нужен показу — даже если картинку потом убрали из каталога.
 * Отказ — `ImageLibraryError`; `{ отказ }` бывает только в сообщениях, сохранённых до 0.56.
 */
export type ShownImage =
  | { картинка: { id: string; название: string; подпись: string; адрес: string; ширина: number; высота: number } }
  | { отказ: string };

const MAX_DESCRIPTION = 300;
const NOT_IN_CATALOG = "Такой картинки нет в каталоге. Найди её через find_images и передай id оттуда.";
const CATALOG_UNAVAILABLE = "Каталог картинок сейчас недоступен. Скажи об этом человеку и не пробуй снова в этом ответе.";
const UNAVAILABLE: unique symbol = Symbol("каталог недоступен");
const NOTHING_FOUND = "Ничего не нашлось. Попробуй другие слова: понятие или тему, а не название целиком.";

// Описания и схемы постоянные при любом каталоге: начало запроса к модели не меняется, кэш модели цел.
const findImagesDescription =
  "Ищет готовые картинки в каталоге приложения: схемы, иллюстрации, рисунки к понятиям. Отдаёт до 8 подходящих с id, " +
  "названием, описанием, понятиями и тегами. Вызывай, когда картинка поможет объяснить, или человек просит её, и перед show_image.";
const showImageDescription =
  "Показывает человеку картинку из каталога прямо в ответе, с подписью. Передай id из результата find_images — другие id " +
  "и адреса не подойдут. Ссылку на картинку в ответ не вставляй: она уже на экране. Объясняй словами, что на ней.";

const findImagesInput = z.object({
  query: z.string().min(1).max(200).describe("Слова для поиска: понятие или тема картинки."),
});
const showImageInput = z.object({
  id: z.string().min(1).max(200).describe("id картинки из результата find_images."),
});

function forModel(image: ImageEntry) {
  const description = image.description?.trim();
  return {
    id: image.id,
    название: image.title,
    ...(description && { описание: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description }),
    ...(image.concepts?.length && { понятия: image.concepts }),
    ...(image.tags?.length && { теги: image.tags }),
  };
}

const shown = (image: ImageEntry): ShownImage => ({
  картинка: { id: image.id, название: image.title, подпись: image.alt, адрес: image.url, ширина: image.width, высота: image.height },
});

/** Сколько ждать функцию каталога приложения: дольше — «каталог недоступен», ход не висит. */
const CATALOG_TIMEOUT_MS = 5_000;
/** Сколько разных бед каталога помнить, чтобы не писать их снова; дальше память начинается заново. */
const MAX_LOGGED = 500;

/** Копия записи, которую приложение уже не поменяет: каталог-массив проверен при создании и таким остаётся. */
const frozenCopy = (image: ImageEntry): ImageEntry =>
  Object.freeze({
    ...image,
    ...(image.concepts && { concepts: Object.freeze([...image.concepts]) as string[] }),
    ...(image.tags && { tags: Object.freeze([...image.tags]) as string[] }),
  });

/** Ответ функции приложения или исключение «не ответила за 5 с». */
async function withinTimeout<T>(work: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`не ответила за ${CATALOG_TIMEOUT_MS / 1000} с`)), CATALOG_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), late]);
  } finally {
    clearTimeout(timer);
  }
}

const shortId = (id: unknown) => (typeof id === "string" ? id.slice(0, 200) : "(без id)");

/** Инструменты библиотеки картинок поверх каталога приложения: модель ищет и показывает, сервер принимает только id из каталога. */
export function createImageLibrary(options: CreateImageLibraryOptions): ImageLibrary {
  const logError = options.logError ?? ((message: string) => console.error(message));
  const allowedHosts = [...(options.allowedHosts ?? [])];
  const given = Array.isArray(options.images) ? (options.images as readonly ImageEntry[]) : undefined;
  if (given) checkImageCatalog(given, allowedHosts);
  const fixed = given && Object.freeze(given.map(frozenCopy));
  const read = typeof options.images === "function" ? options.images : undefined;

  /** Одна и та же беда каталога-функции пишется в журнал один раз, а не на каждом вызове. */
  const logged = new Set<string>();
  const logOnce = (message: string) => {
    if (logged.has(message)) return;
    if (logged.size >= MAX_LOGGED) logged.clear();
    logged.add(message);
    logError(message);
  };

  /** Негодная запись пропускается; в журнал — только id и причина. */
  const usable = (image: ImageEntry | null | undefined): image is ImageEntry => {
    if (image === undefined || image === null) return false;
    const reason = checkImageEntry(image, allowedHosts);
    if (reason) logOnce(`Картинка «${shortId(image?.id)}» из каталога приложения пропущена: ${reason}.`);
    return !reason;
  };

  /** Сбой функции приложения — в журнал сервера; модели только нейтральное «недоступен», без текста исключения. */
  const unavailable = (what: string, reason: unknown): typeof UNAVAILABLE => {
    logError(`Каталог картинок приложения: ${what} — ${reason instanceof Error ? reason.message : String(reason)}.`);
    return UNAVAILABLE;
  };

  /** Каталог-функция: перечитывается на каждом вызове; негодные записи и повторы id отброшены. */
  async function current(): Promise<readonly ImageEntry[] | typeof UNAVAILABLE> {
    if (fixed) return fixed;
    let list: unknown;
    try {
      list = await withinTimeout(read!);
    } catch (error) {
      return unavailable("images() упала", error);
    }
    if (!Array.isArray(list)) return unavailable("images() вернула не список", list === null ? "null" : typeof list);
    const seen = new Set<string>();
    return (list as ImageEntry[]).filter((image) => {
      if (!usable(image)) return false;
      if (seen.has(image.id)) {
        logOnce(`Картинка «${shortId(image.id)}» в каталоге приложения повторяется: взята первая.`);
        return false;
      }
      seen.add(image.id);
      return true;
    });
  }

  async function find(query: string, context: ImageContext): Promise<ImageEntry[] | typeof UNAVAILABLE> {
    if (!options.source) {
      const catalog = await current();
      return catalog === UNAVAILABLE ? catalog : searchImages(catalog, query);
    }
    let found: unknown;
    try {
      found = await withinTimeout(() => options.source!.search(query, context));
    } catch (error) {
      return unavailable("search упал", error);
    }
    if (!Array.isArray(found)) return unavailable("search вернул не список", found === null ? "null" : typeof found);
    return (found as ImageEntry[]).filter(usable).slice(0, MAX_FOUND);
  }

  async function get(id: string, context: ImageContext): Promise<ImageEntry | undefined | typeof UNAVAILABLE> {
    if (!options.source) {
      const catalog = await current();
      return catalog === UNAVAILABLE ? catalog : catalog.find((image) => image.id === id);
    }
    let image: ImageEntry | null | undefined;
    try {
      image = await withinTimeout(() => options.source!.get(id, context));
    } catch (error) {
      return unavailable("get упал", error);
    }
    return usable(image) && image.id === id ? image : undefined;
  }

  const findImages = (context: ImageContext) =>
    tool({
      description: findImagesDescription,
      inputSchema: findImagesInput,
      execute: async ({ query }) => {
        const result = await find(query, context);
        if (result === UNAVAILABLE) throw new ImageLibraryError("catalog_unavailable", CATALOG_UNAVAILABLE);
        const found = result.map(forModel);
        return found.length > 0 ? { найдено: found } : { найдено: [], совет: NOTHING_FOUND };
      },
    });

  const showImage = (context: ImageContext) =>
    tool({
      description: showImageDescription,
      inputSchema: showImageInput,
      execute: async ({ id }): Promise<ShownImage> => {
        const image = await get(id, context);
        if (image === UNAVAILABLE) throw new ImageLibraryError("catalog_unavailable", CATALOG_UNAVAILABLE);
        if (!image) throw new ImageLibraryError("not_in_catalog", NOT_IN_CATALOG);
        return shown(image);
      },
      // Модели — коротко, что показано; экрану — весь результат.
      toModelOutput: ({ output }) =>
        output && "картинка" in output
          ? { type: "json", value: { показано: output.картинка.название } }
          : { type: "json", value: { отказ: output?.отказ ?? NOT_IN_CATALOG } },
    });

  return {
    tools(model): ToolSet {
      if (!model.ownerId || !model.chatId) return {};
      const context = { ownerId: model.ownerId, chatId: model.chatId };
      return { find_images: findImages(context), show_image: showImage(context) };
    },
  };
}
