import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useChatLabels } from "../labels";

/** Как часто сменяется фраза ожидания. Таймер тикает раз в секунду, поэтому фраза держится 3–4 с. */
export const THINKING_PHRASE_MS = 3_500;
const TICK_MS = 1_000;

/** Номер следующей фразы: любой, кроме предыдущего. */
export function nextThinkingPhraseIndex(count: number, previous: number, random: () => number = Math.random): number {
  if (count <= 1) return 0;
  const shift = 1 + Math.min(count - 2, Math.floor(random() * (count - 1)));
  return (previous + shift) % count;
}

/** Часы одного ответа: когда началось ожидание и в каком порядке идут фразы. */
interface ThinkingClock {
  startedAt: number;
  phraseIndexAt: (step: number, count: number) => number;
}

function createThinkingClock(startedAt: number): ThinkingClock {
  let order: number[] = [0];
  let orderCount = 0;
  return {
    startedAt,
    phraseIndexAt(step, count) {
      if (count !== orderCount) {
        order = [0];
        orderCount = count;
      }
      while (order.length <= step) order.push(nextThinkingPhraseIndex(count, order[order.length - 1]!));
      return order[step]!;
    },
  };
}

const ThinkingClockContext = createContext<ThinkingClock | null>(null);
const ThinkingClocksContext = createContext<Map<string, ThinkingClock> | null>(null);

/** Часы всех ответов чата по id: лента выгружает ответ, ушедший из вида, а его счёт сохраняется. */
export function ThinkingClocksProvider({ children }: { children: ReactNode }) {
  const [clocks] = useState(() => new Map<string, ThinkingClock>());
  return <ThinkingClocksContext.Provider value={clocks}>{children}</ThinkingClocksContext.Provider>;
}

/**
 * Общие часы ожидания одного ответа: строка «думает» без текста и блок рассуждений после неё продолжают тот же счёт
 * и ту же череду фраз. `AgentChat` ставит его вокруг каждого ответа агента. С `id` внутри `ThinkingClocksProvider` часы
 * переживают перемонтирование; ответ дописан (`waiting: false`) — часы забываются.
 */
export function ThinkingClockProvider({ id, waiting = true, children }: { id?: string; waiting?: boolean; children: ReactNode }) {
  const clocks = useContext(ThinkingClocksContext);
  const [clock] = useState(() => {
    const kept = id === undefined ? undefined : clocks?.get(id);
    if (kept) return kept;
    const created = createThinkingClock(Date.now());
    if (id !== undefined && waiting) clocks?.set(id, created);
    return created;
  });

  useEffect(() => {
    if (id !== undefined && !waiting) clocks?.delete(id);
  }, [clocks, id, waiting]);

  return <ThinkingClockContext.Provider value={clock}>{children}</ThinkingClockContext.Provider>;
}

export interface ThinkingStatus {
  /** Текущая фраза: из `labels.thinkingPhrases`, пустой набор — `labels.reasoningRunning`. */
  phrase: string;
  /** Секунды с начала ожидания ответа. */
  seconds: number;
  /** Те же секунды словами: «12 с», «1 мин 5 с» (`labels.thinkingElapsed`). */
  elapsed: string;
}

/**
 * Живая надпись, пока модель думает: фраза сменяется каждые 3–4 с без повтора подряд, рядом — время ожидания.
 * Неактивная (`active: false`) таймер не держит. Скин рисует фразу и время сам; для экранного диктора — постоянная
 * `labels.reasoningRunning`, а меняющиеся фразы от него скрыты, чтобы не зачитывались каждые три секунды.
 */
export function useThinkingStatus(active = true): ThinkingStatus {
  const labels = useChatLabels();
  const shared = useContext(ThinkingClockContext);
  const [own] = useState(() => createThinkingClock(Date.now()));
  const clock = shared ?? own;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  const elapsedMs = Math.max(0, now - clock.startedAt);
  const phrases = labels.thinkingPhrases.length > 0 ? labels.thinkingPhrases : [labels.reasoningRunning];
  const seconds = Math.floor(elapsedMs / 1000);
  return {
    phrase: phrases[clock.phraseIndexAt(Math.floor(elapsedMs / THINKING_PHRASE_MS), phrases.length)]!,
    seconds,
    elapsed: labels.thinkingElapsed(seconds),
  };
}
