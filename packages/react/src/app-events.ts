import { useEffect, useMemo, useRef } from "react";
import type { ComponentType } from "react";
import type { AgentChatMessage } from "./chat-types";

/** Событие приложения в ответе агента. Форма совпадает с `AppEvent` из `@ykurilov/agent-chat-core`: ядро браузеру не нужно. */
export interface AppEvent {
  type: string;
  data?: unknown;
}

/** Где и когда событие пришло: `live` — живьём (поток ответа или канал наблюдения), а не из истории. */
export interface AppEventInfo {
  live: boolean;
  /** Ответ агента с событием; у события вне хода (`publishAppEvent`) его нет. */
  messageId?: string;
}

/**
 * Свой вид событий приложения внутри ответа: тип события → компонент («урок зачтён» — плашка). Рисуется прямо в теле
 * ответа, там, где лежит часть события, как виджеты: отдельного слота скина нет. Тип без компонента не виден.
 */
export type AppEventViews = Record<string, ComponentType<{ event: AppEvent; messageId: string }>>;

export type AppEventHandler = (event: AppEvent, info: AppEventInfo) => void;

const APP_EVENT_PART_TYPE = "data-app-event";
/** Начало `id` у события, скопированного из прежнего ответа («Повторить»): оно уже сработало там, живым не считается. */
const COPIED_APP_EVENT_ID_PREFIX = "copied:";

/** Событие из присланного сервером значения; не событие — `undefined`. */
export function appEventOf(value: unknown): AppEvent | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { type } = value as { type?: unknown };
  return typeof type === "string" ? (value as AppEvent) : undefined;
}

/** Событие из части ответа; часть не событие или битая — `undefined`. */
export function appEventOfPart(part: AgentChatMessage["parts"][number]): AppEvent | undefined {
  return part.type === APP_EVENT_PART_TYPE ? appEventOf((part as { data?: unknown }).data) : undefined;
}

/** Учёт событий в ответах ленты. */
export interface AppEventReport {
  /** Новые события ответа `messageId` придут живьём, с перечитанной историей (хук итога, доделанный после «Стопа»). */
  expectLive(messageId: string): void;
}

/**
 * Зовёт `onAppEvent` по разу на каждое событие в ответах ленты. События, что лежали в истории при открытии чата или
 * пришли с перечитанной историей, когда чат свободен (смена ветки), — `live: false`; пришедшие, пока идёт ход, и
 * ожидаемые (`expectLive`) — `live: true`. Скопированные из прежнего ответа («Повторить», `id` вида `copied:…`) — всегда
 * `live: false`: они уже сработали там. Повторная загрузка тех же ответов событие второй раз не даёт; смена чата
 * начинает счёт заново (`AgentChat` к тому же пересоздаёт ленту на каждый чат).
 */
export function useAppEventReport(chatId: string, loaded: boolean, busy: boolean, messages: readonly AgentChatMessage[], onAppEvent: AppEventHandler | undefined, historical = false): AppEventReport {
  const report = useRef(onAppEvent);
  report.current = onAppEvent;
  const seen = useRef({ chatId, keys: new Set<string>(), initialized: false, liveAnswers: new Set<string>() });
  // События, что пришли в той же отрисовке, где чат освободился, — ещё ход: последние куски и конец потока сливаются.
  const wasBusy = useRef(busy);

  useEffect(() => {
    if (seen.current.chatId !== chatId) seen.current = { chatId, keys: new Set(), initialized: false, liveAnswers: new Set() };
    if (!loaded) return;
    const state = seen.current;
    const live = state.initialized && (busy || wasBusy.current);
    wasBusy.current = busy;
    state.initialized = true;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      message.parts.forEach((part, index) => {
        const event = appEventOfPart(part);
        if (!event) return;
        const key = `${message.id}:${index}`;
        if (state.keys.has(key)) return;
        state.keys.add(key);
        const partId = (part as { id?: unknown }).id;
        const copied = typeof partId === "string" && partId.startsWith(COPIED_APP_EVENT_ID_PREFIX);
        report.current?.(event, { live: !historical && !copied && (live || state.liveAnswers.has(message.id)), messageId: message.id });
      });
    }
  }, [busy, chatId, loaded, messages, historical]);

  return useMemo(() => ({ expectLive: (messageId: string) => void seen.current.liveAnswers.add(messageId) }), []);
}
