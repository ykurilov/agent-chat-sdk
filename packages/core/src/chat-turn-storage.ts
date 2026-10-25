import {ChatTurnLeaseLostError} from "./storage/chat-storage";
import type {ChatStorage} from "./storage/chat-storage";

/** Права захвачены этим запуском, а не ищутся заново у позднего callback следующего хода. */
export function guardedTurnStorage(storage: ChatStorage, input: {holder: string; signal: AbortSignal; onLost: () => void}): ChatStorage {
  const guard = {expectedTurnHolder: input.holder};
  const check = (messageId: string) => { if (input.signal.aborted) throw new ChatTurnLeaseLostError(messageId); };
  async function writing(messageId: string, work: () => Promise<void>, committedFinal = false): Promise<void> {
    check(messageId);
    try {
      await work();
      if (!committedFinal) check(messageId);
    } catch (error) {
      if (error instanceof ChatTurnLeaseLostError) input.onLost();
      throw error;
    }
  }
  const guarded: Partial<ChatStorage> = {
    insertMessage: (message) => writing(message.id, () => storage.insertMessage(message, guard)),
    updateStreamingMessage: (id, patch) => writing(id, () => storage.updateStreamingMessage(id, {...patch, ...guard})),
    finishMessage: (id, patch) => writing(id, () => storage.finishMessage(id, {...patch, ...guard}), true),
    updateAwaitingMessage: (id, patch) => writing(id, () => storage.updateAwaitingMessage(id, {...patch, ...guard})),
    ...(storage.markAnswerAlive && {markAnswerAlive: (id: string) => writing(id, () => storage.markAnswerAlive!(id, guard))}),
  };
  return new Proxy(storage, {
    get(target, key) {
      if (Object.hasOwn(guarded, key)) return Reflect.get(guarded, key);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
