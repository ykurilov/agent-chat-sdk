import type { UIMessageChunk } from "ai";

export class ChatBusyError extends Error {
  constructor(chatId: string) {
    super(`В чате ${chatId} уже идёт ответ`);
    this.name = "ChatBusyError";
  }
}

export interface RunningAnswerRegistry {
  /** Запускает ход. Реестр сам дочитывает поток до конца, даже без слушателей. */
  start(
    chatId: string,
    messageId: string,
    produce: (signal: AbortSignal) => ReadableStream<UIMessageChunk>,
  ): { finished: Promise<void> };
  /** Поток с начала хода: все прошлые куски, затем новые. `null`, если хода нет. */
  subscribe(chatId: string): ReadableStream<UIMessageChunk> | null;
  /** Останавливает ход. `false`, если хода нет. */
  abort(chatId: string): boolean;
  /** Готов, когда ход чата дочитан до конца и убран из реестра; хода нет — готов сразу. */
  finished(chatId: string): Promise<void>;
  isRunning(chatId: string): boolean;
  runningMessageId(chatId: string): string | null;
}

interface RunningAnswer {
  messageId: string;
  chunks: UIMessageChunk[];
  listeners: Set<ReadableStreamDefaultController<UIMessageChunk>>;
  controller: AbortController;
  finished: Promise<void>;
}

/** Идущие ответы в памяти процесса. Буфер и рассылка — в одном месте, поэтому без повторов и пропусков. */
export function createRunningAnswerRegistry(): RunningAnswerRegistry {
  const running = new Map<string, RunningAnswer>();

  async function pump(chatId: string, answer: RunningAnswer, stream: ReadableStream<UIMessageChunk>): Promise<void> {
    try {
      for await (const chunk of stream) {
        answer.chunks.push(chunk);
        for (const listener of answer.listeners) listener.enqueue(chunk);
      }
    } catch {
      // Ход сам записывает ошибку в хранилище; слушателям достаточно конца потока.
    } finally {
      running.delete(chatId);
      for (const listener of answer.listeners) listener.close();
      answer.listeners.clear();
    }
  }

  return {
    start(chatId, messageId, produce) {
      if (running.has(chatId)) throw new ChatBusyError(chatId);
      const answer: RunningAnswer = {
        messageId,
        chunks: [],
        listeners: new Set(),
        controller: new AbortController(),
        finished: Promise.resolve(),
      };
      running.set(chatId, answer);
      let stream: ReadableStream<UIMessageChunk>;
      try {
        stream = produce(answer.controller.signal);
      } catch (error) {
        running.delete(chatId);
        throw error;
      }
      answer.finished = pump(chatId, answer, stream);
      return { finished: answer.finished };
    },

    subscribe(chatId) {
      const answer = running.get(chatId);
      if (!answer) return null;
      let own: ReadableStreamDefaultController<UIMessageChunk>;
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          own = controller;
          for (const chunk of answer.chunks) controller.enqueue(chunk);
          answer.listeners.add(controller);
        },
        cancel() {
          answer.listeners.delete(own);
        },
      });
    },

    abort(chatId) {
      const answer = running.get(chatId);
      if (!answer) return false;
      answer.controller.abort();
      return true;
    },

    finished: (chatId) => running.get(chatId)?.finished ?? Promise.resolve(),
    isRunning: (chatId) => running.has(chatId),
    runningMessageId: (chatId) => running.get(chatId)?.messageId ?? null,
  };
}
