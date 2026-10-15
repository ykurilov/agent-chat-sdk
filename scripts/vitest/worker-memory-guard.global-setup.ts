import { startWorkerMemoryGuard } from "./worker-memory-guard";

/** Порог памяти одного воркера тестов вместе с его потомками, МБ. */
const WORKER_RSS_LIMIT_MB = Number(process.env.AGENT_CHAT_TEST_WORKER_RSS_MB) || 4096;

/** Один сторож на весь прогон, сколько бы проектов его ни подключили (каждый проект грузит этот файл заново). */
const running = globalThis as { agentChatWorkerMemoryGuard?: () => void };

export default function guardWorkerMemory(): () => void {
  if (running.agentChatWorkerMemoryGuard) return () => {};
  const stop = startWorkerMemoryGuard({ rootPid: process.pid, limitMb: WORKER_RSS_LIMIT_MB, intervalMs: 500 });
  running.agentChatWorkerMemoryGuard = stop;
  return () => {
    stop();
    delete running.agentChatWorkerMemoryGuard;
  };
}
