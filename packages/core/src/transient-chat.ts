import type { ChatHistory } from "./chat-service";
/** SDK-internal capability; does not stop the turn or expose storage over HTTP. */
const checkpoints = new WeakMap<object, () => Promise<void>>();
export function registerTransientCheckpoint(service: object, checkpoint: () => Promise<void>): void {
  checkpoints.set(service, checkpoint);
}
export async function checkpointTransientChat(service: object): Promise<void> {
  const checkpoint = checkpoints.get(service);
  if (!checkpoint) throw new TypeError("Transient checkpoint is unavailable for this service");
  await checkpoint();
}

const histories = new WeakMap<object, (userId: string, chatId: string) => Promise<ChatHistory>>();
export function registerTransientHistory(service: object, history: (userId: string, chatId: string) => Promise<ChatHistory>): void { histories.set(service, history); }
/** Public visibility/capability projection including the checkpointed active answer. Server only. */
export async function getTransientChatHistory(service: object, userId: string, chatId: string): Promise<ChatHistory> {
  const history = histories.get(service);
  if (!history) throw new TypeError("Transient history is unavailable for this service");
  await checkpointTransientChat(service);
  return history(userId, chatId);
}
