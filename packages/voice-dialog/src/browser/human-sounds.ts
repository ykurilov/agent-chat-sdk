import { HUMAN_SOUND_KINDS } from "../protocol";
import type { HeardSound, HumanSoundKind } from "../protocol";

/** Звук старше этого к следующей фразе не клеится: человек уже говорит о другом. */
export const SOUND_MAX_AGE_MS = 30_000;
/**
 * Эхо: звук человека в микрофоне, пока играет кусок озвучки агента с таким же звуком, — звук агента из динамика.
 * Запас до начала куска — на неточный счёт озвученного; хвост после конца — на задержку микрофона и распознавания.
 * Дальше человек смеётся уже сам, в ответ агенту.
 */
export const ECHO_BEFORE_MS = 500;
export const ECHO_TAIL_MS = 600;
/** Отметки звуков агента старше этого забываются. */
const AGENT_MARK_TTL_MS = 60_000;
const MAX_PENDING = 50;

export interface HumanSounds {
  /** Звуки, которые сервер услышал в звуке человека. Мусор отбрасывается. */
  hear(sounds: readonly HeardSound[] | undefined): void;
  /**
   * Агент издаёт такие звуки (тег голоса, заполнитель) в куске озвучки, который играет от `from` до `until` (часы `now`):
   * такие же в микрофоне в это время — эхо, а не человек. Без `span` кусок — одна точка «сейчас».
   */
  noteAgentSounds(kinds: readonly HumanSoundKind[], span?: AgentSoundSpan): void;
  /** Забрать накопленное для следующего сообщения: без повторов, без старого и без эха. */
  take(): HumanSoundKind[];
  /** Отправка не вышла: забранное возвращается в начало. */
  restore(kinds: readonly HumanSoundKind[]): void;
  /** Режим выключен: забыть всё. */
  reset(): void;
}

export interface AgentSoundSpan {
  from: number;
  until: number;
}

interface Pending {
  kind: HumanSoundKind;
  startedAt: number;
  /** Возвращено после неудачной отправки: уже прошло проверку на эхо. */
  restored?: boolean;
}

const isKind = (value: unknown): value is HumanSoundKind => typeof value === "string" && (HUMAN_SOUND_KINDS as readonly string[]).includes(value);

/** Звуки человека, ждущие следующего сообщения; сами по себе ход модели не запускают. */
export function createHumanSounds(options: { now: () => number; echoTailMs?: number }): HumanSounds {
  const { now, echoTailMs = ECHO_TAIL_MS } = options;
  let pending: Pending[] = [];
  let agentMarks: Array<{ kind: HumanSoundKind; from: number; until: number }> = [];

  const isEcho = (sound: Pending) =>
    agentMarks.some((mark) => mark.kind === sound.kind && sound.startedAt >= mark.from - ECHO_BEFORE_MS && sound.startedAt <= mark.until + echoTailMs);

  return {
    hear(sounds) {
      if (!Array.isArray(sounds)) return;
      const at = now();
      for (const sound of sounds as unknown[]) {
        if (typeof sound !== "object" || sound === null) continue;
        const { kind, agoMs } = sound as { kind?: unknown; agoMs?: unknown };
        if (!isKind(kind) || typeof agoMs !== "number" || !Number.isFinite(agoMs)) continue;
        pending.push({ kind, startedAt: at - Math.max(0, agoMs) });
      }
      if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
    },

    noteAgentSounds(kinds, span) {
      const at = now();
      const { from, until } = span ?? { from: at, until: at };
      agentMarks = agentMarks.filter((mark) => at - mark.until <= AGENT_MARK_TTL_MS);
      for (const kind of kinds) agentMarks.push({ kind, from, until: Math.max(from, until) });
    },

    take() {
      const at = now();
      const kinds = new Set<HumanSoundKind>();
      for (const sound of pending) {
        if (at - sound.startedAt > SOUND_MAX_AGE_MS) continue;
        if (!sound.restored && isEcho(sound)) continue;
        kinds.add(sound.kind);
      }
      pending = [];
      return [...kinds];
    },

    restore(kinds) {
      if (kinds.length === 0) return;
      const at = now();
      pending = [...kinds.map((kind): Pending => ({ kind, startedAt: at, restored: true })), ...pending];
    },

    reset() {
      pending = [];
      agentMarks = [];
    },
  };
}
