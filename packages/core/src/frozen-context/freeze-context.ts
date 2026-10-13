import { isHiddenBlock, isMemoryKey, isReservedKey, SCREEN_PLACE_KEY, TODAY_KEY } from "./context-blocks";
import type { ContextBlock, ContextBlockEntry, FrozenContextData } from "./context-blocks";

/**
 * Откуда берутся блоки хода. Источник не задан — его блоки из базы без изменений (групповой ход не читает память;
 * память, уже прочитанная при том же начале истории, тоже не читается — см. `memoryFrom`).
 * Источник бросил — тоже из базы, строка в журнал: сбой не стирает знание модели. `null` — блоков нет.
 */
export interface FrozenContextSources {
  memory?: () => Promise<readonly ContextBlockEntry[] | null>;
  today: string;
  app?: () => Promise<readonly ContextBlockEntry[] | null | undefined>;
  place?: string | null;
}

type SourceName = "memory" | "app";

const sourceOf = (key: string): SourceName | "core" => (isMemoryKey(key) ? "memory" : isReservedKey(key) ? "core" : "app");

/**
 * Блоки хода один раз в начале: полный набор (память, дата, блоки приложения, место) и что из него уйдёт модели против
 * базового ответа. Набор дальше не меняется ни на байт: продолжения и запасные провайдеры берут его из части ответа.
 */
export async function freezeContext(input: {
  chatId: string;
  sources: FrozenContextSources;
  /**
   * Начало видимой истории. База прочитала память при том же начале — память из базы, источник не зовётся: в идущем
   * чате память не перечитывается и не досылается. Нет — память читается каждый ход.
   */
  memoryFrom?: string;
  base: { id: string; data: FrozenContextData } | null;
  logError?: (message: string) => void;
  /** «Стоп»: источник, прерванный им, не считается сбоем — блоки из базы, строки в журнале нет. */
  signal?: AbortSignal;
}): Promise<FrozenContextData> {
  const { chatId, sources, base, signal, memoryFrom } = input;
  const log = input.logError ?? console.error;
  const fromBase = (source: SourceName) => base?.data.blocks.filter((block) => sourceOf(block.key) === source) ?? [];
  // `fresh` — блоки из источника, а не из базы.
  const read = async (source: SourceName, fetch: (() => Promise<readonly ContextBlockEntry[] | null | undefined>) | undefined): Promise<{ blocks: readonly ContextBlockEntry[]; fresh: boolean }> => {
    if (!fetch) return { blocks: fromBase(source), fresh: false };
    try {
      const blocks = await fetch();
      if (blocks !== null && blocks !== undefined && !Array.isArray(blocks)) throw new TypeError(`ждём список блоков, а пришло ${typeof blocks}`);
      return { blocks: blocks ?? [], fresh: true };
    } catch (error) {
      if (!signal?.aborted) log(`[блоки контекста] чат=${chatId} источник=${source} сбой: ${error instanceof Error ? error.message : "неизвестная ошибка"}; блоки из прошлого хода`);
      return { blocks: fromBase(source), fresh: false };
    }
  };
  const memoryKept = memoryFrom !== undefined && base?.data.memoryFrom === memoryFrom;
  const [memoryRead, appRead] = await Promise.all([read("memory", memoryKept ? undefined : sources.memory), read("app", sources.app)]);
  const memory = memoryRead.blocks;
  const app = appRead.blocks;
  const memoryMark = memoryFrom !== undefined && (memoryKept || memoryRead.fresh) ? { memoryFrom } : {};
  const accepted = new Set<string>();
  const hidden = new Set<string>();
  // Скрытый ради места — только помечается: в набор не входит, против базы это не «удалён».
  const accept = (block: ContextBlockEntry, source: SourceName): block is ContextBlock => {
    if (typeof block !== "object" || block === null || typeof block.key !== "string") {
      log(`[блоки контекста] чат=${chatId} источник=${source} блок отброшен: не блок (ждём объект с ключом и текстом)`);
      return false;
    }
    const isHidden = isHiddenBlock(block);
    const reason =
      !isHidden && (typeof block.text !== "string" || block.text.length === 0)
        ? "пустой текст"
        : accepted.has(block.key)
          ? "повтор ключа"
          : source === "app" && isReservedKey(block.key)
            ? "ключ занят ядром"
            : source === "memory" && !isMemoryKey(block.key)
              ? "ключ не памяти"
              : undefined;
    if (reason) {
      log(`[блоки контекста] чат=${chatId} источник=${source} ключ=«${block.key}» отброшен: ${reason}`);
      return false;
    }
    accepted.add(block.key);
    if (isHidden) hidden.add(block.key);
    return !isHidden;
  };
  const blocks: ContextBlock[] = [
    ...memory.filter((block) => accept(block, "memory")).map((block) => ({ key: block.key, text: block.text, private: true })),
    { key: TODAY_KEY, text: sources.today },
  ];
  accepted.add(TODAY_KEY);
  accepted.add(SCREEN_PLACE_KEY);
  blocks.push(...app.filter((block) => accept(block, "app")).map(copyBlock));
  if (sources.place) blocks.push({ key: SCREEN_PLACE_KEY, text: sources.place });
  if (!base) return { blocks, sent: "all", base: null, ...memoryMark };
  const before = new Map(base.data.blocks.map((block) => [block.key, block.text]));
  const keys = new Set(blocks.map((block) => block.key));
  const gone = base.data.blocks.filter((block) => !keys.has(block.key)).map((block) => block.key);
  const hiddenNow = gone.filter((key) => hidden.has(key));
  return {
    blocks,
    sent: {
      changed: blocks.filter((block) => before.get(block.key) !== block.text).map((block) => block.key),
      removed: gone.filter((key) => !hidden.has(key)),
      ...(hiddenNow.length > 0 && { hidden: hiddenNow }),
    },
    base: base.id,
    ...memoryMark,
  };
}

function copyBlock(block: ContextBlock): ContextBlock {
  return { key: block.key, text: block.text, ...(block.private && { private: true }) };
}
