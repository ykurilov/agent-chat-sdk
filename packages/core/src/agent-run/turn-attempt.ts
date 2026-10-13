import type { UIMessageChunk } from "ai";
import type { ChatErrorKind } from "../conversation/types";

/** Итог одной попытки хода. `contentSeen` — был ли содержательный кусок от модели с начала хода, а не попытки. */
export type AttemptResult =
  | { outcome: "ok" }
  | { outcome: "aborted" }
  | { outcome: "failed"; kind: ChatErrorKind; error: unknown; contentSeen: boolean };

export interface TurnAttemptInput {
  /** Открывает UI-поток попытки. `onError` идёт в `toUIMessageStream`: запоминает сырую ошибку и отдаёт текст куска. */
  open(onError: (error: unknown) => string): ReadableStream<UIMessageChunk>;
  /** Текст куска `error` или `tool-output-error` для сырой ошибки; у ошибки провайдера — только вид. */
  describeError(error: unknown): string;
  classify(error: unknown): ChatErrorKind;
  abortSignal: AbortSignal;
  /** Содержательный кусок уже был в этом ходе (в прежней попытке). */
  contentSeen: boolean;
  /** Кусок, который можно отдать клиенту и записать. */
  emit(chunk: UIMessageChunk): void;
}

export interface TurnAttempt {
  result: AttemptResult;
  /** Куски `error` попытки (у оборванного броском потока — один, с видом ошибки): ход отдаёт их после итога. */
  errors: UIMessageChunk[];
  /** Куски `finish` и `abort` попытки: ход отдаёт их последними. */
  terminal: UIMessageChunk[];
}

/** Служебные куски: пока модель ничего не написала, они придерживаются — упавшая попытка не оставит следа. */
const SERVICE_CHUNKS = new Set<UIMessageChunk["type"]>(["start", "start-step"]);

/** Содержательный кусок — то, что написала модель: текст, рассуждение, вызов, источник, файл или `data-*`. */
function isContent(chunk: UIMessageChunk): boolean {
  return (
    chunk.type.startsWith("text-") ||
    chunk.type.startsWith("reasoning-") ||
    chunk.type.startsWith("tool-input-") ||
    chunk.type === "tool-approval-request" ||
    chunk.type.startsWith("source-") ||
    chunk.type === "file" ||
    chunk.type.startsWith("data-")
  );
}

/**
 * Одна попытка хода: читает UI-поток и отдаёт куски дальше. `start` и `start-step` придерживаются до первого
 * содержательного куска: если попытка упала раньше, клиент и запись её не видят, и ход может пойти к запасному
 * провайдеру. Прочие куски (например, результат подтверждённого инструмента до запроса к модели) отдаются сразу вместе
 * с придержанными, но содержательными не считаются. «Стоп» обрывает чтение сразу, не дожидаясь модели.
 */
export async function runTurnAttempt(input: TurnAttemptInput): Promise<TurnAttempt> {
  let rawError: unknown;
  const stream = input.open((error) => {
    rawError = error;
    return input.describeError(error);
  });
  const errors: UIMessageChunk[] = [];
  const terminal: UIMessageChunk[] = [];
  let held: UIMessageChunk[] = [];
  let contentSeen = input.contentSeen;
  const release = () => {
    for (const chunk of held) input.emit(chunk);
    held = [];
  };

  const reader = stream.getReader();
  const stopReading = () => void reader.cancel().catch(() => {});
  if (input.abortSignal.aborted) stopReading();
  input.abortSignal.addEventListener("abort", stopReading, { once: true });
  let failure: { error: unknown } | undefined;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const chunk = read.value;
      if (chunk.type === "finish" || chunk.type === "abort") {
        terminal.push(chunk);
        continue;
      }
      if (chunk.type === "error") {
        errors.push(chunk);
        failure ??= { error: rawError };
        continue;
      }
      if (!contentSeen && SERVICE_CHUNKS.has(chunk.type)) {
        held.push(chunk);
        continue;
      }
      if (isContent(chunk)) contentSeen = true;
      release();
      input.emit(chunk);
    }
  } catch (error) {
    // Поток оборвался броском, а не куском `error`: кусок для клиента — по виду ошибки.
    if (!failure && !input.abortSignal.aborted) errors.push({ type: "error", errorText: input.classify(error) });
    failure ??= { error };
  } finally {
    input.abortSignal.removeEventListener("abort", stopReading);
  }

  if (input.abortSignal.aborted) return { result: { outcome: "aborted" }, errors, terminal };
  if (failure) {
    return { result: { outcome: "failed", kind: input.classify(failure.error), error: failure.error, contentSeen }, errors, terminal };
  }
  release();
  return { result: { outcome: "ok" }, errors, terminal };
}
