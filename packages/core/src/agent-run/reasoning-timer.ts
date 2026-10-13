import type { UIMessageChunk } from "ai";

export interface ReasoningTimer {
  /** Смотрит на кусок ответа; `true`, если длительности изменились. */
  observe(chunk: UIMessageChunk): boolean;
  /** Длительности законченных рассуждений по порядковому номеру части в сообщении. */
  durations(): Record<string, number>;
  /** Закрывает незаконченные рассуждения текущим временем. */
  finalize(): Record<string, number>;
  /** Шаг стёрт: в сообщении осталось `count` рассуждений, длительности и незаконченные после них забываются. */
  rewind(count: number): void;
}

/**
 * Время каждого рассуждения. Ключ — порядковый номер части рассуждения в сообщении («0», «1»…):
 * провайдеры дают id `reasoning-0` на каждом шаге, так что id не уникален в пределах хода.
 */
export function createReasoningTimer(
  now: () => number = Date.now,
  /** Продолжение ответа: рассуждения, которые в сообщении уже есть, и их длительности. */
  previous: { count: number; durations: Record<string, number> } = { count: 0, durations: {} },
): ReasoningTimer {
  const finished: Record<string, number> = { ...previous.durations };
  const open = new Map<string, { key: string; startedAt: number }>();
  let count = previous.count;

  return {
    observe(chunk) {
      if (chunk.type === "reasoning-start") {
        open.set(chunk.id, { key: String(count++), startedAt: now() });
        return false;
      }
      if (chunk.type === "reasoning-end") {
        const started = open.get(chunk.id);
        if (!started) return false;
        open.delete(chunk.id);
        finished[started.key] = now() - started.startedAt;
        return true;
      }
      return false;
    },
    durations: () => ({ ...finished }),
    finalize() {
      const at = now();
      for (const started of open.values()) finished[started.key] = at - started.startedAt;
      open.clear();
      return { ...finished };
    },
    rewind(kept) {
      for (const key of Object.keys(finished)) if (Number(key) >= kept) delete finished[key];
      open.clear();
      count = kept;
    },
  };
}
