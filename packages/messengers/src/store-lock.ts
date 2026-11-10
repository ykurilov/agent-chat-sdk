import { randomUUID } from "node:crypto";
import type { MessengerStore } from "./types";

const POLL_MS = 50;

/**
 * Работа, которую из всех копий сервера делает одна за раз: замок — аренда в общем хранилище. Остальные ждут; копия
 * упала, не сняв замок, — он сам истекает через `leaseMs`.
 */
export async function withStoreLock<T>(store: Pick<MessengerStore, "acquireLease" | "releaseLease">, name: string, leaseMs: number, work: () => Promise<T>, logError?: (error: unknown) => void): Promise<T> {
  const holder = randomUUID();
  for (;;) {
    const now = Date.now();
    if (await store.acquireLease(name, holder, new Date(now + leaseMs).toISOString(), new Date(now).toISOString())) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  try {
    return await work();
  } finally {
    await store.releaseLease(name, holder).catch((error: unknown) => logError?.(error));
  }
}
