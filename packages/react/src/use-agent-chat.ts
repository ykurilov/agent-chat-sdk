import { closeStoppedToolCalls } from "./close-stopped-tool-calls";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { FileUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALWAYS_IN_CHAT, messageText } from "./chat-types";
import { VOICE_MODE_PART_TYPE } from "./voice-turn";
import type { AgentChatMessage, AnswerStatus, ApprovalDecision, ApprovalFailureKind, BranchFork, ChatModelChoice, CompactionMarker, VoiceCut, VoiceSound } from "./chat-types";
import { isConnectionError } from "./liveness/connection-errors";
import { DEFAULT_RECONNECT_DELAYS_MS, runReconnectAttempts } from "./liveness/reconnect-attempts";
import { watchChat } from "./chat-watch/chat-watch";
import { fetchWithDeadline } from "./liveness/request-deadline";
import { effectiveSilenceTimeoutMs } from "./liveness/silence-watchdog";
import { spendingInfoOf, spendingViewOf, untilResetCheckMs } from "./spending-status";
import type { SpendingInfo, SpendingView } from "./spending-status";
import { APP_CHANGE_PART_TYPE } from "./app-bridge/app-bridge";
import { BROWSER_CALL_PART_TYPE, runBrowserCall } from "./app-bridge/browser-calls";
import type { BrowserCallRequest } from "./app-bridge/browser-calls";
import type { AgentAppBridge, ScreenPlace } from "./app-bridge/app-bridge";
import { pause } from "./pause";
import { appRefusalOf } from "./app-refusal";
import type { AppRefusal } from "./app-refusal";
import { serverRefusalOf } from "./server-refusal";
import type { ServerRefusal } from "./server-refusal";
import { helperProgressOf, pendingHelperApprovalId } from "./helpers/helper-call";
import { useWidgetAnswer } from "./widgets/use-widget-answer";
import { appEventOf } from "./app-events";
import { ALL_CAPABILITIES, CHAT_CLOSED_PART_TYPE, capabilitiesOf, closureOf, sameCapabilities } from "./chat-access";
import type { ChatCapabilities, ChatClosure } from "./chat-access";
import { EXTERNAL_CONTENT_PART_TYPE } from "./live-demos/live-demo-document";
import type { AppEvent } from "./app-events";
import type { WidgetFailureKind } from "./widgets/use-widget-answer";
import { hasPendingApproval, withPendingWidgetsClosed, withWidgetAnswersSettled, withWidgetContinuationMarked } from "./widgets/widget-messages";
import { withoutResetMessages } from "./step-reset";
import { APP_STATE_PART_TYPE, chatStateOfEvent, foldChatState, publishChatState, sameChatState } from "./chat-state/chat-state";
import { AGENT_NOTICE_PART_TYPE } from "./notices/agent-notices";
import type { ChatStateValues } from "./chat-state/chat-state";
import { correctionMessage, correctionsAfterHistory, outgoingCorrection } from "./steering/corrections";

/** Настройки живой связи. Всё необязательно: по умолчанию сроки из договора 002. */
export interface LivenessOptions {
  /** Сколько тишины терпеть в потоке ответа. По умолчанию 30 000 мс. */
  silenceTimeoutMs?: number;
  /** Паузы перед попытками переподключения. По умолчанию [0, 2000, 5000]. */
  reconnectDelaysMs?: readonly number[];
  /** Срок одной попытки и любого запроса без потока. По умолчанию 10 000 мс. */
  requestTimeoutMs?: number;
}

/** Как вкладка видит связь с сервером. */
export type ConnectionState = "online" | "reconnecting" | "offline";

export interface UseAgentChatOptions {
  /** Адрес обработчика чата, например `/api/chat`. */
  api: string;
  chatId: string;
  /** Свой `fetch` — для тестов и особых сред. */
  fetch?: typeof globalThis.fetch;
  liveness?: LivenessOptions;
  /** У сервера включены лимиты расходов: читать состояние лимита и показывать его. Отказ 429 обрабатывается всегда. */
  spendingLimits?: boolean;
  /** Связь с приложением: место, вкладка, сообщения об изменении данных, браузерные вызовы. Нет — чат как раньше. */
  appBridge?: AgentAppBridge;
  /** Текст в поле ввода при открытии чата. */
  initialDraft?: string;
  /** Приложение отказало ходу или человеку в доступе: код для программы и слова для человека. Зовётся на каждый такой отказ. */
  onTurnRefused?: (refusal: AppRefusal) => void;
  /**
   * Событие приложения пришло по каналу наблюдения: вне хода (`publishAppEvent` на сервере, без `messageId`) или от
   * хука итога, доделанного после «Стопа» (`messageId` — ответ, куда оно уже дописано; история перечитывается сама).
   * Канал открыт, пока чат свободен: событие, опубликованное во время хода, вкладка не получит. События в ответах
   * читает `AgentChat.onAppEvent`.
   */
  onAppEvent?: (event: AppEvent, messageId?: string) => void;
  /**
   * Новые события ответа `messageId` придут живыми с перечитанной историей: ответ на виджет принят без продолжения,
   * события его проверки уже дописаны в ответ. `AgentChat` передаёт сюда `expectLive` учёта ленты.
   */
  onExpectLiveAppEvents?: (messageId: string) => void;
  /**
   * Поправки на лету: пока идёт ответ, `submit` отправляет текст поправкой (`POST …/steer`), агент берёт её на ближайшем
   * шаге. Своя лента включает их явно (`true`) и рисует `corrections` после `messages`; по умолчанию выключено — во время
   * ответа поле не отправляет, как до 0.34.
   */
  steering?: boolean;
  /** Другое значение — история перечитывается с сервера (права, закрытие, лента): чат изменился не через экран. Первое значение ничего не перечитывает. */
  reloadKey?: number;
}

export interface AgentChatState {
  messages: AgentChatMessage[];
  /** Записи сжатия истории на текущей ветке: на их границах лента рисует разделители. */
  compactions: CompactionMarker[];
  /** Развилки текущей ветки: у сообщения с соседями лента рисует переключатель «‹ 2/3 ›». */
  forks: BranchFork[];
  /** История загружена с сервера. */
  loaded: boolean;
  value: string;
  setValue: (value: string) => void;
  canSubmit: boolean;
  /**
   * Идёт ответ, и поле принимает поправки: `submit` отправит текст (или файлы) поправкой, агент возьмёт её на ближайшем
   * шаге. Пустое поле `submit` не отправит, как и при `canSubmit`.
   */
  canSteer: boolean;
  /**
   * Поправки, которые агент ещё не взял: лента рисует их после сообщений, с пометкой. Взятая поправка уходит отсюда в
   * `messages`.
   */
  corrections: AgentChatMessage[];
  /** Идёт ответ или вкладка переподключается к нему. */
  busy: boolean;
  /** Отправляет введённый текст; `files` — готовые вложения (ссылки на загруженные файлы): тогда текст может быть пуст. */
  submit: (files?: readonly FileUIPart[], onRejected?: (kind: string | undefined) => void) => boolean;
  stop: () => Promise<void>;
  /**
   * Отправляет слова из голосового режима (с признаком `voiceMode`, чтобы ответ был коротким и разговорным).
   * `false` — не ушло: пусто, чат не загружен, ответ ещё идёт, лимит исчерпан или ждёт подтверждения инструмента.
   */
  sendVoiceMessage: (text: string, options?: { sounds?: readonly VoiceSound[] }) => boolean;
  /** Ставит у ответа отметку обрыва озвучки на экране; на сервер ничего не уходит. */
  showVoiceCut: (messageId: string, cut: VoiceCut) => void;
  /**
   * Склейка голосовых фраз: останавливает ход, у которого ещё нет ничего, кроме размышления, и правкой заменяет последнее
   * голосовое сообщение новым текстом (прежнее с пустым ответом уходит в соседнюю ветку); модель отвечает на новое.
   * `sounds` — звуки человека, пойманные с этой частью фразы: уходят на сервер, на экране не видны.
   * Выполнено, когда сервер принял правку. `false` — заменить нельзя (у ответа уже есть текст или вызов инструмента,
   * сообщение не голосовое, сервер отказал): сообщение не заменено, ход мог быть остановлен.
   * Вызовы идут по очереди.
   */
  replaceLastVoiceMessage: (text: string, options?: { sounds?: readonly VoiceSound[] }) => Promise<boolean>;
  /** Последний ответ можно повторить: ошибка, стоп, прерывание или пустой ответ. */
  canRetry: boolean;
  /** Сообщение собеседника не дошло до сервера. */
  sendFailed: boolean;
  /** История чата не загрузилась: сервер ответил ошибкой. */
  loadFailed: boolean;
  /** Сервер ответил 404: чат чужой или его нет. Это окончательно, повторять нечего. */
  notFound: boolean;
  /** Выбор модели, сохранённый в чате (из истории); `null`, пока история не загружена и при скрытой модели. */
  savedModelChoice: ChatModelChoice | null;
  /** Видит ли модель чата картинки — из истории; `undefined`, пока история не пришла, модели нет в каталоге или сервер старый. */
  modelAcceptsImages: boolean | undefined;
  /**
   * В чат попал чужой текст — из истории или куском потока посреди ответа. Раз появившись, не пропадает: чужой текст
   * остаётся в истории чата. Живые демонстрации в таком чате не запускаются.
   */
  externalContent: boolean;
  /** Связь с сервером: обычная работа, идут попытки подключиться, попытки исчерпаны. */
  connection: ConnectionState;
  /**
   * Новый ответ на последний вопрос; если вопрос не дошёл до сервера — отправляет его заново;
   * если не загрузилась история — грузит её снова; при «Нет связи» — начинает попытки заново.
   */
  retry: () => void;
  /** Ответ человека на запрос подтверждения; когда отвечены все запросы, ход продолжается и лента дописывается. */
  respondToApproval: (approvalId: string, decision: ApprovalDecision) => Promise<void>;
  /** Запрос, ответ на который сейчас идёт на сервер. */
  approvalPendingId: string | null;
  /** Запрос, ответ на который не принят (нет связи, лимит, чат занят): кнопки снова доступны. */
  approvalFailure: { id: string; kind: ApprovalFailureKind; text?: string } | null;
  /**
   * Ответ человека на виджет (вызов `toolCallId`); `true` — сервер принял, ход продолжается и лента дописывается.
   * `onAccepted` — сразу, как сервер принял, не дожидаясь продолжения.
   */
  answerWidget: (toolCallId: string, answer: unknown, onAccepted?: () => void) => Promise<boolean>;
  /** Виджет, ответ на который сейчас идёт на сервер. */
  widgetPendingId: string | null;
  /** Виджет, ответ на который не принят: он снова активен. */
  widgetFailure: { id: string; kind: WidgetFailureKind; text?: string } | null;
  /** Обычная отправка готового текста мимо поля ввода (подсказка ответа); `false` — не ушло. */
  sendReply: (text: string) => boolean;
  /** Переключает текущую ветку на соседнее сообщение развилки; во время ответа не делает ничего. `true` — история новой ветки показана. */
  selectBranch: (messageId: string) => Promise<boolean>;
  /** Последний ответ можно переделать: он законченный и непустой (у остальных — «повторить»). */
  canRegenerate: boolean;
  /** Новый ответ на последний вопрос; прежний остаётся соседней веткой. */
  regenerate: () => void;
  /** Отправленное сообщение можно править: ничего не идёт и связь есть. */
  canEdit: boolean;
  /**
   * Правка отправленного сообщения: новая ветка от того же места с новым текстом и новым ответом.
   * Отвечает, как только сервер принял правку или отказал, не дожидаясь конца ответа. При отказе лента возвращается
   * к прежнему виду: тексту, который собеседник правил, есть куда вернуться.
   */
  edit: (messageId: string, text: string) => Promise<EditOutcome>;
  /** Лимит расходов подошёл к пределу или исчерпан; `null` — всё в пределах, лимитов нет или они не включены. */
  spending: SpendingView | null;
  /**
   * Сервер отказал не из-за связи: `signed_out` — вход истёк (401), `too_many_turns` — у человека уже идут ответы
   * в других чатах, `forbidden_origin` — сервер не признал страницу своей (403, адреса нет в `allowedOrigins`).
   * `null` — отказа нет. Вход снимается любым успешным запросом, остальные — принятым ходом и сменой чата.
   */
  refusal: ChatRefusal | null;
  /**
   * Приложение не пустило человека в этот чат (`resolveUser` вернул отказ) на загрузке истории: слова приложения вместо чата.
   * `null` — доступ есть.
   */
  accessRefusal: ServerRefusal | null;
  /**
   * Сервер отказал ходу 4xx с понятным текстом (`{ error: "…" }` или `{ error: { message: "…" } }`): текст до
   * 300 знаков. `final` — повтор того же запроса снова получит отказ (всё, кроме 408, 425 и 429): «Повторить» не нужна.
   * Отправленное сообщение при окончательном отказе возвращается в поле. Снимается следующим ходом и сменой чата.
   * Отказ правке показывает сам редактор. `null` — такого отказа нет.
   */
  serverRefusal: ServerRefusal | null;
  /**
   * Счётчик «список фоновых задач мог измениться»: растёт при каждом открытии подписки `GET {chat}/watch` и на её
   * событие `tasks-changed`. Сервер без подписки — всегда 0.
   */
  tasksVersion: number;
  /** Сервер не заявил, что фона у него нет (`backgroundTasks: false` в истории): задачи можно спрашивать. Старый сервер без заявки — `true`. */
  backgroundTasksAvailable: boolean;
  /** Права человека в чате (из истории); сервер до 0.27 их не присылает — всё разрешено. */
  capabilities: ChatCapabilities;
  /**
   * Чат закрыт: отправка, «Повторить», виджеты и подтверждения недоступны. Правка, «Переделать», ветки и правка ответа
   * уводят с точки закрытия и идут по правам (`capabilities`). Приходит с историей, отказом 409 `chat_closed`, куском
   * потока ответа и событиями наблюдения. `null` — чат открыт.
   */
  closed: ChatClosure | null;
  /** Состояние чата показанной ветки (`model.state` на сервере): живьём по ходу ответа и после смены ветки. */
  chatState: ChatStateValues;
}

/** Отказ сервера, о котором говорит надпись над полем ввода. */
export type ChatRefusal = "signed_out" | "too_many_turns" | "forbidden_origin";

/** Причина, по которой правка не ушла на сервер. */
export type EditNotStartedReason = "busy" | "offline" | "empty" | "unknown_message";
/** Причина отказа сервера: ответ уже идёт, правка неверна, сообщения в чате нет, лимит расходов исчерпан. */
export type EditRefusalReason =
  | "busy"
  | "invalid"
  | "not_found"
  | "spending_limit"
  | "signed_out"
  | "too_many_turns"
  | "forbidden_origin"
  | "server_refused";
/**
 * Чем кончилась попытка правки. `started` — сервер принял, идёт новый ответ (обрыв связи после этого — обычный путь «Повторить»).
 * У `server_refused` есть `text` — причина отказа словами сервера (4xx с текстом); если отказало приложение — ещё и `code`.
 * У `spending_limit` из-за окна сообщений — `unit: "messages"`; у денег поля нет.
 */
export type EditOutcome =
  | { status: "started" }
  | { status: "not_started"; reason: EditNotStartedReason }
  | { status: "refused"; reason: EditRefusalReason; text?: string; code?: string; unit?: "messages" };

interface ServerHistory {
  chat?: Partial<ChatModelChoice> & { closed?: unknown };
  /** Нет у серверов до 0.27. */
  capabilities?: unknown;
  /** Фоновые задачи на сервере подключены. Нет у серверов до этой заявки: тогда клиент спрашивает адрес задач сам. */
  backgroundTasks?: boolean;
  /** Видит ли модель чата картинки; нет у старого сервера и у модели вне каталога. */
  modelAcceptsImages?: unknown;
  /** В чат попал чужой текст (веб, файл человека, инструмент с пометкой): живые демонстрации не запускаются. */
  externalContent?: unknown;
  messages: AgentChatMessage[];
  running: boolean;
  /**
   * Ответ в истории идёт, а живого потока у этой копии сервера нет: сервер упал и поднялся, или ответ ведёт другая копия.
   * Нет у серверов до этапа 8в.
   */
  detachedAnswer?: boolean;
  /** Нет у серверов до фичи сжатия. */
  compactions?: CompactionMarker[];
  compacting?: boolean;
  /** Нет у серверов до фичи веток. */
  forks?: BranchFork[];
  /** Поправки после идущего ответа, ещё не взятые агентом. Нет у серверов до 0.34. */
  pendingMessages?: AgentChatMessage[];
}

/** Что вышло из запроса истории: `unreachable` — сеть или срок, `signed_out` — вход истёк, `server_error` — сервер ответил отказом. */
type HistoryResult = ServerHistory | "not_found" | "unreachable" | "signed_out" | "server_error" | "access_refused";

/** Правка, что ещё не дошла до сервера: `messageId` — новое сообщение, `editedMessageId` — то, что правят. */
interface PendingEdit {
  messageId: string;
  editedMessageId: string;
  /** Сервер ответил на запрос правки: принял (`null`) или отказал по этой причине. */
  answered: (refusal: EditRefusalReason | null) => void;
  /** Отказ сервера, если он был: после него лента возвращается, а серия попыток не нужна. */
  refusal: EditRefusalReason | null;
  /** Текст отказа словами сервера (4xx с текстом). */
  refusalText?: string;
  /** Код отказа приложения. */
  refusalCode?: string;
  /** Отказ по лимиту сообщений, а не денег. */
  refusalUnit?: "messages";
}

const EDIT_REFUSALS: Record<number, EditRefusalReason> = { 400: "invalid", 401: "signed_out", 404: "not_found", 409: "busy", 429: "spending_limit" };

/** Запросы, которые начинают ход. */
const TURN_ENDPOINTS = ["/messages", "/retry", "/regenerate", "/edit"];

/** Чем кончилось подключение к идущему ответу. */
type ResumeOutcome = "streaming" | "nothing" | "failed";

/** Ожидание итога подключения: транспорт сообщает, когда пришёл первый байт, 204 или отказ. */
interface ResumeProbe {
  signal: AbortSignal;
  settle: (outcome: ResumeOutcome) => void;
}

const HEARTBEAT_HEADER = "x-agent-chat-heartbeat-ms";

/**
 * Сервер ставит признак «идёт сжатие» до конца потока ответа, поэтому первая проверка через эту паузу не промахивается
 * мимо старта; пауза только не даёт спросить раньше, чем страница дорисует ответ.
 */
const COMPACTION_FIRST_CHECK_MS = 500;
/** Как часто спрашивать, пока сжатие идёт: разделитель должен появиться не позже чем через 3 секунды после записи. */
const COMPACTION_POLL_INTERVAL_MS = 1_500;
/** Сжатие на сервере обрывается через 10 минут; опрос живёт чуть дольше. Потом запись появится при следующей загрузке чата. */
const COMPACTION_POLL_LIMIT_MS = 12 * 60_000;

/** Как часто перечитывать историю, пока ответ идёт без живого потока: сервер прерывает брошенный ответ через 15–20 с. */
const DETACHED_ANSWER_CHECK_EVERY_MS = 3_000;
/** Сколько ждать итога брошенного ответа от сервера; дальше ответ прерывается на экране и можно «Повторить». */
const DETACHED_ANSWER_GIVE_UP_MS = 30_000;

/** Сколько раз склейка пробует правку, если сервер отвечает «занят», и через сколько мс. */
const REPLACE_ATTEMPTS = 6;
const REPLACE_RETRY_MS = 150;
/** Сколько ждать, пока чат освободится после остановки, и как часто проверять. */
const IDLE_WAIT_MS = 3_000;
const IDLE_POLL_MS = 20;

/**
 * Поля тела запроса хода: часовой пояс браузера (по нему дата в запросе к модели) и от моста — вкладка и место на
 * экране на этот момент. Нет моста — только пояс.
 */
function pageFields(bridge: AgentAppBridge | undefined): { tabId?: string; place?: ScreenPlace; timeZone?: string } {
  const zone = browserTimeZone();
  const timeZone = zone ? { timeZone: zone } : {};
  if (!bridge) return timeZone;
  let place: ScreenPlace | null = null;
  try {
    place = bridge.currentPlace();
  } catch {
    // Сбой в коде приложения не должен мешать отправке: сообщение уходит без места.
  }
  const sendable = place && serializablePlace(place);
  return { tabId: bridge.tabId, ...(sendable && { place: sendable }), ...timeZone };
}

/** Пояс браузера, например `Europe/Moscow`; браузер не сказал — нет пояса, сервер возьмёт свой. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Место, которое переживёт `JSON.stringify`: данные не сериализуются (цикл, BigInt) — место без них; и описание плохое — места нет. */
function serializablePlace(place: ScreenPlace): ScreenPlace | null {
  for (const candidate of [place, { description: place.description }]) {
    try {
      JSON.stringify(candidate);
      return candidate;
    } catch {
      // пробуем следующий вариант
    }
  }
  return null;
}

export function useAgentChat({
  api,
  chatId,
  fetch: customFetch,
  liveness,
  spendingLimits = false,
  appBridge,
  initialDraft = "",
  onTurnRefused,
  onAppEvent,
  onExpectLiveAppEvents,
  reloadKey,
  steering = false,
}: UseAgentChatOptions): AgentChatState {
  const chatUrl = `${api}/${encodeURIComponent(chatId)}`;
  const [refusal, setRefusal] = useState<ChatRefusal | null>(null);
  const [serverRefusal, setServerRefusal] = useState<ServerRefusal | null>(null);
  const [accessRefusal, setAccessRefusal] = useState<ServerRefusal | null>(null);
  const [capabilities, setCapabilities] = useState<ChatCapabilities>(ALL_CAPABILITIES);
  const [closed, setClosed] = useState<ChatClosure | null>(null);
  // Сервер без заявки (старый) мог бы держать фон: спрашиваем его сами, как раньше.
  const [backgroundTasksAvailable, setBackgroundTasksAvailable] = useState(true);
  const [modelAcceptsImages, setModelAcceptsImages] = useState<boolean | undefined>(undefined);
  const [externalContent, setExternalContent] = useState(false);
  const showClosure = useCallback((next: ChatClosure | null) => {
    setClosed((current) => (current?.code === next?.code && current?.message === next?.message ? current : next));
  }, []);
  /** Права, закрытие и зрение модели из истории: то же значение не перерисовывает экран. */
  const applyAccess = useCallback(
    (history: ServerHistory) => {
      const next = capabilitiesOf(history.capabilities);
      setCapabilities((current) => (sameCapabilities(current, next) ? current : next));
      showClosure(closureOf(history.chat?.closed));
      setBackgroundTasksAvailable(history.backgroundTasks !== false);
      setModelAcceptsImages(typeof history.modelAcceptsImages === "boolean" ? history.modelAcceptsImages : undefined);
      // Только включается: история, прочитанная раньше куска потока, признак не снимает.
      if (history.externalContent === true) setExternalContent(true);
    },
    [showClosure],
  );
  const onTurnRefusedRef = useRef(onTurnRefused);
  onTurnRefusedRef.current = onTurnRefused;
  /** Сообщает странице об отказе приложения; обычные отказы сервера (без кода) не в счёт. Отказ `chat_closed` закрывает чат. */
  const announceAppRefusal = useCallback(
    (refused: ServerRefusal | null) => {
      if (!refused?.kind || !refused.code) return;
      if (refused.kind === "chat_closed") showClosure({ code: refused.code, message: refused.text });
      onTurnRefusedRef.current?.({ kind: refused.kind, code: refused.code, message: refused.text });
    },
    [showClosure],
  );
  // Приложение может передавать новую функцию `fetch` при каждой перерисовке: запросы берут последнюю, а сама
  // `request` не меняется — иначе от перерисовки страницы заново грузилась бы история и пропадал набранный текст.
  const customFetchRef = useRef(customFetch);
  customFetchRef.current = customFetch;
  const warnedForbiddenOrigin = useRef(false);
  // Вход истёк — сервер отвечает 401 на любой запрос; любой успешный ответ значит, что человек снова вошёл.
  // Чужая для сервера страница получает 403 только на запись: снимает отказ успешная запись, а не чтение.
  const request = useCallback(
    async (input: string, init?: RequestInit) => {
      const response = await (customFetchRef.current ?? globalThis.fetch)(input, init);
      const writes = (init?.method ?? "GET").toUpperCase() !== "GET";
      // 401 со словами приложения — отказ в доступе, а не «вход истёк»: надпись говорит его слова.
      if (response.status === 401 && !(await appRefusalOf(response))) setRefusal("signed_out");
      else if (await isForbiddenOrigin(response)) {
        // Отказ правке показывает сам редактор: одна ошибка — одно сообщение.
        if (!input.endsWith("/edit")) setRefusal("forbidden_origin");
        if (!warnedForbiddenOrigin.current && isDevelopment()) {
          warnedForbiddenOrigin.current = true;
          console.warn(forbiddenOriginHint());
        }
      } else if (response.ok) setRefusal((current) => (current === "signed_out" || (writes && current === "forbidden_origin") ? null : current));
      return response;
    },
    [],
  );
  const settings = {
    silenceTimeoutMs: liveness?.silenceTimeoutMs ?? 30_000,
    reconnectDelaysMs: liveness?.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS,
    requestTimeoutMs: liveness?.requestTimeoutMs ?? 10_000,
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** Id сообщения собеседника, которое не дошло до сервера: «повторить» отправляет его заново. */
  const unsentMessageId = useRef<string | null>(null);
  /** Ответ, который заменяет «повторить»: если сервер недоступен, он возвращается на место. */
  const replacedAnswer = useRef<AgentChatMessage | null>(null);
  /** Сервер отказал именно этому сообщению (400 с видом ошибки): его нужно вернуть в поле, а не «повторять». */
  const rejectedSend = useRef<{ messageId: string | undefined; kind: string | undefined } | null>(null);
  /** Id сообщения, которое уходит на сервер прямо сейчас. */
  const sendingMessageId = useRef<string | undefined>(undefined);
  /** Id сообщений, отправленных из голосового режима: их запрос несёт `voiceMode`, в том числе при повторной отправке. */
  const voiceMessageIds = useRef(new Set<string>());
  /** Звуки человека голосовых сообщений по id: уходят в запросе вместе с `voiceMode`, в сообщение на экране не попадают. */
  const voiceSoundsById = useRef(new Map<string, readonly VoiceSound[]>());
  /** Id ответа, который переделывает `regenerate`: запрос идёт на `/regenerate`, а не на `/retry`. */
  const regeneratedAnswerId = useRef<string | null>(null);
  /** Правка, что ещё не дошла до сервера. */
  const pendingEdit = useRef<PendingEdit | null>(null);
  /** Ход мог создать соседа на развилке (правка, переделка, повтор): после него развилки читаются заново. */
  const forksMayChange = useRef(false);
  const chatUrlRef = useRef(chatUrl);
  chatUrlRef.current = chatUrl;
  /** Мост приложения: место берётся в момент запроса, поэтому транспорт читает его отсюда. */
  const bridgeRef = useRef(appBridge);
  bridgeRef.current = appBridge;
  const requestRef = useRef(request);
  requestRef.current = request;
  /** Перечитывает права из истории: после отказа `action_forbidden` экран узнаёт, что именно стало нельзя. */
  const refreshAccessRef = useRef<() => Promise<void>>(async () => {});
  /** Сервер не ждёт ответа браузерного вызова: хода уже нет. Без живого потока лента перечитывает историю. */
  const browserCallGoneRef = useRef<() => void>(() => {});
  /** Обрывает функции браузерных инструментов этой вкладки: «стоп», смена чата, размонтирование. */
  const browserCallsLifetime = useRef<AbortController | null>(null);
  const browserCallsSignal = () => (browserCallsLifetime.current ??= new AbortController()).signal;
  useEffect(
    () => () => {
      browserCallsLifetime.current?.abort();
      browserCallsLifetime.current = null;
    },
    [chatId],
  );
  /** Сервер отказал в ходе из-за лимита расходов: ход не начат, ничего не записано. */
  const spendingRefusal = useRef<SpendingInfo | null>(null);
  /** Ответ, ждавший решения, каким он был до отправки нового сообщения: возвращается, если сервер сообщение не принял. */
  const approvalsClosedBySubmit = useRef<AgentChatMessage | null>(null);
  /** Последняя ошибка запроса: отличает обрыв связи от отказа сервера. */
  const lastError = useRef<Error | null>(null);
  /** Кто ждёт итога подключения к идущему ответу. */
  const resumeProbe = useRef<ResumeProbe | null>(null);
  /** Идущая серия попыток переподключения; одна на вкладку. */
  const seriesRef = useRef<AbortController | null>(null);
  /** Серия идёт (в том числе тихая первая попытка): вкладка занята, отправлять нельзя. */
  const [seriesRunning, setSeriesRunning] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("online");
  /** Поправки, которые агент ещё не взял. */
  const [corrections, setCorrections] = useState<AgentChatMessage[]>([]);
  const correctionsRef = useRef(corrections);
  correctionsRef.current = corrections;
  /** Id поправок, что ещё идут на сервер. */
  const sendingCorrections = useRef(new Set<string>());
  /** Очередь запросов поправок: сервер получает их в том порядке, в каком человек их написал. */
  const steerQueue = useRef<Promise<void>>(Promise.resolve());
  /**
   * Поправка, на которую сервер не ответил (обрыв, срок): он мог её уже записать. Тот же текст с теми же файлами уходит
   * снова с тем же id — сервер узнаёт повтор, второй копии нет.
   */
  const unconfirmedCorrection = useRef<{ chatUrl: string; id: string; text: string; files: string } | null>(null);
  /** Ответ кончился, а поправки ждут: вкладка перечитывает историю и подключается к ходу по ним. */
  const [handingOff, setHandingOff] = useState(false);
  const handOff = useRef<Promise<void> | null>(null);
  const handOffToCorrectionsRef = useRef<() => Promise<void>>(async () => {});
  /** Поток ответа открыт: читается в момент вызова, `onFinish` снимает его раньше, чем придёт отрисовка. */
  const answeringRef = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentChatMessage>({
        api: `${chatUrl}/messages`,
        fetch: async (input, init) => {
          lastError.current = null;
          const url = input instanceof Request ? input.url : String(input);
          const { requestTimeoutMs, silenceTimeoutMs } = settingsRef.current;
          // Подключение к идущему ответу — единственный GET транспорта: за ним следит проба попытки.
          const probe = (init?.method ?? "GET").toUpperCase() === "GET" ? resumeProbe.current : null;
          const turnRequest = (init?.method ?? "POST").toUpperCase() === "POST" && TURN_ENDPOINTS.some((endpoint) => url.endsWith(endpoint));
          // Текст прежнего отказа к новому ходу не относится: сбой этого хода покажет свою надпись.
          if (turnRequest) setServerRefusal(null);
          let response: Response;
          try {
            response = await fetchWithDeadline(request, url, init, {
              timeoutMs: requestTimeoutMs,
              ...(probe && { signal: probe.signal }),
              silence: (streamed) => {
                const heartbeatMs = Number(streamed.headers.get(HEARTBEAT_HEADER)) || 0;
                return {
                  silenceTimeoutMs: effectiveSilenceTimeoutMs(silenceTimeoutMs, heartbeatMs),
                  // Сервер с признаком жизни шлёт пинг сразу после заголовков: тишина до него — уже обрыв.
                  ...(heartbeatMs > 0 && { firstByteTimeoutMs: requestTimeoutMs }),
                  onFirstByte: () => {
                    probe?.settle("streaming");
                    // Связь есть, раз сервер ответил: если нет серии попыток, «Нет связи» убирается.
                    if (!seriesRef.current) setConnection("online");
                  },
                  onSilence: () => probe?.settle("failed"),
                };
              },
            });
          } catch (error) {
            probe?.settle("failed");
            throw error;
          }
          if (response.ok && (init?.method ?? "POST").toUpperCase() === "POST" && url.endsWith("/messages")) {
            // Сервер принял сообщение, значит закрыл запрос на подтверждение: показанный отказ верен.
            approvalsClosedBySubmit.current = null;
          }
          const spendingLimit = response.status === 429 ? await spendingRefusalOf(response) : null;
          if (response.status === 429) spendingRefusal.current = spendingLimit;
          const tooManyTurns = turnRequest && response.status === 429 && (await errorKindOf(response)) === "too_many_turns";
          if (response.ok && turnRequest) setRefusal((current) => (current === "too_many_turns" ? null : current));
          // Отказ правке показывает сам редактор, у остальных ходов — надпись над полем.
          if (tooManyTurns && !url.endsWith("/edit")) setRefusal("too_many_turns");
          // 403 без `forbidden_origin` в теле (например, HTML-страница внешнего прокси) — обычный сбой.
          const forbiddenOrigin = await isForbiddenOrigin(response);
          // Отказ со своим текстом; вход, лимит, «другие чаты» и «чужая страница» говорят своими надписями.
          const accessRefusedWithWords = response.status === 401 && (await appRefusalOf(response)) !== null;
          const knownRefusal = (response.status === 401 && !accessRefusedWithWords) || spendingLimit !== null || tooManyTurns || forbiddenOrigin;
          const refusedWithText = turnRequest && !knownRefusal ? await serverRefusalOf(response) : null;
          // Закрытие говорит своей надписью над полем: второй надписи не нужно.
          if (refusedWithText && !url.endsWith("/edit") && refusedWithText.kind !== "chat_closed") setServerRefusal(refusedWithText);
          announceAppRefusal(refusedWithText);
          // Права на сервере сменились, пока экран был открыт: запрещённая кнопка уходит с экрана, а не отказывает снова.
          if (refusedWithText?.kind === "action_forbidden") void refreshAccessRef.current();
          const edit = pendingEdit.current;
          if (edit && url.endsWith("/edit")) {
            const refusal = response.ok
              ? null
              : tooManyTurns
                ? "too_many_turns"
                : forbiddenOrigin
                  ? "forbidden_origin"
                  : refusedWithText
                    ? "server_refused"
                    : (EDIT_REFUSALS[response.status] ?? null);
            if (refusal) edit.refusal = refusal;
            if (refusedWithText) edit.refusalText = refusedWithText.text;
            if (refusedWithText?.code) edit.refusalCode = refusedWithText.code;
            if (spendingLimit?.unit === "messages") edit.refusalUnit = "messages";
            // Отказ, которого мы не знаем (5xx), — обычный сбой: правка остаётся в ленте, «Повторить» отправит её снова.
            edit.answered(refusal);
          }
          // Вход истёк, страница не своя для сервера, уже идут ответы в других чатах или сервер окончательно отказал
          // своими словами — сообщение не принято, как и при 400: оно вернётся в поле.
          const refusedSend = response.status === 400 || response.status === 401 || forbiddenOrigin || tooManyTurns || refusedWithText?.final === true;
          if (refusedSend && (init?.method ?? "POST").toUpperCase() === "POST" && url.endsWith("/messages")) {
            const kind = await errorKindOf(response);
            rejectedSend.current = { messageId: sendingMessageId.current, kind: response.status === 401 && !accessRefusedWithWords ? "signed_out" : kind };
          }
          if (response.status === 204) probe?.settle("nothing");
          else if (!response.ok || !response.body) probe?.settle("failed");
          return response;
        },
        // Сервер сам хранит историю: уходит только новое сообщение. «Повторить» — пустой запрос,
        // кроме сообщения, которое до сервера не дошло: оно уходит заново с тем же id.
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const last = messages.at(-1);
          sendingMessageId.current = last?.id;
          const edit = pendingEdit.current;
          if (edit && last?.id === edit.messageId) {
            // Правка-склейка голосовых фраз: отметку голоса, как у отправки, сервер ставит сам по `voiceMode`.
            const voiceMode = voiceMessageIds.current.has(last.id);
            const voiceSounds = voiceSoundsById.current.get(last.id) ?? [];
            const outgoing = { ...last, parts: last.parts.filter((part) => part.type !== VOICE_MODE_PART_TYPE) };
            return {
              api: `${chatUrl}/edit`,
              body: { editedMessageId: edit.editedMessageId, message: outgoing, ...(voiceMode && { voiceMode: true }), ...(voiceMode && voiceSounds.length > 0 && { voiceSounds }), ...pageFields(bridgeRef.current) },
            };
          }
          if (trigger === "regenerate-message" && regeneratedAnswerId.current) {
            return { api: `${chatUrl}/regenerate`, body: { messageId: regeneratedAnswerId.current, ...pageFields(bridgeRef.current) } };
          }
          if (trigger === "regenerate-message" && last?.id !== unsentMessageId.current) {
            return { api: `${chatUrl}/retry`, body: pageFields(bridgeRef.current) };
          }
          const voiceMode = last !== undefined && voiceMessageIds.current.has(last.id);
          const voiceSounds = (last && voiceSoundsById.current.get(last.id)) ?? [];
          // Отметку голосового хода сервер ставит сам по `voiceMode`; в запрос она не идёт.
          const outgoing = last && { ...last, parts: last.parts.filter((part) => part.type !== VOICE_MODE_PART_TYPE) };
          return { api: `${chatUrl}/messages`, body: { message: outgoing, ...(voiceMode && { voiceMode: true }), ...(voiceMode && voiceSounds.length > 0 && { voiceSounds }), ...pageFields(bridgeRef.current) } };
        },
        // Идущий ответ отдаётся с начала хода; 204 — хода уже нет.
        prepareReconnectToStreamRequest: () => ({ api: `${chatUrl}/stream` }),
      }),
    [chatUrl, request],
  );
  const [notFound, setNotFound] = useState(false);
  const [compactions, setCompactions] = useState<CompactionMarker[]>([]);
  const [forks, setForks] = useState<BranchFork[]>([]);
  /** Идущий опрос записей сжатия; один на вкладку. */
  const compactionPoll = useRef<AbortController | null>(null);

  /** Лёгкий запрос записей сжатия; `null` — не вышло (сеть, срок, отказ). */
  const loadCompactions = useCallback(
    async (signal: AbortSignal): Promise<{ compactions: CompactionMarker[]; compacting: boolean } | null> => {
      try {
        const response = await fetchWithDeadline(request, `${chatUrl}/compactions`, undefined, {
          timeoutMs: settingsRef.current.requestTimeoutMs,
          wholeBody: true,
          signal,
        });
        return response.ok ? ((await response.json()) as { compactions: CompactionMarker[]; compacting: boolean }) : null;
      } catch {
        return null;
      }
    },
    [chatUrl, request],
  );

  /**
   * Спрашивает записи сжатия, пока оно идёт, и показывает новые: разделитель появляется без перезагрузки страницы.
   * Сбой запроса опрос не останавливает, чат от него не ломается.
   */
  const pollCompactions = useCallback(() => {
    compactionPoll.current?.abort();
    const controller = new AbortController();
    compactionPoll.current = controller;
    const { signal } = controller;
    void (async () => {
      await pause(COMPACTION_FIRST_CHECK_MS, signal);
      for (let waited = COMPACTION_FIRST_CHECK_MS; !signal.aborted && waited < COMPACTION_POLL_LIMIT_MS; waited += COMPACTION_POLL_INTERVAL_MS) {
        const state = await loadCompactions(signal);
        if (signal.aborted) return;
        if (state) {
          setCompactions(state.compactions);
          if (!state.compacting) return;
        }
        await pause(COMPACTION_POLL_INTERVAL_MS, signal);
      }
    })();
  }, [loadCompactions]);
  /** Развилки читаются заново после хода, что мог создать соседа; сбой запроса ничего не ломает. */
  const refreshForks = useCallback(async () => {
    const asked = chatUrl;
    try {
      const response = await fetchWithDeadline(request, `${chatUrl}/branches`, undefined, {
        timeoutMs: settingsRef.current.requestTimeoutMs,
        wholeBody: true,
      });
      if (!response.ok || chatUrlRef.current !== asked) return;
      setForks(((await response.json()) as { forks: BranchFork[] }).forks);
    } catch {
      // Развилки покажутся при следующей загрузке чата.
    }
  }, [chatUrl, request]);

  /** Что ход, ждавший повтора, больше не нужен: ответ пришёл, сервер сохранил его или попытки кончились. */
  const clearPendingResend = () => {
    replacedAnswer.current = null;
    regeneratedAnswerId.current = null;
    pendingEdit.current = null;
  };

  /** История с сервера, с учётом сроков; `signal` — своя отмена (серия попыток, уход со страницы). */
  const loadHistory = useCallback(
    async (signal?: AbortSignal): Promise<HistoryResult> => {
      try {
        const response = await fetchWithDeadline(request, chatUrl, undefined, {
          timeoutMs: settingsRef.current.requestTimeoutMs,
          wholeBody: true,
          ...(signal && { signal }),
        });
        if (response.status === 404) return "not_found";
        // Приложение не пустило человека в чат: его слова вместо чата, а не «вход истёк».
        const refusedAccess = response.ok ? null : await serverRefusalOf(response);
        if (refusedAccess?.kind === "access_refused") {
          setAccessRefusal(refusedAccess);
          announceAppRefusal(refusedAccess);
          return "access_refused";
        }
        if (response.status === 401) return "signed_out";
        if (!response.ok) return "server_error";
        // Доступ вернули: отказ приложения больше не показывается вместо чата.
        setAccessRefusal(null);
        return (await response.json()) as ServerHistory;
      } catch (error) {
        return isConnectionError(error) ? "unreachable" : "server_error";
      }
    },
    [announceAppRefusal, chatUrl, request],
  );
  refreshAccessRef.current = async () => {
    const asked = chatUrl;
    const history = await loadHistory();
    if (typeof history !== "string" && chatUrlRef.current === asked) applyAccess(history);
  };
  const [sendFailed, setSendFailed] = useState(false);
  const [spending, setSpending] = useState<SpendingView | null>(null);
  const exhausted = spending?.state === "exhausted";

  /** Читает состояние лимита; сбой или сервер без лимитов (404) оставляют прежнее, чат от них не ломается. */
  const refreshSpending = useCallback(async () => {
    if (!spendingLimits) return;
    const asked = chatUrl;
    try {
      const response = await fetchWithDeadline(request, `${chatUrl}/spending`, undefined, {
        timeoutMs: settingsRef.current.requestTimeoutMs,
        wholeBody: true,
      });
      if (!response.ok || chatUrlRef.current !== asked) return;
      setSpending(spendingViewOf((await response.json()) as Parameters<typeof spendingViewOf>[0]));
    } catch {
      // Надпись появится при следующем чтении: после ответа или при открытии чата.
    }
  }, [chatUrl, request, spendingLimits]);

  // Размонтирование обрывает только запрос вкладки: ход на сервере идёт дальше, «стоп» — лишь по кнопке.
  const chat = useChat<AgentChatMessage>({
    id: chatId,
    transport,
    onError: (error) => {
      lastError.current = error;
    },
    // Временные куски данных в сообщения не попадают: сообщение об изменении данных идёт приложению сразу, как пришло.
    // Браузерный вызов исполняется по куску сервера, а не по `onToolCall`: кусок приходит только после «Разрешить».
    onData: (part) => {
      if (part.type === BROWSER_CALL_PART_TYPE) {
        const bridge = bridgeRef.current;
        if (bridge) {
          void runBrowserCall(part.data as BrowserCallRequest, {
            bridge,
            chatUrl: chatUrlRef.current,
            request: requestRef.current,
            signal: browserCallsSignal(),
            onNotPending: () => browserCallGoneRef.current(),
          });
        }
        return;
      }
      if (part.type === EXTERNAL_CONTENT_PART_TYPE) {
        setExternalContent(true);
        return;
      }
      if (part.type === CHAT_CLOSED_PART_TYPE) {
        const closure = closureOf(part.data);
        if (closure) showClosure(closure);
        return;
      }
      if (part.type !== APP_CHANGE_PART_TYPE) return;
      const { tag, details } = part.data as { tag: string; details?: unknown };
      if (part.id !== undefined) bridgeRef.current?.dataChanged({ id: part.id, tag, ...(details !== undefined && { details }) });
    },
    onFinish: ({ messages: received, isAbort }) => {
      answeringRef.current = false;
      // Стёртые шаги (`data-step-reset`) не видны ни ленте, ни решениям хука.
      const messages = withoutResetMessages(received);
      // Ход после ответа на виджет кончился: отвеченный вызов больше не «в пути» (widgets/widget-messages.ts).
      if (withWidgetAnswersSettled(messages) !== messages) setMessages((current) => withWidgetAnswersSettled(current));
      // Агент взял поправки (или «Стоп» оставил их ждать, или поправка сама начала ход после отказа): ход по ним идёт
      // на сервере, вкладка подключается к нему.
      const handOffToCorrections = () => {
        if (correctionsRef.current.length > 0) void handOffToCorrectionsRef.current();
      };
      const refusal = spendingRefusal.current;
      if (refusal) {
        spendingRefusal.current = null;
        // Правку вернёт `edit`: лента и поле правки прежние, здесь только «лимит исчерпан».
        if (pendingEdit.current?.refusal) setSpending({ state: "exhausted", info: refusal });
        else void showSpendingRefusal(refusal, messages);
        handOffToCorrections();
        return;
      }
      // Сервер отказал в правке (ленту вернёт `edit`) или сообщению (его вернут в поле): искать на сервере нечего.
      if (pendingEdit.current?.refusal || rejectedSend.current) {
        handOffToCorrections();
        return;
      }
      // Сервер всегда шлёт итог ответа перед концом потока. Нет итога — обрыв связи, даже если
      // поток закрылся без ошибки: так его закрывает прокси, когда сервер за ним упал.
      if (isAbort || isFinalStatus(lastAnswerStatus(messages))) {
        clearPendingResend();
        // Сервер принял сообщение и ответил: звуки человека больше не нужны (они держатся только на случай повторной отправки).
        if (sendingMessageId.current && isFinalStatus(lastAnswerStatus(messages))) voiceSoundsById.current.delete(sendingMessageId.current);
        // Ход оборвался (стоп, сбой), а вызов после «Разрешить» так и остался без результата: правду о нём знает сервер.
        if (hasStalledContinuation(messages)) void refreshFromServer(chatLifetime.current.signal);
        void refreshSpending();
        if (forksMayChange.current) {
          forksMayChange.current = false;
          void refreshForks();
        }
        // Сервер сжимает историю фоном сразу после штатного ответа: проверить, не появился ли разделитель.
        if (!isAbort && lastAnswerStatus(messages) === "complete") pollCompactions();
        handOffToCorrections();
        return;
      }
      const error = lastError.current;
      // Запрос кончился без итога ответа: обрыв связи или отказ сервера. Ленту восстанавливает серия попыток.
      startSeries({ quietFirst: error !== null && !isConnectionError(error) });
    },
  });
  const { sendMessage, regenerate, resumeStream, status, stop: stopChat } = chat;
  // Шаг, начатый заново у другого провайдера (`data-step-reset`), не виден ни в ленте, ни в решениях хука: стёртое
  // убирается при выдаче, и правки ленты получают её уже без него.
  const shownMessages = useMemo(() => withoutResetMessages(chat.messages), [chat.messages]);
  const setChatMessages = chat.setMessages;
  const setMessages = useCallback(
    (update: AgentChatMessage[] | ((current: AgentChatMessage[]) => AgentChatMessage[])) =>
      setChatMessages(typeof update === "function" ? (current) => update(withoutResetMessages(current)) : update),
    [setChatMessages],
  );
  const messagesRef = useRef(shownMessages);
  messagesRef.current = shownMessages;
  const [loaded, setLoaded] = useState(false);
  /** Для какого `chatId` загружена история: после смены чата `loaded` ещё один проход относится к прежнему. */
  const [loadedChatId, setLoadedChatId] = useState<string | null>(null);
  /** Отправка, нажатая до загрузки истории: уйдёт, как только история придёт. */
  const [submitWhenLoaded, setSubmitWhenLoaded] = useState(false);
  // Ожидающая отправка принадлежит чату, в котором её нажали; «Повторить» загрузку того же чата её сохраняет.
  useEffect(() => setSubmitWhenLoaded(false), [chatId]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savedModelChoice, setSavedModelChoice] = useState<ChatModelChoice | null>(null);
  /** Номер попытки загрузить историю: «повторить» после сбоя загрузки начинает новую. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** Подключаемся к ответу, который шёл при загрузке истории. */
  const [resuming, setResuming] = useState(false);
  /** С какого мига история показывает идущий ответ без живого потока у сервера; `null` — такого ответа нет. */
  const [detachedSince, setDetachedSince] = useState<number | null>(null);
  /** Число проверок брошенного ответа: каждая, удачная или нет, назначает следующую. */
  const [detachedChecks, setDetachedChecks] = useState(0);
  const [value, setValue] = useState(initialDraft);
  const sending = useRef(false);

  /**
   * Лимит исчерпан, ход не начат: серия попыток не нужна. Лента возвращается к тому, что записал сервер,
   * а введённый текст — в поле ввода.
   */
  const showSpendingRefusal = useCallback(
    async (refusal: SpendingInfo, shown: AgentChatMessage[]) => {
      clearPendingResend();
      unsentMessageId.current = null;
      setSpending({ state: "exhausted", info: refusal });
      const history = await loadHistory();
      if (chatUrlRef.current !== chatUrl) return;
      const stored = typeof history === "string" ? null : history.messages;
      const last = shown.at(-1);
      const notStored = last?.role === "user" && !(stored ?? []).some((message) => message.id === last.id);
      if (notStored) {
        const text = messageText(last);
        setValue((current) => (current.trim().length > 0 ? current : text));
      }
      if (typeof history !== "string") applyAccess(history);
      if (stored) setMessages(stored);
      else if (notStored) setMessages(shown.slice(0, -1));
    },
    [applyAccess, chatUrl, loadHistory, setMessages],
  );

  useEffect(() => {
    if (!loaded) {
      setSpending(null);
      return;
    }
    void refreshSpending();
  }, [loaded, refreshSpending]);

  // Исчерпание снимается само в момент обновления лимита: вкладка спрашивает сервер, а не считает сама.
  useEffect(() => {
    if (spending?.state !== "exhausted") return;
    const wait = untilResetCheckMs(spending.info, Date.now());
    if (wait === null) return;
    const timer = setTimeout(() => void refreshSpending(), wait);
    return () => clearTimeout(timer);
  }, [refreshSpending, spending]);

  /** Подключается к идущему ответу и ждёт первого байта, а не конца ответа. */
  const resumeWithProbe = useCallback(
    (signal: AbortSignal) =>
      new Promise<ResumeOutcome>((resolve) => {
        const probe: ResumeProbe = {
          signal,
          settle: (outcome) => {
            if (resumeProbe.current === probe) resumeProbe.current = null;
            resolve(outcome);
          },
        };
        if (signal.aborted) {
          resolve("failed");
          return;
        }
        resumeProbe.current = probe;
        signal.addEventListener("abort", () => probe.settle("failed"), { once: true });
        lastError.current = null;
        // Поток закрылся, не дав знать о себе: без ошибки — подключение было, с ошибкой — нет.
        void resumeStream().then(
          () => probe.settle(lastError.current ? "failed" : "streaming"),
          () => probe.settle("failed"),
        );
      }),
    [resumeStream],
  );

  /**
   * Лента из истории сервера с сообщением, что до него не дошло: история перечитывается и после сбоя (подписка на события,
   * опрос), а «Повторить» отправляет это сообщение из ленты с тем же id. Сервер его всё-таки записал — повторять нечего.
   * Сервер ведёт чужой ход — сообщению после него не место: текст возвращается в поле.
   */
  const withUnsentKept = useCallback(
    (history: ServerHistory): AgentChatMessage[] => {
      const unsent = messagesRef.current.find((message) => message.id === unsentMessageId.current);
      if (!unsent) return history.messages;
      const stored = history.messages.some((message) => message.id === unsent.id);
      if (!stored && !history.running) return [...history.messages, unsent];
      unsentMessageId.current = null;
      setSendFailed(false);
      if (!stored) setValue((current) => (current.trim().length > 0 ? current : messageText(unsent)));
      return history.messages;
    },
    [],
  );

  /**
   * Показывает историю сервера и подключается к идущему ответу, если он есть.
   * `false` — подключиться не вышло: лента возвращается к тому, что было на экране (`before`).
   */
  const applyServerHistory = useCallback(
    async (history: ServerHistory, before: AgentChatMessage[], signal: AbortSignal): Promise<boolean> => {
      applyAccess(history);
      const shown = withUnsentKept(history);
      setMessages(history.running ? withWidgetContinuationMarked(withContinuationMarked(shown)) : shown);
      setCorrections((current) => {
        const next = correctionsAfterHistory(history.pendingMessages ?? [], shown, current, sendingCorrections.current);
        // Те же поправки — тот же массив: лента не перерисовывается.
        return next.length === current.length && next.every((message, index) => message === current[index]) ? current : next;
      });
      setCompactions(history.compactions ?? []);
      setForks(history.forks ?? []);
      setDetachedSince(history.detachedAnswer === true ? (since) => since ?? Date.now() : null);
      if (!history.running) return true;
      // История не содержит идущий ответ: он целиком придёт потоком с начала хода, без повторов.
      const outcome = await resumeWithProbe(signal);
      if (outcome === "streaming") return true;
      if (outcome === "nothing") {
        // Ход успел закончиться между загрузкой истории и подключением: готовый ответ уже в истории.
        const finished = await loadHistory(signal);
        if (finished === "not_found") {
          setNotFound(true);
          return true;
        }
        if (typeof finished !== "string") {
          applyAccess(finished);
          setMessages(finished.messages);
          setCompactions(finished.compactions ?? []);
          setForks(finished.forks ?? []);
          return true;
        }
      }
      setMessages(before);
      return false;
    },
    [applyAccess, loadHistory, resumeWithProbe, setMessages, withUnsentKept],
  );

  /** Ход не начат: недописанный ответ прерван, а ответ, который заменяло «Повторить», возвращается на место. */
  const restoreReplacedAnswer = useCallback(() => {
    const replaced = replacedAnswer.current;
    clearPendingResend();
    setMessages((current) => {
      const last = current.at(-1);
      if (last?.role === "assistant") {
        return isFinalStatus(last.metadata?.status) ? current : withLastAnswerStatus(current, "interrupted");
      }
      return replaced ? [...current, replaced] : current;
    });
  }, [setMessages]);

  /** Одна попытка переподключения: история сервера главнее того, что успела показать вкладка. */
  const reconnectAttempt = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      const before = messagesRef.current;
      const history = await loadHistory(signal);
      if (signal.aborted) return false;
      if (history === "not_found") {
        setNotFound(true);
        return true;
      }
      if (history === "signed_out" || history === "access_refused") {
        // Вход истёк или приложение закрыло доступ: ждать связи бессмысленно, лента возвращается к прежнему виду, надпись говорит причину.
        restoreReplacedAnswer();
        return true;
      }
      if (typeof history === "string") return false;
      const last = before.at(-1);
      if (last?.role === "user" && !history.messages.some((message) => message.id === last.id)) {
        // Связь с сервером есть, но сообщение до него не дошло.
        unsentMessageId.current = last.id;
        setSendFailed(true);
        return true;
      }
      const connected = await applyServerHistory(history, before, signal);
      if (connected) clearPendingResend();
      return connected;
    },
    [applyServerHistory, loadHistory, restoreReplacedAnswer],
  );

  /** Отправка без нового текста: то же сообщение или новый ответ на последний вопрос. */
  const resend = useCallback(() => {
    if (sending.current) return;
    sending.current = true;
    const last = messagesRef.current.at(-1);
    replacedAnswer.current = last?.role === "assistant" ? last : null;
    if (last?.role === "assistant") forksMayChange.current = true;
    setSendFailed(false);
    rejectedSend.current = null;
    void regenerate().finally(() => {
      sending.current = false;
      const rejection = rejectedSend.current;
      if (!rejection) return;
      // Сервер не принял заново отправленное сообщение: как при первой отправке, оно уходит из ленты в поле.
      rejectedSend.current = null;
      clearPendingResend();
      unsentMessageId.current = null;
      const rejected = messagesRef.current.find((item) => item.id === rejection.messageId);
      setMessages((current) => current.filter((item) => item.id !== rejection.messageId));
      if (rejected?.role === "user") {
        const text = messageText(rejected);
        setValue((current) => (current.length === 0 ? text : current));
      }
    });
  }, [regenerate, setMessages]);

  /** Попытки исчерпаны: недописанный ответ прерван, «Нет связи с сервером». */
  const giveUp = useCallback(() => {
    restoreReplacedAnswer();
    setConnection("offline");
  }, [restoreReplacedAnswer]);

  /**
   * Серия попыток переподключения. `quietFirst` — сервер ответил отказом, а не пропал: первая
   * попытка идёт без «Переподключаемся…». `resendUnsent` — собеседник сам просит связь (кнопка,
   * событие сети): не дошедшее сообщение уходит заново.
   */
  const startSeries = useCallback(
    (options: { quietFirst?: boolean; resendUnsent?: boolean } = {}) => {
      if (seriesRef.current) return;
      const controller = new AbortController();
      seriesRef.current = controller;
      setSeriesRunning(true);
      if (!options.quietFirst) setConnection("reconnecting");
      void runReconnectAttempts({
        delaysMs: settingsRef.current.reconnectDelaysMs,
        attemptTimeoutMs: settingsRef.current.requestTimeoutMs,
        signal: controller.signal,
        attempt: async (signal, index) => {
          const connected = await reconnectAttempt(signal);
          if (!connected && options.quietFirst && index === 0 && !signal.aborted) setConnection("reconnecting");
          return connected;
        },
      }).then((outcome) => {
        if (seriesRef.current !== controller) return;
        seriesRef.current = null;
        setSeriesRunning(false);
        if (outcome === "exhausted") {
          giveUp();
          return;
        }
        if (outcome !== "connected") return;
        setConnection("online");
        const last = messagesRef.current.at(-1);
        if (options.resendUnsent && last?.role === "user" && last.id === unsentMessageId.current) resend();
      });
    },
    [giveUp, reconnectAttempt, resend],
  );

  /** Обрывает серию попыток, если она идёт, и возвращает вкладку в обычное состояние. */
  const cancelSeries = useCallback(() => {
    seriesRef.current?.abort();
    seriesRef.current = null;
    setSeriesRunning(false);
    setConnection("online");
  }, []);

  // Загрузка истории зависит только от того, какой чат открыт, и от «Повторить»: остальное читается в момент загрузки.
  const historyLoad = useRef({ chatId, loadHistory, applyServerHistory, startSeries, pollCompactions });
  historyLoad.current = { chatId, loadHistory, applyServerHistory, startSeries, pollCompactions };
  useEffect(() => {
    const { chatId, loadHistory, applyServerHistory, startSeries, pollCompactions } = historyLoad.current;
    const controller = new AbortController();
    setLoaded(false);
    setLoadFailed(false);
    // Не дошедшее сообщение принадлежит прежнему чату.
    unsentMessageId.current = null;
    setSendFailed(false);
    setNotFound(false);
    setRefusal(null);
    setServerRefusal(null);
    setAccessRefusal(null);
    setSavedModelChoice(null);
    setModelAcceptsImages(undefined);
    setExternalContent(false);
    setCapabilities(ALL_CAPABILITIES);
    setClosed(null);
    setCompactions([]);
    setForks([]);
    setCorrections([]);
    compactionPoll.current?.abort();
    void (async () => {
      const history = await loadHistory(controller.signal);
      if (controller.signal.aborted) return;
      if (history === "unreachable") {
        setConnection("offline");
        return;
      }
      setConnection("online");
      if (history === "not_found") {
        setNotFound(true);
        return;
      }
      // Вход истёк: надпись «Войдите снова» уже стоит, «Повторить» загрузит чат заново.
      if (history === "signed_out" || history === "access_refused") return;
      if (history === "server_error") {
        setLoadFailed(true);
        return;
      }
      setSavedModelChoice(modelChoiceOf(history));
      setLoadedChatId(chatId);
      setLoaded(true);
      if (history.compacting) pollCompactions();
      // Дальше — только показ истории; «идёт ответ» включается, если сервер ещё ведёт ход.
      if (history.running) setResuming(true);
      try {
        const connected = await applyServerHistory(history, [], controller.signal);
        if (!connected && !controller.signal.aborted) startSeries();
      } finally {
        if (!controller.signal.aborted) setResuming(false);
      }
    })();
    return () => controller.abort();
  }, [chatUrl, loadAttempt]);

  // Уход со страницы и смена чата обрывают попытки: ответ на сервере продолжает идти.
  useEffect(() => cancelSeries, [cancelSeries, chatId]);
  // Опрос записей сжатия тоже принадлежит одному чату.
  useEffect(() => () => compactionPoll.current?.abort(), [chatId]);

  /** Собеседник просит связь («Повторить», сеть вернулась): грузим чат или начинаем серию заново. */
  const reconnectNow = useCallback(() => {
    if (!loaded) {
      setConnection("reconnecting");
      setLoadAttempt((attempt) => attempt + 1);
      return;
    }
    startSeries({ resendUnsent: true });
  }, [loaded, startSeries]);

  useEffect(() => {
    if (connection !== "offline") return;
    const onWake = () => {
      if (document.visibilityState !== "hidden") reconnectNow();
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [connection, reconnectNow]);

  const answering = status === "submitted" || status === "streaming";
  answeringRef.current = answering;
  const busy = resuming || seriesRunning || handingOff || connection === "reconnecting" || answering;
  // Голосовой режим зовёт `sendVoiceMessage` из долгоживущего движка: читать занятость надо в момент вызова, а не из замыкания.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const canSubmit = loaded && !busy && !exhausted && !closed && value.trim().length > 0;
  /** Поправку можно отправить: ответ идёт по живому потоку, связь есть. */
  const canSteer = steering && capabilities.steer && loaded && answering && !seriesRunning && connection === "online" && !exhausted && !closed;
  // Сервер окончательно отказал повтору своими словами: тот же повтор получит тот же отказ.
  const canRetry =
    loaded && !busy && !exhausted && !closed && capabilities.retry && connection === "online" && !serverRefusal?.final && isRetryableAnswer(shownMessages.at(-1));

  const chatLifetime = useRef(new AbortController());
  useEffect(() => {
    chatLifetime.current = new AbortController();
    return () => chatLifetime.current.abort();
  }, [chatId]);
  const [approvalPendingId, setApprovalPendingId] = useState<string | null>(null);
  const [approvalFailure, setApprovalFailure] = useState<{ id: string; kind: ApprovalFailureKind; text?: string } | null>(null);
  const approving = useRef(false);

  /**
   * Перечитывает историю с сервера и показывает её; идущий ход подхватывается. `unlessFeedChanged` — для опроса: пока
   * шёл запрос, человек отправил вопрос или нажал «Повторить» — старая история не стирает новое.
   */
  const refreshFromServer = useCallback(
    async (signal: AbortSignal, options: { unlessFeedChanged?: boolean } = {}): Promise<boolean> => {
      const shown = messagesRef.current;
      const history = await loadHistory(signal);
      if (signal.aborted) return true;
      if (options.unlessFeedChanged && (busyRef.current || messagesRef.current !== shown)) return true;
      if (history === "not_found") {
        setNotFound(true);
        return true;
      }
      // Сервер не ответил или ответил сбоем: история не прочитана. Вход и отказ в доступе говорят своими надписями.
      if (history === "unreachable" || history === "server_error") return false;
      if (typeof history === "string") return true;
      const connected = await applyServerHistory(history, messagesRef.current, signal);
      if (!connected && !signal.aborted) startSeries();
      return true;
    },
    [applyServerHistory, loadHistory, startSeries],
  );

  /**
   * Сервер сказал, что ответа или вопроса уже нет (виджет не ждёт, решение уже принято, продолжения нет, хода нет):
   * лента сразу перечитывает историю. Чтение сорвалось (сервер под нагрузкой) — серия попыток, а не застывшая лента.
   */
  const rereadHistory = useCallback(
    async (signal: AbortSignal) => {
      const read = await refreshFromServer(signal);
      if (!read && !signal.aborted) startSeries({ quietFirst: true });
    },
    [refreshFromServer, startSeries],
  );

  browserCallGoneRef.current = () => {
    if (!busyRef.current) void rereadHistory(chatLifetime.current.signal);
  };

  const shownReloadKey = useRef(reloadKey);
  useEffect(() => {
    if (shownReloadKey.current === reloadKey) return;
    shownReloadKey.current = reloadKey;
    void refreshFromServer(chatLifetime.current.signal);
  }, [reloadKey, refreshFromServer]);

  // Ответ идёт без живого потока: история перечитывается, пока сервер не прервёт его. Сервер так и не ответил итогом —
  // ответ прерывается на экране, и человек может нажать «Повторить» без перезагрузки страницы.
  useEffect(() => {
    if (detachedSince === null || busy) return;
    const signal = chatLifetime.current.signal;
    const giveUpAt = detachedSince + DETACHED_ANSWER_GIVE_UP_MS;
    const timer = setTimeout(
      () => {
        if (Date.now() >= giveUpAt) {
          setDetachedSince(null);
          setMessages((current) => (isFinalStatus(lastAnswerStatus(current)) ? current : withLastAnswerStatus(current, "interrupted")));
          return;
        }
        void refreshFromServer(signal, { unlessFeedChanged: true }).finally(() => {
          if (!signal.aborted) setDetachedChecks((count) => count + 1);
        });
      },
      Math.min(DETACHED_ANSWER_CHECK_EVERY_MS, Math.max(0, giveUpAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [busy, detachedChecks, detachedSince, refreshFromServer, setMessages]);
  // Другой чат — свои проверки: ожидание прежнего чата не переносится.
  useEffect(() => setDetachedSince(null), [chatId]);


  const respondToApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      if (approving.current) return;
      approving.current = true;
      const signal = chatLifetime.current.signal;
      setApprovalFailure(null);
      setApprovalPendingId(approvalId);
      try {
        let response: Response;
        try {
          response = await fetchWithDeadline(
            request,
            `${chatUrl}/approvals/${encodeURIComponent(approvalId)}`,
            { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, ...pageFields(bridgeRef.current) }) },
            { timeoutMs: settingsRef.current.requestTimeoutMs, wholeBody: true },
          );
        } catch {
          setApprovalFailure({ id: approvalId, kind: "connection" });
          return;
        }
        // Приложение не пустило ход (или человека): его слова у карточки, а не «нет связи».
        const refusedByApp = response.ok ? null : await serverRefusalOf(response);
        if (refusedByApp?.kind) {
          announceAppRefusal(refusedByApp);
          setApprovalFailure({ id: approvalId, kind: "refused", text: refusedByApp.text });
          return;
        }
        if (response.status === 429) {
          // Лимит исчерпан: запрос остаётся ждать, поле ввода блокируется, как при отказе на отправку.
          const refusal = await spendingRefusalOf(response);
          if (refusal && !signal.aborted) setSpending({ state: "exhausted", info: refusal });
          const tooManyTurns = !refusal && (await errorKindOf(response)) === "too_many_turns";
          setApprovalFailure({ id: approvalId, kind: refusal ? "spending_limit" : tooManyTurns ? "too_many_turns" : "connection" });
          return;
        }
        // Чат занят другим ходом: запрос жив, ответить можно чуть позже.
        if (response.status === 409 && (await errorKindOf(response)) === "busy") {
          setApprovalFailure({ id: approvalId, kind: "busy" });
          return;
        }
        // Запрос уже решён (на другом устройстве) или закрыт новым сообщением: показываем то, что на сервере.
        if (response.status === 409 || response.status === 404) {
          await rereadHistory(signal);
          return;
        }
        if (!response.ok) {
          setApprovalFailure({ id: approvalId, kind: "connection" });
          return;
        }
        const { resumed } = (await response.json()) as { resumed: boolean };
        setMessages((current) => withApprovalDecision(current, approvalId, decision, resumed));
        if (!resumed) return;
        setResuming(true);
        try {
          const outcome = await resumeWithProbe(signal);
          if (outcome === "nothing") await rereadHistory(signal);
          else if (outcome === "failed" && !signal.aborted) startSeries();
        } finally {
          if (!signal.aborted) setResuming(false);
        }
      } finally {
        approving.current = false;
        if (!signal.aborted) setApprovalPendingId(null);
      }
    },
    [announceAppRefusal, chatUrl, request, rereadHistory, resumeWithProbe, setMessages, startSeries],
  );

  const { answerWidget, widgetPendingId, widgetFailure, answeringWidget } = useWidgetAnswer({
    chatUrl,
    request,
    requestTimeoutMs: () => settingsRef.current.requestTimeoutMs,
    pageFields: () => pageFields(bridgeRef.current),
    chatSignal: () => chatLifetime.current.signal,
    setMessages,
    setResuming,
    resumeWithProbe,
    rereadHistory,
    expectLiveEventsOf: (toolCallId) => {
      const answer = messagesRef.current.find((message) => message.parts.some((part) => (part as { toolCallId?: unknown }).toolCallId === toolCallId));
      if (answer) onExpectLiveAppEvents?.(answer.id);
    },
    startSeries,
    announceAppRefusal,
    spendingRefusalOf,
    showSpendingExhausted: (info) => setSpending({ state: "exhausted", info }),
    errorKindOf,
  });

  const ownTurnStarting = useCallback(
    () => busyRef.current || sending.current || approving.current || answeringWidget(),
    [answeringWidget],
  );

  // Подписка на события чата, пока ответ не идёт: ход, начатый не из этой вкладки (фон, мессенджер, другая вкладка),
  // подхватывается тем же путём, что после перезагрузки; изменения задач поднимают `tasksVersion`. Пока подписка была
  // закрыта, события терялись: каждое открытие перечитывает историю. Ход, который начал свой запрос этой вкладки
  // (сообщение, ответ на подтверждение или виджет), подключает сам запрос: второе подключение дописало бы ответ заново.
  // При «Нет связи с сервером» к ходу подключает «Повторить», а не открытие подписки.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const [tasksVersion, setTasksVersion] = useState(0);
  // Состояние из события `state-changed` (сменила другая вкладка): верно, пока лента та же; новая лента — снова свёртка.
  const [watchedChatState, setWatchedChatState] = useState<{ values: ChatStateValues; over: AgentChatMessage[] } | null>(null);
  const shownMessagesRef = useRef(shownMessages);
  shownMessagesRef.current = shownMessages;
  const watchUnavailableFor = useRef<string | null>(null);
  const reportAppEvent = useRef(onAppEvent);
  reportAppEvent.current = onAppEvent;
  useEffect(() => {
    if (!loaded || busy || notFound || watchUnavailableFor.current === chatUrl) return;
    const chatSignal = chatLifetime.current.signal;
    const watch = new AbortController();
    const stopWatch = () => watch.abort();
    chatSignal.addEventListener("abort", stopWatch, { once: true });
    void watchChat({
      url: `${chatUrl}/watch`,
      fetch: request,
      signal: watch.signal,
      delaysMs: settingsRef.current.reconnectDelaysMs,
      silenceTimeoutMs: settingsRef.current.silenceTimeoutMs,
      onOpen: () => {
        setTasksVersion((version) => version + 1);
        if (!ownTurnStarting() && connectionRef.current !== "offline") void refreshFromServer(chatSignal, { unlessFeedChanged: true });
      },
      onEvent: (event) => {
        if (event.type === "tasks-changed") setTasksVersion((version) => version + 1);
        else if (event.type === "chat-closed") showClosure(closureOf(event.closed));
        else if (event.type === "chat-reopened") showClosure(null);
        else if (event.type === "state-changed") {
          const values = chatStateOfEvent(event.state);
          if (values) setWatchedChatState({ values, over: shownMessagesRef.current });
        }
        else if (event.type === "app-event") {
          const appEvent = appEventOf(event.event);
          const messageId = typeof event.messageId === "string" ? event.messageId : undefined;
          if (appEvent) reportAppEvent.current?.(appEvent, messageId);
          // Событие хука после «Стопа» уже лежит в ответе: перечитанная история покажет его в ленте.
          if (appEvent && messageId && !ownTurnStarting()) void refreshFromServer(chatSignal, { unlessFeedChanged: true });
        } else if ((event.type === "turn-started" || event.type === "notice-added") && !ownTurnStarting()) {
          void refreshFromServer(chatSignal, { unlessFeedChanged: true });
        }
      },
    }).then((end) => {
      if (end === "unavailable") watchUnavailableFor.current = chatUrl;
    });
    return () => {
      chatSignal.removeEventListener("abort", stopWatch);
      watch.abort();
    };
  }, [busy, chatUrl, loaded, notFound, ownTurnStarting, refreshFromServer, request, showClosure]);
  useEffect(() => setTasksVersion(0), [chatId]);

  /** Ответ, ждавший человека, закрывается новым сообщением: запомнить, каким он был, чтобы вернуть при отказе. */
  function closeAwaitingBySend() {
    const awaiting = messagesRef.current.at(-1);
    approvalsClosedBySubmit.current = awaiting?.metadata?.status === "awaiting_approval" ? awaiting : null;
    setMessages((current) => withPendingApprovalsDenied(withPendingWidgetsClosed(current)));
  }

  /** Сообщение не ушло (нет связи, 409, 400): запрос и виджет на сервере всё ещё ждут, ответ возвращается как был. */
  function restoreAwaitingAfterSend() {
    const closed = approvalsClosedBySubmit.current;
    if (!closed) return;
    approvalsClosedBySubmit.current = null;
    setMessages((current) => current.map((item) => (item.id === closed.id ? closed : item)));
  }

  /**
   * Сообщение человека с текстом и файлами. Вместо ответа на запрос или виджет: сервер закроет запрос как отклонённый,
   * а виджет — пометкой «ответ дан сообщением»; лента показывает то же сразу.
   */
  const sendTyped = useCallback(
    (message: { text?: string; files?: FileUIPart[] }, text: string, onRejected?: (kind: string | undefined) => void) => {
      sending.current = true;
      setSendFailed(false);
      // Новое сообщение вместо «Повторить»: не дошедшее больше не держится в ленте поверх истории сервера.
      unsentMessageId.current = null;
      closeAwaitingBySend();
      rejectedSend.current = null;
      void sendMessage(message as Parameters<typeof sendMessage>[0]).finally(() => {
        sending.current = false;
        restoreAwaitingAfterSend();
        const rejection = rejectedSend.current;
        if (!rejection) return;
        // Сервер не принял сообщение (например, файл устарел): в ленте его нет, текст и файлы возвращаются в поле.
        rejectedSend.current = null;
        setMessages((current) => current.filter((item) => item.id !== rejection.messageId));
        setValue((current) => (current.length === 0 ? text : current));
        onRejected?.(rejection.kind);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeAwaitingBySend и restoreAwaitingAfterSend трогают только ref и setMessages
    [sendMessage, setMessages],
  );

  /**
   * Ответ кончился, а поправки ждут: дождаться их запросов (и «Стопа», если он идёт), перечитать историю и подключиться
   * к ходу по ним. Пока это идёт, вкладка занята: обычная отправка не влезает между ответами.
   */
  const handOffToCorrections = useCallback(() => {
    if (handOff.current) return handOff.current;
    const signal = chatLifetime.current.signal;
    setHandingOff(true);
    const run = (async () => {
      await steerQueue.current;
      await stopping.current;
      if (!signal.aborted) await refreshFromServer(signal);
    })().finally(() => {
      handOff.current = null;
      if (!signal.aborted) setHandingOff(false);
    });
    handOff.current = run;
    return run;
  }, [refreshFromServer]);
  handOffToCorrectionsRef.current = handOffToCorrections;

  /**
   * Поправка во время ответа: сразу в ленте с пометкой, на сервер — по очереди. Отказ убирает её и возвращает текст в
   * поле. Сервер принял, а поток ответа уже кончился (или ход начат самой поправкой) — вкладка подключается к ходу.
   */
  const sendCorrection = useCallback(
    (text: string, files: readonly FileUIPart[], onRejected?: (kind: string | undefined) => void) => {
      const asked = chatUrl;
      const filesKey = JSON.stringify(files.map((file) => file.url));
      const unconfirmed = unconfirmedCorrection.current;
      const repeated = unconfirmed?.chatUrl === asked && unconfirmed.text === text && unconfirmed.files === filesKey;
      unconfirmedCorrection.current = null;
      const correction = correctionMessage(repeated ? unconfirmed.id : crypto.randomUUID(), text, files);
      const signal = chatLifetime.current.signal;
      sendingCorrections.current.add(correction.id);
      setCorrections((current) => [...current, correction]);
      const refused = (kind: string | undefined) => {
        setCorrections((current) => current.filter((item) => item.id !== correction.id));
        setValue((current) => (current.length === 0 ? text : current));
        onRejected?.(kind);
      };
      const sent = steerQueue.current.then(async () => {
        let response: Response;
        try {
          response = await fetchWithDeadline(
            request,
            `${asked}/steer`,
            { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: outgoingCorrection(correction), ...pageFields(bridgeRef.current) }) },
            { timeoutMs: settingsRef.current.requestTimeoutMs, wholeBody: true },
          );
        } catch {
          if (signal.aborted) return;
          unconfirmedCorrection.current = { chatUrl: asked, id: correction.id, text, files: filesKey };
          refused("connection");
          return;
        } finally {
          sendingCorrections.current.delete(correction.id);
        }
        if (signal.aborted || chatUrlRef.current !== asked) return;
        if (!response.ok) {
          const spendingLimit = response.status === 429 ? await spendingRefusalOf(response) : null;
          if (spendingLimit) setSpending({ state: "exhausted", info: spendingLimit });
          const refusedWithText = await serverRefusalOf(response);
          announceAppRefusal(refusedWithText);
          refused(spendingLimit ? "spending_limit" : (refusedWithText?.kind ?? (await errorKindOf(response))));
          return;
        }
        if (!answeringRef.current) void handOffToCorrectionsRef.current();
      });
      steerQueue.current = sent.catch(() => undefined);
    },
    [announceAppRefusal, chatUrl, request],
  );

  const submit = useCallback((files?: readonly FileUIPart[], onRejected?: (kind: string | undefined) => void): boolean => {
    const hasFiles = Boolean(files && files.length > 0);
    if (canSteer && (hasFiles || value.trim().length > 0)) {
      const text = value;
      setValue("");
      sendCorrection(text, files ?? [], onRejected);
      return true;
    }
    // Файлы уже загружены и лежат на сервере: их отправка не ждёт истории и не откладывается.
    if (!hasFiles && !loaded && !busy && value.trim().length > 0) {
      setSubmitWhenLoaded(true);
      return false;
    }
    if (sending.current || !loaded || busy || exhausted || closed || (!hasFiles && !canSubmit)) return false;
    const text = value;
    setValue("");
    sendTyped({ ...(text.trim().length > 0 && { text }), ...(hasFiles && { files: [...files!] }) }, text, onRejected);
    return true;
  }, [busy, canSubmit, closed, exhausted, loaded, canSteer, sendCorrection, sendTyped, value]);

  const sendReply = useCallback(
    (text: string): boolean => {
      if (sending.current || !loaded || busyRef.current || exhausted || closed || text.trim().length === 0) return false;
      sendTyped({ text }, text);
      return true;
    },
    [closed, exhausted, loaded, sendTyped],
  );

  useEffect(() => {
    if (!loaded || !submitWhenLoaded) return;
    setSubmitWhenLoaded(false);
    submit();
  }, [loaded, submit, submitWhenLoaded]);

  const sendVoiceMessage = useCallback(
    (text: string, options?: { sounds?: readonly VoiceSound[] }): boolean => {
      if (sending.current || !loaded || busyRef.current || exhausted || closed || !capabilities.voice || text.trim().length === 0) return false;
      // Ответ ждёт подтверждения инструмента: слова не должны его отклонить, подтверждает только человек кнопкой.
      // Ждущий виджет слова закрывают, как сообщение из поля.
      if (hasPendingApproval(messagesRef.current)) return false;
      sending.current = true;
      setSendFailed(false);
      // Новое сообщение вместо «Повторить»: не дошедшее больше не держится в ленте поверх истории сервера.
      unsentMessageId.current = null;
      closeAwaitingBySend();
      rejectedSend.current = null;
      const id = crypto.randomUUID();
      voiceMessageIds.current.add(id);
      if (options?.sounds?.length) voiceSoundsById.current.set(id, options.sounds);
      // Отметка стоит в самом сообщении, как у сохранённого: по ней экран узнаёт голосовой ход и прячет теги в ответе.
      void sendMessage({ id, role: "user", parts: [{ type: "text", text }, { type: VOICE_MODE_PART_TYPE, data: true }] }).finally(() => {
        sending.current = false;
        restoreAwaitingAfterSend();
        const rejection = rejectedSend.current;
        if (!rejection) return;
        // Сервер не принял сообщение: возвращать в поле нечего, в ленте его нет.
        rejectedSend.current = null;
        voiceMessageIds.current.delete(rejection.messageId ?? id);
        voiceSoundsById.current.delete(rejection.messageId ?? id);
        setMessages((current) => current.filter((item) => item.id !== rejection.messageId));
      });
      return true;
    },
    [capabilities.voice, closed, exhausted, loaded, sendMessage, setMessages],
  );

  /*
   * Отметки обрыва озвучки лежат отдельно от сообщений и накладываются при выдаче: пока остановка доходит до сервера, идущий поток
   * ещё дописывает ответ и каждым куском заменяет сообщение своей копией, без отметки. Отметка в самом сообщении от этого пропадала.
   */
  const [voiceCuts, setVoiceCuts] = useState<{ chatUrl: string; byMessageId: Record<string, VoiceCut> }>({ chatUrl, byMessageId: {} });
  const showVoiceCut = useCallback(
    (messageId: string, cut: VoiceCut) => {
      setVoiceCuts((current) => ({ chatUrl, byMessageId: { ...(current.chatUrl === chatUrl ? current.byMessageId : {}), [messageId]: cut } }));
    },
    [chatUrl],
  );
  const messages = useMemo(() => {
    const cuts = voiceCuts.chatUrl === chatUrl ? voiceCuts.byMessageId : {};
    if (Object.keys(cuts).length === 0) return shownMessages;
    return shownMessages.map((message) => {
      const cut = cuts[message.id];
      return cut && message.role === "assistant" && !message.metadata?.voiceCut ? { ...message, metadata: { ...message.metadata, voiceCut: cut } } : message;
    });
  }, [shownMessages, chatUrl, voiceCuts]);
  // То же состояние — тот же объект: экран не перерисовывается, `onStateChange` не зовётся повторно.
  const lastChatState = useRef<ChatStateValues>(foldChatState([]));
  const chatState = useMemo(() => {
    const next = watchedChatState?.over === shownMessages ? watchedChatState.values : foldChatState(shownMessages);
    if (!sameChatState(lastChatState.current, next)) lastChatState.current = next;
    return lastChatState.current;
  }, [shownMessages, watchedChatState]);

  /*
   * Состояние загруженного чата — панелям страницы (`useChatState(chatId)`): один источник, без своих запросов. Только
   * состояние, загруженное именно для этого `chatId`: после смены чата без `key` флаг `loaded` ещё один проход остаётся
   * от прежнего чата, а пока история нового грузится, панель видит пусто.
   */
  const publishedState = useRef<ReturnType<typeof publishChatState> | null>(null);
  const loadedChatState = loaded && loadedChatId === chatId ? chatState : null;
  const chatStateRef = useRef(loadedChatState);
  chatStateRef.current = loadedChatState;
  const published = loadedChatState !== null;
  useEffect(() => {
    if (!published || chatStateRef.current === null) return;
    const publication = publishChatState(chatId, chatStateRef.current);
    publishedState.current = publication;
    return () => {
      publishedState.current = null;
      publication.remove();
    };
  }, [chatId, published]);
  useEffect(() => {
    if (loadedChatState !== null) publishedState.current?.update(loadedChatState);
  }, [loadedChatState]);

  /** Идущий «стоп»: повторное нажатие ждёт его же, второго запроса не будет. */
  const stopping = useRef<Promise<void> | null>(null);
  const stop = useCallback(() => {
    if (stopping.current) return stopping.current;
    // Попытки переподключения отменяются: собеседник сказал «стоп», ждать связи не нужно.
    if (seriesRef.current) cancelSeries();
    browserCallsLifetime.current?.abort();
    browserCallsLifetime.current = null;
    const stopped = (async () => {
      await fetchWithDeadline(request, `${chatUrl}/stop`, { method: "POST" }, {
        timeoutMs: settingsRef.current.requestTimeoutMs,
        wholeBody: true,
      }).catch(() => undefined);
      await stopChat();
      setMessages((messages) => markLastAnswerStopped(messages));
    })().finally(() => {
      stopping.current = null;
    });
    stopping.current = stopped;
    return stopped;
  }, [cancelSeries, chatUrl, request, setMessages, stopChat]);

  const retry = useCallback(() => {
    if (connection === "offline") {
      reconnectNow();
      return;
    }
    if (loadFailed || accessRefusal || (refusal === "signed_out" && !loaded)) {
      setLoadAttempt((attempt) => attempt + 1);
      return;
    }
    if (refusal === "signed_out" && !busy) {
      // Человек вошёл снова: лента — с сервера; если вход всё ещё истёк, надпись останется.
      void refreshFromServer(chatLifetime.current.signal);
      return;
    }
    if (!loaded || busy || !(sendFailed || canRetry)) return;
    resend();
  }, [accessRefusal, busy, canRetry, connection, loadFailed, loaded, reconnectNow, refreshFromServer, refusal, resend, sendFailed]);

  const canRegenerate =
    loaded && !busy && !exhausted && capabilities.regenerate && connection === "online" && !sendFailed && isRegenerableAnswer(shownMessages.at(-1)) && shownMessages.some(isHumanMessage);
  const canEdit = loaded && !busy && !exhausted && capabilities.edit && connection === "online";

  const regenerateAnswer = useCallback(() => {
    const last = messagesRef.current.at(-1);
    if (!canRegenerate || last?.role !== "assistant" || sending.current) return;
    regeneratedAnswerId.current = last.id;
    forksMayChange.current = true;
    resend();
  }, [canRegenerate, resend]);

  /** Отправка правки: сообщение с новым id, прежнее и всё после него уходят с экрана (соседняя ветка). Проверки занятости — у вызывающего. */
  const startEdit = useCallback(
    (messageId: string, text: string, voice: boolean, sounds?: readonly VoiceSound[]): Promise<EditOutcome> => {
      const original = messagesRef.current.find((message) => message.id === messageId);
      const index = messagesRef.current.findIndex((message) => message.id === messageId);
      // Файлы сообщения при правке остаются как были; без них пустой текст — не сообщение.
      const files = original?.parts.filter((part): part is FileUIPart => part.type === "file") ?? [];
      const hasText = text.trim().length > 0;
      sending.current = true;
      const before = messagesRef.current;
      return new Promise<EditOutcome>((resolve) => {
        const edited: PendingEdit = {
          messageId: crypto.randomUUID(),
          editedMessageId: messageId,
          refusal: null,
          answered: (refusal) => {
            if (!refusal) resolve({ status: "started" });
          },
        };
        pendingEdit.current = edited;
        forksMayChange.current = true;
        if (voice) voiceMessageIds.current.add(edited.messageId);
        if (voice && sounds?.length) voiceSoundsById.current.set(edited.messageId, sounds);
        setSendFailed(false);
        // Прежнее сообщение и всё после него уходят с экрана: это соседняя ветка, она вернётся переключателем.
        setMessages(before.slice(0, index));
        const parts = [...files, ...(hasText ? [{ type: "text" as const, text }] : []), ...(voice ? [{ type: VOICE_MODE_PART_TYPE, data: true } as const] : [])];
        void sendMessage({ id: edited.messageId, role: "user", parts }).finally(() => {
          sending.current = false;
          if (edited.refusal) {
            // Сервер отказал: всё возвращается как было, ничего не отправлено.
            if (pendingEdit.current === edited) pendingEdit.current = null;
            forksMayChange.current = false;
            voiceMessageIds.current.delete(edited.messageId);
            voiceSoundsById.current.delete(edited.messageId);
            setMessages(before);
            resolve({
              status: "refused",
              reason: edited.refusal,
              ...(edited.refusalText && { text: edited.refusalText }),
              ...(edited.refusalCode && { code: edited.refusalCode }),
              ...(edited.refusalUnit && { unit: edited.refusalUnit }),
            });
            return;
          }
          // Запрос ушёл, но ответа не было (обрыв связи): дальше работает серия попыток и «Повторить».
          resolve({ status: "started" });
        });
      });
    },
    [sendMessage, setMessages],
  );

  const edit = useCallback(
    async (messageId: string, text: string): Promise<EditOutcome> => {
      if (sending.current || busy) return { status: "not_started", reason: "busy" };
      if (!canEdit) return { status: "not_started", reason: "offline" };
      const original = messagesRef.current.find((message) => message.id === messageId);
      if (!original || original.role !== "user") return { status: "not_started", reason: "unknown_message" };
      const hasFiles = original.parts.some((part) => part.type === "file");
      if (text.trim().length === 0 && !hasFiles) return { status: "not_started", reason: "empty" };
      return startEdit(messageId, text, false);
    },
    [busy, canEdit, startEdit],
  );

  /** Очередь замен: вторая начинается, когда первая закончена. */
  const replacing = useRef<Promise<unknown>>(Promise.resolve());

  const replaceLastVoiceMessage = useCallback(
    (text: string, options?: { sounds?: readonly VoiceSound[] }): Promise<boolean> => {
      const run = replacing.current.then(async (): Promise<boolean> => {
        const signal = chatLifetime.current.signal;
        const messages = messagesRef.current;
        const index = messages.findLastIndex((message) => message.role === "user");
        const target = messages[index];
        if (!loaded || exhausted || !target || !voiceMessageIds.current.has(target.id) || text.trim().length === 0) return false;
        // Заменять можно только то, что для человека и модели ничего не значит: ответа нет или он из одного размышления.
        if (!messages.slice(index + 1).every(isEmptyAnswer)) return false;
        const original = messages;
        // Экран не ждёт остановки: склеенный текст виден сразу, «Так.» и пустой ответ не мелькают.
        setMessages([...messages.slice(0, index), { ...target, parts: [{ type: "text", text }, { type: VOICE_MODE_PART_TYPE, data: true }] }]);
        await stop();
        if (!(await untilIdle(signal))) return restoreAfterFailure(original);
        for (let attempt = 0; attempt < REPLACE_ATTEMPTS; attempt++) {
          const outcome = await startEdit(target.id, text, true, options?.sounds);
          if (outcome.status === "started") return true;
          // Остановка на сервере ещё доделывается: ход чата занят. Ждём и пробуем снова.
          if (!(outcome.status === "refused" && outcome.reason === "busy")) break;
          await pause(REPLACE_RETRY_MS, signal);
        }
        return restoreAfterFailure(original);
      });
      replacing.current = run.catch(() => false);
      return run;
    },
    [exhausted, loaded, refreshFromServer, setMessages, startEdit, stop],
  );

  /** Склейка не вышла: на экране то, что хранит сервер, а не наша догадка. */
  function restoreAfterFailure(original: AgentChatMessage[]): boolean {
    setMessages(original);
    void refreshFromServer(chatLifetime.current.signal);
    return false;
  }

  /** Ждёт, пока чат освободится после остановки (отрисовка с `busy: false` уже была). `false` — не дождались. */
  async function untilIdle(signal: AbortSignal): Promise<boolean> {
    for (let waited = 0; waited <= IDLE_WAIT_MS; waited += IDLE_POLL_MS) {
      if (signal.aborted) return false;
      if (!busyRef.current && !sending.current) return true;
      await pause(IDLE_POLL_MS, signal);
    }
    return false;
  }

  /** Переключение ветки: сервер записывает выбор и отдаёт историю новой ветки; на отказ — свежая история. */
  const selectBranch = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!loaded || busy || connection !== "online" || !capabilities.branches) return false;
      const applyHistory = (history: ServerHistory) => {
        applyAccess(history);
        setMessages(history.messages);
        setCompactions(history.compactions ?? []);
        setForks(history.forks ?? []);
      };
      try {
        const response = await fetchWithDeadline(
          request,
          `${chatUrl}/branch`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId }) },
          { timeoutMs: settingsRef.current.requestTimeoutMs, wholeBody: true },
        );
        if (chatUrlRef.current !== chatUrl) return false;
        if (response.ok) {
          applyHistory((await response.json()) as ServerHistory);
          return true;
        }
        // Чат изменился с другой вкладки или ответ начался: показываем то, что есть на сервере.
        const fresh = await loadHistory();
        if (typeof fresh !== "string" && chatUrlRef.current === chatUrl) applyHistory(fresh);
        return false;
      } catch {
        // Связь пропала: экран остаётся как был, следующее действие покажет «Нет связи».
        return false;
      }
    },
    [applyAccess, busy, capabilities.branches, chatUrl, connection, loadHistory, loaded, request, setMessages],
  );

  return {
    messages,
    compactions,
    forks,
    loaded,
    value,
    setValue,
    canSubmit,
    canSteer,
    corrections,
    busy,
    submit,
    stop,
    sendVoiceMessage,
    showVoiceCut,
    replaceLastVoiceMessage,
    canRetry,
    sendFailed,
    loadFailed,
    notFound,
    savedModelChoice,
    modelAcceptsImages,
    externalContent,
    connection,
    retry,
    selectBranch,
    canRegenerate,
    regenerate: regenerateAnswer,
    canEdit,
    edit,
    respondToApproval,
    approvalPendingId,
    approvalFailure,
    answerWidget,
    widgetPendingId,
    widgetFailure,
    sendReply,
    spending,
    refusal,
    accessRefusal,
    serverRefusal,
    tasksVersion,
    backgroundTasksAvailable,
    capabilities,
    closed,
    chatState,
  };
}

interface ApprovalToolPart {
  type: string;
  state?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
}

/*
 * ВНИМАНИЕ: приём с `input-streaming`. Продолжение хода после подтверждения дописывается в то же сообщение, но
 * `useChat.resumeStream` из `@ai-sdk/react` подхватывает готовое сообщение только тогда, когда в нём есть вызов
 * инструмента в состоянии `input-streaming`; иначе он начинает новое сообщение и прежние части пропадают из ленты.
 * Поэтому части с принятым решением, пока идёт продолжение, помечаются `input-streaming` (`withApprovalDecision`,
 * `withContinuationMarked`), а как только приходит результат, поток сам переводит их в `output-available` / `output-denied`.
 * Это поведение SDK не описано в его документации: версии `ai` и `@ai-sdk/react` закреплены точно, менять их только
 * вместе с прогоном tests/agent-chat-approval.test.tsx. Оборванный ход не оставляет вызов «в пути»: `hasStalledContinuation`.
 */

/** Часть с решением человека; пока ход не продолжился, вызов остаётся без результата. */
function withApprovalDecision(
  messages: AgentChatMessage[],
  approvalId: string,
  decision: ApprovalDecision,
  resumed: boolean,
): AgentChatMessage[] {
  const decidedHere = (part: AgentChatMessage["parts"][number]) =>
    (part as ApprovalToolPart).approval?.id === approvalId || pendingHelperApprovalId(part as { output?: unknown }) === approvalId;
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.parts.some(decidedHere)) return message;
    const parts = message.parts.map((part) => {
      if (!decidedHere(part)) return part;
      const helper = helperProgressOf(part as { output?: unknown });
      if (helper) {
        // Подтверждение внутри помощника: вызов помощника ждёт продолжения, решение видно в его строке.
        const { pendingApproval: _answered, ...rest } = helper;
        const decided = decision === "deny" ? "denied" : decision === "always" ? "always" : "allowed";
        return { ...part, ...(resumed && { state: "input-streaming" }), output: { ...rest, status: "running", decided } } as typeof part;
      }
      return {
        ...part,
        // Продолжение хода дописывает то же сообщение: SDK так делает, только если в нём есть вызов «в пути».
        state: resumed ? "input-streaming" : "approval-responded",
        approval: {
          id: approvalId,
          approved: decision !== "deny",
          ...(decision === "always" && { reason: ALWAYS_IN_CHAT }),
        },
      } as typeof part;
    });
    return { ...message, parts, ...(resumed && { metadata: { ...message.metadata, status: "streaming" as const } }) };
  });
}

/** Вызов после решения всё ещё помечен «в пути» (`input-streaming`), хотя поток кончился. */
function hasStalledContinuation(messages: AgentChatMessage[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    last.parts.some(
      (part) =>
        (part as ApprovalToolPart).state === "input-streaming" &&
        (Boolean((part as ApprovalToolPart).approval) || helperProgressOf(part as { output?: unknown })?.decided !== undefined),
    )
  );
}

/**
 * Ответ, у которого решения уже получены и ход продолжается: сообщение уже есть в ленте,
 * поток дописывает его. SDK подхватывает готовое сообщение, только если в нём есть вызов «в пути».
 */
function withContinuationMarked(messages: AgentChatMessage[]): AgentChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.parts.some(continuesInStream)) return messages;
  const parts = last.parts.map((part) => (continuesInStream(part) ? ({ ...part, state: "input-streaming" } as typeof part) : part));
  return [...messages.slice(0, -1), { ...last, parts }];
}

/** Вызов, который допишет продолжение хода: решение по подтверждению получено или помощник ещё работает. */
function continuesInStream(part: AgentChatMessage["parts"][number]): boolean {
  const { state } = part as ApprovalToolPart;
  if (state === "approval-responded") return true;
  const helper = helperProgressOf(part as { output?: unknown });
  return helper !== undefined && (part as { preliminary?: boolean }).preliminary === true && helper.status === "running";
}

/** Все запросы последнего ответа без решения показаны отклонёнными: человек написал новое сообщение. */
function withPendingApprovalsDenied(messages: AgentChatMessage[]): AgentChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.metadata?.status !== "awaiting_approval") return messages;
  const parts = last.parts.map((part) => {
    if ((part as ApprovalToolPart).state === "approval-requested" || (part as ApprovalToolPart).state === "approval-responded") {
      return { ...part, state: "output-denied", approval: { id: (part as ApprovalToolPart).approval!.id, approved: false } } as typeof part;
    }
    const helper = pendingHelperApprovalId(part as { output?: unknown }) ? helperProgressOf(part as { output?: unknown }) : undefined;
    if (!helper) return part;
    const { pendingApproval: _closed, ...rest } = helper;
    return { ...part, output: { ...rest, status: "failed", decided: "denied" } } as typeof part;
  });
  return [...messages.slice(0, -1), { ...last, parts, metadata: { ...last.metadata, status: "complete" as const } }];
}

/** Сервер чата не признал страницу своей: 403 и `forbidden_origin` в теле. */
async function isForbiddenOrigin(response: Response): Promise<boolean> {
  return response.status === 403 && (await errorKindOf(response)) === "forbidden_origin";
}

/** Сборщик приложения подставляет `process.env.NODE_ENV`; нет ни сборщика, ни `process` — подсказку не показываем. */
function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

/** Подсказка разработчику в консоли: адрес страницы, который сервер не признал. */
function forbiddenOriginHint(): string {
  const origin = typeof location === "undefined" ? "https://your-frontend.example" : location.origin;
  return (
    `Agent Chat: the chat server refused a write from ${origin} (403 forbidden_origin). ` +
    `If the frontend and the API live on different origins, add this origin to the server's allowedOrigins, ` +
    `e.g. createChatHandler({ allowedOrigins: ["${origin}"] }) or a subdomain pattern like "https://*.example.com". ` +
    `Behind a proxy, also pass Host / X-Forwarded-Host through to the server.`
  );
}

/** Тело отказа 429 «лимит исчерпан»; `null` — это другой отказ, с ним разбирается обычная обработка ошибок. */
async function errorKindOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { error?: { kind?: unknown } };
    return typeof body.error?.kind === "string" ? body.error.kind : undefined;
  } catch {
    return undefined;
  }
}

async function spendingRefusalOf(response: Response): Promise<SpendingInfo | null> {
  try {
    const body = (await response.clone().json()) as { error?: { kind?: string } & Record<string, unknown> };
    return body.error?.kind === "spending_limit_reached" ? spendingInfoOf(body.error as Parameters<typeof spendingInfoOf>[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Сообщение человека: не служебное сообщение сервера и не запись состояния. Ответ, перед которым такого нет (приветствие),
 * переделать нельзя — сервер откажет. Держать в синхроне с `isHumanMessage` в core (`agent-run/channel-notes.ts`):
 * пакет react от core не зависит.
 */
function isHumanMessage(message: AgentChatMessage): boolean {
  return (
    message.role === "user" &&
    !message.parts.some((part) => part.type === AGENT_NOTICE_PART_TYPE) &&
    !(message.parts.length > 0 && message.parts.every((part) => part.type === APP_STATE_PART_TYPE))
  );
}

/**
 * Ответ, который можно переделать кнопкой «Переделать»: законченный и непустой. Оборванный — тоже, если «Повторить»
 * продолжит его с вызовов инструментов: тогда «Переделать» — способ начать с чистого листа. Без вызовов «Повторить»
 * и так пишет заново, вторая кнопка не нужна.
 */
function isRegenerableAnswer(message: AgentChatMessage | undefined): boolean {
  if (message?.role !== "assistant") return false;
  const status = message.metadata?.status;
  if (status === "error" || status === "stopped" || status === "interrupted") return message.parts.some(isContinuedToolCall);
  return status === "complete" && !isRetryableAnswer(message);
}

/** Вызов, с которого сервер продолжит оборванный ответ по «Повторить»: запущенный или с итогом (`partsForContinuation`). */
function isContinuedToolCall(part: AgentChatMessage["parts"][number]): boolean {
  if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return false;
  const { state } = part as { state?: string };
  return state === "input-available" || state === "output-available" || state === "output-error" || state === "output-denied";
}

function modelChoiceOf({ chat }: ServerHistory): ChatModelChoice | null {
  if (typeof chat?.modelId !== "string" || typeof chat.providerId !== "string") return null;
  return { modelId: chat.modelId, providerId: chat.providerId, ...(typeof chat.reasoning === "string" && { reasoning: chat.reasoning }) };
}

/** Итог ответа уже известен: всё, кроме «идёт». */
const isFinalStatus = (status: AnswerStatus | undefined) => status !== undefined && status !== "streaming";

function lastAnswerStatus(messages: readonly AgentChatMessage[]): AnswerStatus | undefined {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last.metadata?.status : undefined;
}

/** Та же мерка, что у сервера: ошибка, стоп, прерывание или ответ без текста. */
function isRetryableAnswer(message: AgentChatMessage | undefined): boolean {
  if (message?.role !== "assistant") return false;
  const status = message.metadata?.status ?? "complete";
  if (status === "error" || status === "stopped" || status === "interrupted") return true;
  // По сырому тексту, как на сервере: ответ из одних тегов голоса — не пустой.
  return status === "complete" && messageText(message).trim().length === 0;
}

function withLastAnswerStatus(messages: AgentChatMessage[], status: AnswerStatus): AgentChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return messages;
  return [...messages.slice(0, -1), { ...last, metadata: { ...last.metadata, status } }];
}

/** «Стоп»: ответ помечен остановленным, а вызовы без результата закрыты так же, как их закроет сервер. */
function stoppedAnswer(messages: AgentChatMessage[]): AgentChatMessage[] {
  const stopped = withLastAnswerStatus(messages, "stopped");
  const last = stopped.at(-1);
  return last?.role === "assistant" ? [...stopped.slice(0, -1), { ...last, parts: closeStoppedToolCalls(last.parts) }] : stopped;
}

/** Ответа нет или он из одного размышления: ни слов, ни вызовов инструментов, стирать нечего. */
function isEmptyAnswer(message: AgentChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.every((part) => part.type === "step-start" || part.type === "reasoning" || (part.type === "text" && part.text.trim().length === 0))
  );
}

/** Итог «stopped» мог прийти раньше «Стопа» на экране, а закрывающих кусков вызовов в потоке нет: их закрываем и тогда. */
function markLastAnswerStopped(messages: AgentChatMessage[]): AgentChatMessage[] {
  const status = lastAnswerStatus(messages);
  return isFinalStatus(status) && status !== "stopped" ? messages : stoppedAnswer(messages);
}
