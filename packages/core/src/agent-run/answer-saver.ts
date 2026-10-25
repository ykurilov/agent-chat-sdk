import { readUIMessageStream } from "ai";
import type { UIMessageChunk } from "ai";
import type { AgentChatMessage, TokenUsage } from "../conversation/types";
import { ChatTurnLeaseLostError, MessageAlreadyFinishedError } from "../storage/chat-storage";
import type { ChatStorage } from "../storage/chat-storage";
import { ANSWER_ALIVE_EVERY_MS } from "./answer-liveness";

/** Как часто идущий ответ пишется в хранилище. При падении сервера теряется не больше этого времени. */
export const SAVE_INTERVAL_MS = 500;

/**
 * Итог вызова инструмента пишется сразу, без окна: дело инструмента сделано, и его итог не должен потеряться.
 * Промежуточные результаты (`preliminary`) идут обычным окном: их бывает много подряд.
 */
const isFinalToolResult = (chunk: UIMessageChunk): boolean =>
  chunk.type === "tool-output-error" || (chunk.type === "tool-output-available" && !chunk.preliminary);

/** Только вызовы с полным вводом: сохранённый input-streaming ещё не разрешает действие. */
const callIdsOf = (parts: AgentChatMessage["parts"]): string[] =>
  parts.flatMap((part) => ("toolCallId" in part && typeof part.toolCallId === "string" && "state" in part && typeof part.state === "string" && part.state !== "input-streaming" ? [part.toolCallId] : []));

export type AnswerSaver = ReturnType<typeof createAnswerSaver>;

/**
 * Собирает сообщение из кусков и пишет его в хранилище не чаще раза в `SAVE_INTERVAL_MS`
 * (отсчёт от начала хода): запись всего ответа на каждый кусок растёт квадратично. Остаток
 * дописывает `flush` (штатная остановка сервера) или конечная запись хода. Результат инструмента — запись сразу: записи
 * состояния, сделанные инструментом до результата, уходят в ту же запись. Начатый вызов (`tool-input-available`) — тоже
 * запись сразу: инструмент ждёт её (`whenCallSaved`), и упади сервер посреди инструмента, вызов в базе. Каждая запись несёт знак жизни, а в тишине
 * дольше `ANSWER_ALIVE_EVERY_MS` ставится лёгкая отметка (FR-060); после `finish` и `stop` знаков нет.
 */
export function createAnswerSaver(
  storage: ChatStorage,
  messageId: string,
  durations: () => Record<string, number>,
  /** Расход сообщения на этот момент: идёт с каждой записью. */
  usage: () => TokenUsage | null,
  /** Запись узнала, что ответ уже закрыт другой копией сервера: записей больше нет, ход должен остановиться. */
  onTakenOver: () => void,
  /** Продолжение: сообщение, к которому дописываются куски. */
  existing?: AgentChatMessage,
  /** Правка частей перед каждой записью (заголовки раздумий); сборка из кусков её не видит. */
  decorateParts: (parts: AgentChatMessage["parts"]) => AgentChatMessage["parts"] = (parts) => parts,
) {
  let feed!: ReadableStreamDefaultController<UIMessageChunk>;
  let latest: AgentChatMessage["parts"] = existing?.parts ?? [];
  let latestMessage: AgentChatMessage | undefined = existing;
  // Пока сборка перезапускается (`rewind`), куски ждут здесь: старый поток закрыт, новый ещё не открыт.
  let waiting: UIMessageChunk[] | null = null;
  // Идущее стирание: `flush` и `snapshot` ждут его, чтобы не записать и не отдать стёртое.
  let rewinding: Promise<void> | null = null;
  // Номер текущей сборки: сборка, закрытая стиранием, чужие метки не отпускает.
  let assemblies = 0;
  let lastWriteAt = Date.now();
  // Последний знак жизни: любая запись или лёгкая отметка.
  let lastSignAt = lastWriteAt;
  let unsaved = false;
  // Номер изменения ответа и номер, который уже ушёл в запись: «записать сейчас» пишет до известного ему номера.
  let changes = 0;
  let savedChanges = 0;
  let closed = false;
  let writing: Promise<void> | null = null;
  let lastFence = 0;
  let reachedFence = 0;
  const fenceWaiters = new Map<number, () => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aliveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Сервер останавливается (`flush`): знаков жизни больше нет, записи помечают ответ брошенным. */
  let released = false;
  // Вызовы, уже отправленные в хранилище, и кто ждёт записи своего вызова.
  const writtenCalls = new Set(callIdsOf(latest));
  const callWaiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>();
  const failedCalls = new Map<string, Error>();
  const callNotSaved = () => new Error("Действие не выполнено: вызов инструмента не записан в хранилище");

  /** Только подтверждённая запись открывает выполнение инструмента. */
  function callsWritten(ids: readonly string[]): void {
    for (const id of ids) {
      writtenCalls.add(id);
      for (const waiter of callWaiters.get(id) ?? []) waiter.resolve();
      callWaiters.delete(id);
    }
  }

  function callsFailed(ids: readonly string[]): void {
    for (const id of ids) {
      if (writtenCalls.has(id)) continue;
      const error = failedCalls.get(id) ?? callNotSaved();
      failedCalls.set(id, error);
      for (const waiter of callWaiters.get(id) ?? []) waiter.reject(error);
      callWaiters.delete(id);
    }
  }

  async function write(): Promise<void> {
    unsaved = false;
    const writtenChanges = changes;
    lastWriteAt = Date.now();
    lastSignAt = lastWriteAt;
    const parts = decorateParts(latest);
    // Метки берутся до await: сборщик может за время записи дописать новые части или закончить аргументы.
    const completeCalls = callIdsOf(parts);
    try {
      await storage.updateStreamingMessage(messageId, {
        parts,
        reasoningDurationsMs: durations(),
        usage: usage(),
        alive: released ? "released" : "now",
      });
      callsWritten(completeCalls);
    } catch (failure) {
      callsFailed(completeCalls);
      noteFailure(failure);
    }
    // Попытка записи завершена; сбой не открывает вызовы. Следующее изменение и конечная запись повторят снимок.
    savedChanges = Math.max(savedChanges, writtenChanges);
  }

  /** Знак жизни без записи всего ответа: в тишине ответ не меняется. */
  async function markAlive(): Promise<void> {
    lastSignAt = Date.now();
    try {
      await storage.markAnswerAlive!(messageId);
    } catch (failure) {
      noteFailure(failure);
    }
  }

  function noteFailure(failure: unknown): void {
    // Ответ закрыла другая копия, сочтя брошенным: писать больше некуда (FR-060).
    if ((failure instanceof MessageAlreadyFinishedError || failure instanceof ChatTurnLeaseLostError)) {
      stop();
      onTakenOver();
    }
    // Остальные сбои: следующая или конечная запись запишет всё.
  }

  function stop(): void {
    closed = true;
    for (const waiters of callWaiters.values()) for (const waiter of waiters) waiter.reject(callNotSaved());
    callWaiters.clear();
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(aliveTimer);
    aliveTimer = undefined;
  }

  function startWrite(job: () => Promise<void> = write): void {
    writing = job().then(() => {
      writing = null;
      scheduleWrite();
      scheduleAlive();
    });
  }

  /**
   * Знак жизни в тишине, если знаков не было `ANSWER_ALIVE_EVERY_MS`: лёгкая отметка `markAnswerAlive`, а если её у
   * хранилища нет или есть несохранённое — обычная запись.
   */
  function scheduleAlive(): void {
    clearTimeout(aliveTimer);
    if (closed || released) return;
    aliveTimer = setTimeout(() => {
      aliveTimer = undefined;
      if (closed || released) return;
      // Запись идёт (может и висеть): по её концу `startWrite` сам заведёт таймер знака заново.
      if (writing) return;
      startWrite(unsaved || !storage.markAnswerAlive ? write : markAlive);
    }, lastSignAt + ANSWER_ALIVE_EVERY_MS - Date.now());
  }
  scheduleAlive();

  function scheduleWrite(): void {
    if (!unsaved || closed || writing || timer) return;
    const waitMs = lastWriteAt + SAVE_INTERVAL_MS - Date.now();
    if (waitMs <= 0) return startWrite();
    timer = setTimeout(() => {
      timer = undefined;
      scheduleWrite();
    }, waitMs);
  }

  /** Метка в потоке: когда сборка дошла до неё, все поданные раньше куски уже учтены в `latest`. */
  function reachFence(id: number): void {
    for (const [waitingId, release] of fenceWaiters) {
      if (waitingId > id) continue;
      fenceWaiters.delete(waitingId);
      release();
    }
  }

  /** Сборка сообщения из кусков, начиная с `base`. Сборщик дописывает части прямо в него: ему идёт копия. */
  function assemble(base: AgentChatMessage | undefined): Promise<void> {
    const assembly = ++assemblies;
    const chunks = new ReadableStream<UIMessageChunk>({
      start(controller) {
        feed = controller;
      },
    });
    return (async () => {
    try {
      for await (const message of readUIMessageStream<AgentChatMessage>({ stream: chunks, ...(base && { message: structuredClone(base) }), onError: () => {} })) {
        latestMessage = message;
        latest = message.parts;
        // Метаданные сливаются между обновлениями: метка остаётся в сообщении и после того, как её прошли.
        const fence = (message.metadata as { saverFence?: number } | undefined)?.saverFence ?? 0;
        if (fence > reachedFence) {
          reachedFence = fence;
          reachFence(fence);
        } else {
          noteChange();
          scheduleWrite();
        }
      }
    } finally {
      // Поток кончился: ждущие метки отпускаются. Кроме сборки, закрытой стиранием, — её метки дойдут до новой.
      if (assembly === assemblies) reachFence(Infinity);
    }
    })();
  }
  let assembling = assemble(existing);

  function push(chunk: UIMessageChunk): void {
    if (waiting) waiting.push(chunk);
    else feed.enqueue(chunk);
  }

  /** Ответ изменился: его надо записать. */
  function noteChange(): void {
    changes++;
    unsaved = true;
  }

  /**
   * Пишет сейчас, не дожидаясь окна записи, всё, что собрано к вызову; идущую запись сначала ждёт. Куски, пришедшие
   * во время записи, идут обычным окном: иначе поток промежуточных результатов писался бы на каждый кусок.
   */
  async function writeNow(): Promise<void> {
    const target = changes;
    for (;;) {
      clearTimeout(timer);
      timer = undefined;
      if (writing) await writing;
      else if (savedChanges < target && !closed) startWrite();
      else return scheduleWrite();
    }
  }

  /** Ждёт, пока сборка обработает всё, что уже подано через `observe`. */
  async function settleAssembly(): Promise<void> {
    if (closed) return;
    const id = ++lastFence;
    const reached = new Promise<void>((resolve) => fenceWaiters.set(id, resolve));
    push({ type: "message-metadata", messageMetadata: { saverFence: id } });
    await reached;
  }

  return {
    observe(chunk: UIMessageChunk): void {
      push(chunk);
      if ((isFinalToolResult(chunk) || chunk.type === "tool-input-available") && !closed) void settleAssembly().then(writeNow);
    },
    /** Ждёт подтверждённую запись; сбой или остановка до неё — отказ, включая позднего ожидающего. */
    whenCallSaved(toolCallId: string): Promise<void> {
      const failure = failedCalls.get(toolCallId);
      if (failure) return Promise.reject(failure);
      if (writtenCalls.has(toolCallId)) return Promise.resolve();
      if (closed) return Promise.reject(callNotSaved());
      return new Promise<void>((resolve, reject) => callWaiters.set(toolCallId, [...(callWaiters.get(toolCallId) ?? []), { resolve, reject }]));
    },
    /**
     * Стирает части ответа с номера `keep`: сборка начинается заново с оставшихся, запись — сразу, без окна: упади
     * сервер следом, в базе стёртого нет. Возвращает оставшиеся части.
     */
    async rewind(keep: number): Promise<AgentChatMessage["parts"]> {
      const erase = async () => {
        await settleAssembly();
        if (closed || !latestMessage || keep >= latest.length) return;
        waiting = [];
        feed.close();
        await assembling.catch(() => {});
        latest = latest.slice(0, keep);
        latestMessage = { ...latestMessage, parts: latest };
        assembling = assemble(latestMessage);
        const held = waiting;
        waiting = null;
        for (const chunk of held) feed.enqueue(chunk);
        noteChange();
        await writeNow();
      };
      const current = erase().finally(() => {
        if (rewinding === current) rewinding = null;
      });
      rewinding = current;
      await current;
      return latest;
    },
    /**
     * Штатная остановка сервера: пишет всё несохранённое сейчас, не дожидаясь окна, и помечает ответ брошенным —
     * следующий старт прервёт его сразу, без ожидания порога (FR-060).
     */
    async flush(): Promise<void> {
      released = true;
      clearTimeout(aliveTimer);
      await rewinding?.catch(() => {});
      noteChange();
      await settleAssembly();
      await writeNow();
    },
    /** Части ответа со всеми уже поданными кусками: с них продолжает следующая попытка. */
    async snapshot(): Promise<AgentChatMessage["parts"]> {
      await rewinding?.catch(() => {});
      await settleAssembly();
      return latest;
    },
    /** Ждёт сборку и идущую запись; возвращает итоговые части — их запишет конечная запись хода. */
    async finish(lostOwnership?: AbortSignal): Promise<AgentChatMessage["parts"]> {
      stop();
      feed.close();
      await assembling.catch(() => {});
      // Обычная остановка ждёт запись. Утративший аренду ход не держит завершение на зависшей БД:
      // позднюю запись всё равно проверяет атомарная ограда хранилища.
      if (writing && lostOwnership) {
        const pending = writing;
        await new Promise<void>((resolve, reject) => {
          const done = () => { lostOwnership.removeEventListener("abort", done); resolve(); };
          if (lostOwnership.aborted) return done();
          lostOwnership.addEventListener("abort", done, { once: true });
          pending.then(done, (error: unknown) => { lostOwnership.removeEventListener("abort", done); reject(error); });
        });
      } else await writing;
      return latest;
    },
    /** Ход кончился, в том числе исключением: таймеров записи и знака жизни больше нет. */
    stop,
  };
}
