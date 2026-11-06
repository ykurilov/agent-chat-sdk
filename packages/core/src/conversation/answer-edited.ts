import { callWithRetries } from "../app-state/state-changed";
import type { AnswerEditedHandler, AnswerEditedInput } from "./answer-edit-record";

/** A committed edit must not become an HTTP error because the app's journal is unavailable. */
export function createAnswerEdited(handler: AnswerEditedHandler | undefined, logError: (message: string, error?: unknown) => void) {
  const running = new Set<Promise<void>>();
  const queues = new Map<string, Promise<void>>();
  return {
    notify(input: AnswerEditedInput) {
      if (!handler) return;
      const captured = structuredClone(input);
      const work = (queues.get(input.chatId) ?? Promise.resolve()).then(async () => {
        const failure = await callWithRetries(handler, captured, 30_000, 3);
        if (failure) logError(`onAnswerEdited не отработал (чат ${input.chatId}, ответ ${input.messageId}): ${failure.reason}`, failure.error);
      }).catch(error => { logError(`onAnswerEdited: ${input.messageId}`, error); });
      queues.set(input.chatId, work);
      running.add(work);
      void work.finally(() => { running.delete(work); if (queues.get(input.chatId) === work) queues.delete(input.chatId); });
    },
    async drain() { while (running.size) await Promise.allSettled([...running]); },
  };
}
