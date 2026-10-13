import { isPosterAddress, parseVideoUrl } from "./video-address";

/** Запись каталога приложения: что приложение знает о видео. */
export interface VideoEntry {
  /** 1–200 знаков; модель передаёт его в `show_video`. */
  id: string;
  title: string;
  /** Ссылка на YouTube или Kinescope. */
  url: string;
  description?: string;
  /** Целое больше нуля. */
  durationSeconds?: number;
  /** `https://…` или путь от корня сайта `/…`. Нет — скин рисует заглушку, без запросов к площадке. */
  poster?: string;
  chapters?: Array<{ title: string; startSeconds: number }>;
}

const MAX_ID_LENGTH = 200;
export const MAX_FOUND = 8;

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Что не так с записью; `undefined` — запись годная. Текст без содержимого записи, кроме id. */
export function checkVideoEntry(entry: VideoEntry): string | undefined {
  if (typeof entry?.id !== "string" || entry.id === "" || entry.id.length > MAX_ID_LENGTH) return "id должен быть строкой от 1 до 200 знаков";
  if (!isText(entry.title)) return "пустое название";
  if (typeof entry.url !== "string" || !parseVideoUrl(entry.url)) return "ссылка не на YouTube и не на Kinescope";
  if (entry.description !== undefined && typeof entry.description !== "string") return "описание не строка";
  const duration = entry.durationSeconds;
  if (duration !== undefined && (!Number.isInteger(duration) || duration <= 0)) return "длительность должна быть целым числом секунд больше нуля";
  if (entry.poster !== undefined && !isPosterAddress(entry.poster)) {
    return "обложка должна быть адресом https:// или путём от корня сайта «/…»";
  }
  if (entry.chapters !== undefined) {
    if (!Array.isArray(entry.chapters)) return "главы должны быть списком";
    for (const chapter of entry.chapters) {
      if (!isText(chapter?.title)) return "глава без названия";
      const start = chapter.startSeconds;
      if (!Number.isInteger(start) || start < 0) return "начало главы должно быть целым числом секунд от нуля";
      if (duration !== undefined && start >= duration) return "глава начинается за концом видео";
    }
  }
  return undefined;
}

/** Каталог-массив проверяется целиком при создании: ошибка разработчика видна сразу, с id записи. */
export function checkVideoCatalog(videos: readonly VideoEntry[]): void {
  const seen = new Set<string>();
  videos.forEach((video, index) => {
    const reason = checkVideoEntry(video);
    const name = typeof video?.id === "string" && video.id !== "" ? `«${video.id}»` : `№${index + 1}`;
    if (reason) throw new Error(`Каталог видео: запись ${name} — ${reason}.`);
    if (seen.has(video.id)) throw new Error(`Каталог видео: id ${name} повторяется.`);
    seen.add(video.id);
  });
}

// Встроенный поиск по словам: без регистра, «ё» как «е», по началам слов — так «промптов» находит «промпты».
const serviceWords = new Set(
  "видео ролик ролика ролики роликов урок урока уроки уроку уроком уроков лекция лекции лекцию лекций про как что это для или на по из от".split(" "),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .replaceAll("ё", "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

/** Начало слова, по которому сравниваем: окончания падежей отбрасываются. */
const stem = (word: string) => (word.length > 5 ? word.slice(0, 5) : word.length >= 4 ? word.slice(0, -1) : word);

const weights = { title: 3, chapters: 2, description: 1 } as const;

function score(video: VideoEntry, queryStems: string[]): number {
  const fields = {
    title: words(video.title),
    chapters: (video.chapters ?? []).flatMap((chapter) => words(chapter.title)),
    description: words(video.description ?? ""),
  };
  let total = 0;
  for (const queryStem of queryStems) {
    for (const field of ["title", "chapters", "description"] as const) {
      if (fields[field].some((word) => word.startsWith(queryStem))) total += weights[field];
    }
  }
  return total;
}

/** До восьми подходящих: название весит больше глав, главы — больше описания; при равенстве — порядок каталога. */
export function searchVideos(videos: readonly VideoEntry[], query: string): VideoEntry[] {
  const all = words(query);
  const meaningful = all.filter((word) => !serviceWords.has(word));
  const queryStems = [...new Set((meaningful.length > 0 ? meaningful : all).map(stem))];
  if (queryStems.length === 0) return [];
  return videos
    .map((video, index) => ({ video, index, score: score(video, queryStems) }))
    .filter((found) => found.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_FOUND)
    .map((found) => found.video);
}
