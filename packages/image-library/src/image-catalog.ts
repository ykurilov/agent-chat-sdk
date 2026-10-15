import { isImageAddress } from "./image-address";

/** Запись каталога приложения: что приложение знает о картинке. Сами файлы лежат у приложения. */
export interface ImageEntry {
  /** 1–200 знаков; модель передаёт его в `show_image`. */
  id: string;
  /** Короткое название — видимая подпись под картинкой. */
  title: string;
  /** Что изображено — для тех, кто не видит картинку (экранный диктор), и в окне просмотра. */
  alt: string;
  /** Путь от корня своего сайта `/…` или `https://…` на домене из `allowedHosts`. */
  url: string;
  /** Размеры в пикселях, целые больше нуля: место под картинку держится до загрузки. */
  width: number;
  height: number;
  /** Для поиска: о чём картинка. Модель видит первые 300 знаков. */
  description?: string;
  /** Понятия, которые картинка объясняет: по ним ищет `find_images`. */
  concepts?: string[];
  tags?: string[];
}

const MAX_ID_LENGTH = 200;
export const MAX_FOUND = 8;

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isSize = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0;
const isTextList = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

/** Что не так с записью; `undefined` — запись годная. Текст без содержимого записи, кроме id. */
export function checkImageEntry(entry: ImageEntry, allowedHosts: readonly string[]): string | undefined {
  if (typeof entry?.id !== "string" || entry.id === "" || entry.id.length > MAX_ID_LENGTH) return "id должен быть строкой от 1 до 200 знаков";
  if (!isText(entry.title)) return "пустое название";
  if (!isText(entry.alt)) return "пустой alt — опишите, что на картинке";
  if (!isImageAddress(entry.url, allowedHosts)) return "адрес не своего сайта («/…») и не https на разрешённом домене (allowedHosts)";
  if (!isSize(entry.width)) return "ширина должна быть целым числом пикселей больше нуля";
  if (!isSize(entry.height)) return "высота должна быть целым числом пикселей больше нуля";
  if (entry.description !== undefined && typeof entry.description !== "string") return "описание не строка";
  if (entry.concepts !== undefined && !isTextList(entry.concepts)) return "понятия должны быть списком строк";
  if (entry.tags !== undefined && !isTextList(entry.tags)) return "теги должны быть списком строк";
  return undefined;
}

const nameOf = (entry: ImageEntry, index: number) => (typeof entry?.id === "string" && entry.id !== "" ? `«${entry.id.slice(0, MAX_ID_LENGTH)}»` : `№${index + 1}`);

/** Каталог-массив проверяется целиком при создании: ошибка разработчика видна сразу, с id записи. */
export function checkImageCatalog(images: readonly ImageEntry[], allowedHosts: readonly string[]): void {
  const seen = new Set<string>();
  images.forEach((image, index) => {
    const reason = checkImageEntry(image, allowedHosts);
    if (reason) throw new Error(`Каталог картинок: запись ${nameOf(image, index)} — ${reason}.`);
    if (seen.has(image.id)) throw new Error(`Каталог картинок: id ${nameOf(image, index)} повторяется.`);
    seen.add(image.id);
  });
}

// Встроенный поиск по словам: без регистра, «ё» как «е», по началам слов — так «клетки» находит «клетка».
const serviceWords = new Set(
  "картинка картинки картинку картинок изображение изображения рисунок рисунка рисунки схема схему схемы фото про как что это для или на по из от покажи".split(" "),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .replaceAll("ё", "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

/** Начало слова, по которому сравниваем: окончания падежей отбрасываются. */
const stem = (word: string) => (word.length > 5 ? word.slice(0, 5) : word.length >= 4 ? word.slice(0, -1) : word);

const weights = { title: 3, concepts: 3, tags: 2, description: 1 } as const;
type Field = keyof typeof weights;

function score(image: ImageEntry, queryStems: string[]): number {
  const fields: Record<Field, string[]> = {
    title: words(image.title),
    concepts: (image.concepts ?? []).flatMap(words),
    tags: (image.tags ?? []).flatMap(words),
    description: [...words(image.description ?? ""), ...words(image.alt)],
  };
  let total = 0;
  for (const queryStem of queryStems) {
    for (const field of Object.keys(weights) as Field[]) {
      if (fields[field].some((word) => word.startsWith(queryStem))) total += weights[field];
    }
  }
  return total;
}

/** До восьми подходящих: название и понятия весят больше тегов, теги — больше описания; при равенстве — порядок каталога. */
export function searchImages(images: readonly ImageEntry[], query: string): ImageEntry[] {
  const all = words(query);
  const meaningful = all.filter((word) => !serviceWords.has(word));
  const queryStems = [...new Set((meaningful.length > 0 ? meaningful : all).map(stem))];
  if (queryStems.length === 0) return [];
  return images
    .map((image, index) => ({ image, index, score: score(image, queryStems) }))
    .filter((found) => found.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_FOUND)
    .map((found) => found.image);
}
