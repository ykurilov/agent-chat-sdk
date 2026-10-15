import type { AgentChannel, Chat, ChatErrorKind, ChatSubject, FinalAnswerStatus, StoredMessage, TokenUsage } from "../conversation/types";

/** Что человек делает с чатом, когда приложение решает, пускать ли ход. */
export type TurnAction = "send" | "edit" | "retry" | "regenerate" | "approval" | "widget" | "notice";

/** Отказ приложения в ходе: код для программы, текст для человека. */
export interface TurnRefusal {
  /** Латиница в нижнем регистре, цифры и `.`, `_`, `-`; от 1 до 64 знаков. */
  code: string;
  /** До 300 знаков; длиннее — обрезается. */
  message: string;
}

/**
 * Сотрудник, который действует в чужом чате (копия чата человека в песочнице). Пока он есть у хода (`model.staff`),
 * инструменты приложения данные `ownerId` только читают: любая запись в них запрещена — это обязанность инструментов.
 */
export interface StaffActor {
  id: string;
}

/** Событие приложения в ответе агента: `type` — 1–100 знаков, `data` — JSON до 16 КБ. */
export interface AppEvent {
  type: string;
  data?: unknown;
}

/** Записать сообщение человека без хода: агент промолчит (рамки дня, пауза сценария). */
export interface TurnHold {
  hold: true;
}

/** Ход с готовым текстом, без модели: путь `reply` из `deliverNotices`. */
export interface TurnReply {
  reply: { text: string };
}

/** Что `beforeTurn` может решить, кроме «пускать»: отказ, «записать без хода» или «ответить готовым текстом». */
export type BeforeTurnDecision = TurnRefusal | TurnHold | TurnReply;

/**
 * Проверка приложения перед ходом: вернуть отказ — ход не начнётся и ничего не запишется. `{ hold: true }` и
 * `{ reply }` — с 0.49 (сценарии): сообщение записывается, хода модели нет.
 */
export type BeforeTurnHandler = (input: {
  userId: string;
  chat: Chat;
  action: TurnAction;
  /** Текст сообщения человека (`send`, `edit`). */
  text?: string;
  /** Id сообщения человека (`send`, `edit`): по нему приложение свяжет свой резерв с ходом. */
  messageId?: string;
  /**
   * Ход на пачку сообщений человека (`sendBurstMessage`): id всех её сообщений по порядку, последнее — `messageId`, а
   * `text` — их тексты через пустую строку. Одно решение на всю пачку; счёт сообщений — по длине списка.
   */
  burstMessageIds?: string[];
  /**
   * Ход на пачку начал сам сервер после перезапуска или за упавшую копию (`answerAfterRestart`): вызова, который ждёт
   * ответ или отказ, нет. Отказ дойдёт только до журнала — сообщить человеку может само приложение.
   */
  unattended?: true;
} & AbandonedAnswers) => Promise<BeforeTurnDecision | void> | BeforeTurnDecision | void;

/**
 * Ответы агента, которые уйдут с текущей ветки, если ход начнётся (`regenerate`, `edit`, `retry`): по ним приложение откатывает
 * побочные дела брошенных ответов (правки формы и т. п.). Ход не начался (`turnNotStarted`) — ветка прежняя, ничего не
 * ушло: тот хук получает те же поля. Посчитаны по ветке на миг проверки; сообщения нет на ветке — полей нет.
 */
export interface AbandonedAnswers {
  /** Ответы агента, которые уходят с ветки, сверху вниз; у `edit` без ответов ниже — пустой список. */
  abandonedAnswerIds?: string[];
  /**
   * Ответ, который заменит новый: переделываемый (`regenerate`), ответ на правленый вопрос (`edit`), если был, или
   * оборванный ответ, который «Повторить» (`retry`) заменяет соседом. У «Повторить» вопроса без ответа полей нет.
   */
  previousAnswerId?: string;
}

/** Почему ход не начался после того, как `beforeTurn` его пропустил. */
export type TurnNotStartedReason =
  /** В чате уже идёт ответ, или служба останавливается (`flush`). */
  | "busy"
  /** У человека уже идёт предел одновременных ходов. */
  | "too_many_turns"
  /** Лимит расходов исчерпан. */
  | "spending_limit"
  /** Сообщение с таким id уже есть (повтор запроса). */
  | "duplicate_message"
  /** Запрос неверен: сообщение, файл, решение, ответ на виджет. */
  | "invalid"
  /** Чат закрыли, пока ход запускался (`closeChat` между проверкой и началом хода). */
  | "chat_closed"
  /** Хода и не будет: проверка без хода (`assertTurnAllowed`), ответ ждёт ещё решений, служебное сообщение без ответа. */
  | "no_turn"
  /** Сбой (база, сеть): ход не начат. */
  | "error";

/**
 * Ход не начался, хотя `beforeTurn` его пропустил: приложение снимает свой резерв. Каждый пропуск `beforeTurn`
 * закрывается ровно одним: ходом (`afterTurn`) или этим хуком. Ошибка хода наружу прежняя; бросок хука — в журнал.
 */
export type TurnNotStartedHandler = (input: {
  userId: string;
  chat: Chat;
  action: TurnAction;
  messageId?: string;
  text?: string;
  /** Пачка сообщений, как в `beforeTurn`. */
  burstMessageIds?: string[];
  /** Ход без вызова, как в `beforeTurn`: об отказе (например, `spending_limit`) человеку может сказать только приложение. */
  unattended?: true;
  reason: TurnNotStartedReason;
} & AbandonedAnswers) => Promise<void> | void;

/** Кто остановил ход: человек («Стоп»), общий срок хода (`agent.turnTimeoutMs`) или остановка службы (`flush`). */
export type TurnStopReason = "user" | "timeout" | "shutdown";

/** Итог законченного хода для приложения. */
export interface TurnResult {
  ownerId: string;
  /** Кто сделал ход: владелец чата, а в копии у сотрудника — сотрудник. */
  actorId: string;
  chatId: string;
  messageId: string;
  status: FinalAnswerStatus;
  /** Кто остановил ход; только у `status: "stopped"` живого хода (у доделанного после перезапуска нет). */
  stopReason?: TurnStopReason;
  /** Ответ упёрся в предел токенов (`finishReason: "length"`, см. `agent.maxOutputTokens`) и оборван. */
  lengthCut?: true;
  /**
   * Ход дошёл до предела шагов (`agent.maxSteps`): последний шаг был итоговым, без инструментов. Это «дошли до потолка»,
   * а не обязательно «недоделали»: модель могла закончить дело как раз на последнем шаге. Статус обычный (`complete`).
   * В журнале SDK — строка `[предел шагов]`.
   */
  stepLimit?: true;
  /** Текстовые части ответа подряд. */
  text: string;
  /** Части ответа, как они записаны, кроме служебной части с блоками контекста (`data-frozen-context`). */
  parts: StoredMessage["parts"];
  usage: TokenUsage | null;
  /** Цена хода в долларах; `null` — у модели нет цены. */
  costUsd: number | null;
  error?: { kind: ChatErrorKind };
  /**
   * Каким действием начат ход (см. `TurnAction`). `null` — итог доделан после перезапуска (`recovered`), а ядро не
   * помнит действие; ход по служебному сообщению и тогда — `notice`.
   */
  trigger: TurnAction | null;
  channel: AgentChannel;
  /**
   * Ход сделал сотрудник в копии чата человека (песочница): `ownerId` и `subject` — человека и его исходного чата.
   * При `staff` в данные человека не писать.
   */
  staff?: StaffActor;
  /** Объект чата (урок, заказ…): ключ и данные чата объекта. Нет — обычный чат. */
  subject?: ChatSubject;
  /** Данные чата (`Chat.data`) на момент итога; нет данных — поля нет. */
  chatData?: Record<string, unknown>;
  /** Итог доделан после перезапуска сервера, а не сразу после хода. */
  recovered: boolean;
}

/**
 * Хук итога хода: зовётся после записи итога и расхода, до `finish` клиенту; пока он идёт, чат занят. Получает любой
 * итог: законченный, остановленный, с ошибкой, прерванный (в том числе восстановлением после перезапуска) и ждущий
 * человека. Ждущий ответ (`awaiting_approval`) после решения человека продолжается тем же сообщением — хук позовут
 * второй раз, с новым статусом. Хук может быть вызван повторно (повтор после сбоя, доделка после перезапуска):
 * ключ повтора — `messageId` + `status`. Возвращённые `events` ложатся в конец ответа частями `data-app-event`.
 */
export type AfterTurnHandler = (
  result: TurnResult,
) => Promise<{ events?: AppEvent[] } | void> | { events?: AppEvent[] } | void;

export const TURN_REFUSAL_MESSAGE_MAX_LENGTH = 300;
export const APP_EVENT_TYPE_MAX_LENGTH = 100;
export const APP_EVENT_DATA_MAX_BYTES = 16 * 1024;

const TURN_REFUSAL_CODE = /^[a-z0-9_.-]{1,64}$/;

export function isTurnRefusalCode(code: unknown): code is string {
  return typeof code === "string" && TURN_REFUSAL_CODE.test(code);
}

/** Отказ по правилам: код проверен (иначе `TypeError`), текст обрезан до 300 знаков. */
export function normalizeTurnRefusal(refusal: TurnRefusal): TurnRefusal {
  if (!isTurnRefusalCode(refusal?.code)) throw new TypeError("Код отказа — [a-z0-9_.-], от 1 до 64 знаков");
  if (typeof refusal.message !== "string") throw new TypeError("Текст отказа — строка");
  // По знакам, а не по половинкам: эмодзи на границе не рвётся.
  const message = Array.from(refusal.message).slice(0, TURN_REFUSAL_MESSAGE_MAX_LENGTH).join("");
  return { code: refusal.code, message };
}

/** Приложение отказало в ходе: ход не начат, ничего не записано. */
export class TurnRefusedError extends Error {
  readonly code: string;

  constructor(refusal: TurnRefusal) {
    const normalized = normalizeTurnRefusal(refusal);
    super(normalized.message);
    this.name = "TurnRefusedError";
    this.code = normalized.code;
  }

  get refusal(): TurnRefusal {
    return { code: this.code, message: this.message };
  }
}

/** Событие по правилам или `TypeError`. Отдаёт копию: данные прошли через JSON. */
export function validateAppEvent(event: unknown): AppEvent {
  if (event === null || typeof event !== "object") throw new TypeError("Событие приложения — объект { type, data? }");
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || type.length < 1 || type.length > APP_EVENT_TYPE_MAX_LENGTH) {
    throw new TypeError(`Тип события приложения — строка от 1 до ${APP_EVENT_TYPE_MAX_LENGTH} знаков`);
  }
  if (data === undefined) return { type };
  let json: string | undefined;
  try {
    json = JSON.stringify(data);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new TypeError("Данные события приложения — значение JSON");
  if (new TextEncoder().encode(json).length > APP_EVENT_DATA_MAX_BYTES) {
    throw new TypeError(`Данные события приложения больше ${APP_EVENT_DATA_MAX_BYTES} байт`);
  }
  return { type, data: JSON.parse(json) };
}
