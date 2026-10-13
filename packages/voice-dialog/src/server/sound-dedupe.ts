import type { HumanSoundKind } from "../protocol";

export interface SoundDedupeOptions {
  /** Звуки одного вида ближе друг к другу, чем на столько, — один звук (разрезан границей куска). */
  gapMs: number;
  /** Сколько последних звуков помнить. */
  remember?: number;
}

/** Помнит звуки, уже найденные в соседних кусках (время — от начала потока), и узнаёт повторы на перекрытии и на стыке. */
export interface SoundDedupe {
  /** `true` — звук новый и теперь запомнен; `false` — это тот же звук, что уже был найден. */
  isNew(kind: HumanSoundKind, startMs: number, endMs: number): boolean;
}

interface Known {
  kind: HumanSoundKind;
  startMs: number;
  endMs: number;
}

export function createSoundDedupe({ gapMs, remember = 64 }: SoundDedupeOptions): SoundDedupe {
  const known: Known[] = [];
  return {
    isNew(kind, startMs, endMs) {
      const same = known.find((item) => item.kind === kind && startMs <= item.endMs + gapMs && endMs >= item.startMs - gapMs);
      if (same) {
        // Граница звука растёт: цепочка из трёх кусков — по-прежнему один звук.
        same.startMs = Math.min(same.startMs, startMs);
        same.endMs = Math.max(same.endMs, endMs);
        return false;
      }
      known.push({ kind, startMs, endMs });
      if (known.length > remember) known.shift();
      return true;
    },
  };
}
