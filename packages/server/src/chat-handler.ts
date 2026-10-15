import {
  ApprovalNotPendingError,
  AttachmentRejectedError,
  BrowserCallNotPendingError,
  ChatBusyError,
  ChatNotFoundError,
  createChatEvents,
  accessRefusedResponse,
  allowedUser,
  createChatService,
  hiddenStateKeyOf,
  createRunningAnswerRegistry,
  DuplicateMessageError,
  InvalidChatTitleError,
  InvalidMessageError,
  InvalidModelChoiceError,
  isScreenPlaceInput,
  isTabId,
  isVoiceSound,
  NothingToRetryError,
  createRequestOriginCheck,
  originRefusalHint,
  isSafeMethod,
  SpendingLimitReachedError,
  TooManyTurnsError,
  TurnRefusedError,
  ActionForbiddenError,
  ChatClosedError,
  ChatCreationRefusedError,
  turnOriginOf,
  InvalidWidgetAnswerError,
  WidgetAnswerCheckAbortedError,
  WidgetAnswerCheckTimeoutError,
  WidgetAnswerRefusedError,
  WidgetNotPendingError,
} from "@ykurilov/agent-chat-core";
import type {
  AbandonedBurstsOptions,
  AfterTurnHandler,
  ModelChosenHandler,
  RecoverInterruptedAnswersOptions,
  ReplyChecksSetting,
  StateChangedHandler,
  AgentSettings,
  BackgroundTasks,
  BeforeTurnHandler,
  BrowserCallAnswer,
  Chat,
  BeforeCreateChatHandler,
  ChatCapabilitiesHandler,
  ChatErrorKind,
  ChatService,
  ChatStorage,
  CompactionSettings,
  FlushOptions,
  IncomingUserMessage,
  MessageAttachments,
  ModelCatalog,
  ModelChoice,
  ResolvedUser,
  SpendingLimits,
  StaffActor,
  ChatInstructions,
  TurnFinishedHandler,
  TurnNotStartedHandler,
  TurnObserver,
  TurnRequestContext,
  VoiceSound,
} from "@ykurilov/agent-chat-core";
import { assertHeartbeatInterval, createHeartbeatResponse, DEFAULT_HEARTBEAT_INTERVAL_MS } from "./heartbeat";
import { handleMemoryRequest } from "./memory-routes";
import type { ChatMemory } from "./memory-routes";
import { readJsonBody, RequestBodyTooLargeError } from "./request-body";
import { openSubjectChatRoute, turnRefusalResponse } from "./subject-chat-route";
import type { NewChatDataResolver } from "./new-chat-data";
import { resolveNewChatData } from "./new-chat-data";
import type { SubjectChatsResolver } from "./subject-chat-route";
import { createWatchStream } from "./watch-stream";

export type { ChatMemory, MemoryCounts, MemoryMergeRecord, MemoryResult } from "./memory-routes";

/**
 * `busy` — в чате идёт ход; `approval_not_pending` — на этот запрос подтверждения отвечать уже нечем (решён или закрыт новым сообщением);
 * `approval_stale` — фоновая задача ждёт ответа уже на другой вопрос: ответ на старый не принят;
 * `not_pending` — браузерный вызов не ждёт ответа этой вкладки (уже отвечен, срок вышел, ход кончился, вкладка чужая);
 * `widget_not_pending` — виджет не ждёт ответа (уже отвечен, закрыт сообщением, в другой ветке, убран из настроек);
 * `invalid_answer` — ответ на виджет не прошёл схему, длиннее предела или тело запроса негодное; ничего не записано;
 * `widget_answer_refused` — приложение отказало в ответе на виджет (`checkAnswer`): `{ kind, code, message }`, ничего не записано,
 * виджет ждёт;
 * `widget_answer_cancelled` — человек нажал «Стоп», пока шла проверка ответа (`checkAnswer`): `{ kind, code, message }`, ничего не
 * записано, виджет ждёт; это не сбой;
 * `widget_check_timeout` (504) — проверка ответа (`checkAnswer`) не уложилась в `checkAnswerTimeoutMs`: `{ kind, code, message }`,
 * ничего не записано, виджет ждёт, повторить можно;
 * `too_many_turns` — у человека уже идёт столько ответов, сколько разрешено (`maxConcurrentTurnsPerUser`);
 * `forbidden_origin` — запрос, меняющий данные, пришёл с чужой страницы (`allowedOrigins`); `too_large` — тело больше 1 МиБ;
 * `turn_refused` — приложение отказало в ходе (`beforeTurn`); `access_refused` — приложение отказало в доступе (`resolveUser`);
 * `action_forbidden` — действие запрещено правами чата (`chatCapabilities`); `chat_closed` — чат закрыт (`closeChat`);
 * `chat_creation_refused` — приложение не дало завести новый чат (`beforeCreateChat`).
 * У отказов приложения одно тело: `{ kind, code, message }` (у `action_forbidden` ещё `action`).
 */
export type HandlerErrorKind =
  | ChatErrorKind
  | "not_found"
  | "busy"
  | "invalid"
  | "spending_limit_reached"
  | "approval_not_pending"
  | "approval_stale"
  | "widget_not_pending"
  | "invalid_answer"
  | "widget_answer_refused"
  | "widget_answer_cancelled"
  | "widget_check_timeout"
  | "not_pending"
  | "too_many_turns"
  | "forbidden_origin"
  | "too_large"
  | "turn_refused"
  | "access_refused"
  | "action_forbidden"
  | "chat_closed"
  | "chat_creation_refused";

/** Вложения: приём в сообщение и сборка запроса (для ядра) плюс адреса под `/:chatId/attachments`. Даёт пакет `@ykurilov/agent-chat-attachments`. */
export interface ChatAttachments extends MessageAttachments {
  /** Ответ на `GET {base}/attachments/settings`. */
  settings(): Response;
  /** Всё под `/:chatId/attachments`; чат уже проверен как принадлежащий человеку. `segments` — путь после `attachments`. */
  handle(input: { request: Request; userId: string; chatId: string; segments: string[] }): Promise<Response>;
}

export interface ChatHandlerOptions {
  /** Путь, под которым смонтирован обработчик, например `/api/chat`. */
  basePath: string;
  storage: ChatStorage;
  /**
   * Кто спрашивает: `{ id }` — человек, `null` — не вошёл (401 `invalid`). `{ refused: { code, message, status? } }` —
   * приложение отказывает человеку в доступе своими словами: на любом адресе ответ `status` (401 или 403, по умолчанию 403)
   * `{ error: { kind: "access_refused", code, message } }`. Код — `[a-z0-9_.-]`, 1–64 знака (иначе 500 `other` и строка
   * в `logError`); текст — до 300 знаков.
   */
  resolveUser: (request: Request) => Promise<ResolvedUser>;
  /** Выбор модели для новых чатов. Не задан — первая модель каталога у первого провайдера с ключом. */
  defaultChoice?: ModelChoice;
  catalog: ModelCatalog;
  agent: AgentSettings;
  /** Автосжатие истории: включено по умолчанию, `false` выключает. Подробнее — в настройках ядра. */
  compaction?: CompactionSettings | false;
  /** Вложения к сообщениям. Не заданы — адресов `/attachments` нет, сообщения только текстовые. */
  attachments?: ChatAttachments;
  /**
   * Лимиты расходов (пакет `@ykurilov/agent-chat-limits`). Исчерпанный лимит — ответ 429 `spending_limit_reached`
   * на отправку, повтор, переделку и правку; появляется адрес `GET {base}/:chatId/spending`. Не заданы — адреса нет.
   */
  limits?: SpendingLimits;
  /**
   * Сколько ответов одного человека могут идти одновременно во всех его чатах. Сверх этого — ответ 429
   * `too_many_turns` с полем `limit`, ничего не записано. Считается в памяти процесса. По умолчанию 3; `Infinity` — без предела.
   */
  maxConcurrentTurnsPerUser?: number;
  /**
   * Проверка приложения перед ходом: вернуть `{ code, message }` — ход не начнётся, ничего не запишется, ответ 403
   * `{ error: { kind: "turn_refused", code, message } }` на отправку, повтор, переделку, правку, ответ на подтверждение
   * и ответ на виджет. Подробнее — `ChatServiceOptions.beforeTurn`. Нет — ходы не проверяются.
   */
  beforeTurn?: BeforeTurnHandler;
  /**
   * Ход не начался, хотя `beforeTurn` его пропустил (чат занят, предел ходов, лимит, повтор id, неверный запрос, сбой):
   * снять резерв приложения. Ответ клиенту прежний. Подробнее — `ChatServiceOptions.turnNotStarted`.
   */
  turnNotStarted?: TurnNotStartedHandler;
  /**
   * Права человека в чате: частичный список `{ право: boolean }`, пропущенное — `true`. Запрещённое — 403
   * `{ error: { kind: "action_forbidden", action, code, message } }`, история отдаёт `capabilities`, экран прячет кнопки.
   * Право `attachments` закрывает и загрузку вложений (`/:chatId/attachments`, кроме GET). Подробнее —
   * `ChatServiceOptions.chatCapabilities`. Нет — всё разрешено.
   */
  chatCapabilities?: ChatCapabilitiesHandler;
  /**
   * Можно ли человеку завести новый чат (`POST {base}`; тот же хук спрашивают мессенджеры на `/new`). Отказ — 403
   * `{ error: { kind: "chat_creation_refused", code, message } }`, чат не создан. Подробнее —
   * `ChatServiceOptions.beforeCreateChat`. Нет — чаты заводятся без проверки.
   */
  beforeCreateChat?: BeforeCreateChatHandler;
  /**
   * Долгая память агента между чатами (пакет `@ykurilov/agent-chat-memory`): ядро добавляет её в запросы и инструменты,
   * появляются адреса `{base}/memory` для экрана памяти. Не задана — адресов нет (404), чат как раньше.
   */
  memory?: ChatMemory;
  /**
   * Список чатов человека: `GET {base}`, переименование `PATCH {base}/{id}` и удаление `DELETE {base}/{id}`.
   * Не включён — этих адресов нет (404), у приложения с одним чатом всё работает как раньше. Чаты объектов
   * (`subjectChats`) в списке не видны; `{ subjectChats: true }` — видны, с полем `subjectKey`.
   */
  chatList?: boolean | { subjectChats?: boolean };
  /**
   * Чаты объектов приложения (урок, заказ): адрес `POST {base}/subject { key }` → `{ id, created }` находит или
   * создаёт чат человека по ключу (1–200 знаков). Приложение по ключу отдаёт данные объекта (только для сервера),
   * название и приветствие нового чата — или отказ `{ code, message }` (ответ 403 `turn_refused`, чат не создан).
   * Не задано — адреса нет (404). Требует хранилища с `findChatBySubject`: без него — ошибка при создании обработчика.
   */
  subjectChats?: SubjectChatsResolver;
  /**
   * Данные нового чата, который человек создаёт из браузера (`POST {base}`): сервер решает, что записать, браузер
   * данных не присылает. JSON-объект до 16 КБ (`Chat.data`) или `undefined` — чат без данных. Видят `beforeTurn`,
   * `chatInstructions`, инструменты (`model.chat.data`) и `afterTurn` (`turn.chatData`); в браузер не уходят.
   * Вернул не объект или бросил — ответ 500, чат не создан. Чаты объектов (`subjectChats`) берут данные из своего решения.
   * Требует хранилища с `updateChatData`: без него — ошибка при создании обработчика.
   */
  newChatData?: NewChatDataResolver;
  /**
   * Чужие страницы, которым можно менять данные чата с куками человека, например `["https://school.getcourse.ru"]`,
   * когда чат встроен в чужой сайт и шлёт запросы прямо оттуда. Свою страницу вносить не нужно: запросы с неё проходят всегда.
   * Запрос, меняющий данные (не GET), с чужой страницы — ответ 403 `forbidden_origin`, ничего не записано.
   * Запросы не из браузера (без заголовков Origin и Sec-Fetch-Site) проходят: их судит `resolveUser`.
   */
  allowedOrigins?: string[];
  /** Откуда брать ключи провайдеров. По умолчанию `process.env`. */
  env?: Record<string, string | undefined>;
  /** Журнал сервера: нет ключа провайдера, непредвиденные сбои. По умолчанию `console.error`. */
  logError?: (message: string) => void;
  /** Промежуток между признаками жизни в потоках ответа. По умолчанию 10 000 мс, не меньше 1000. */
  heartbeatIntervalMs?: number;
  /** Наблюдатель хода (песочница): см. `ChatServiceOptions.turnObserver`. Нет — запрос к модели побайтно прежний. */
  turnObserver?: TurnObserver;
  /** Своя инструкция чата (песочница): см. `ChatServiceOptions.chatInstructions`. `null` — инструкция приложения. */
  chatInstructions?: ChatInstructions;
  /** Сотрудник хода по чату (песочница: копия чата человека): см. `ChatServiceOptions.staffOfChat`. */
  staffOfChat?: (chat: Chat) => StaffActor | null | undefined;
  /** Инструменты, чей результат правка ответа не меняет (файлы): см. `ChatServiceOptions.lockedToolOutputs`. */
  lockedToolOutputs?: readonly string[];
  /** Несколько служб на одном хранилище: чья брошенная пачка. См. `ChatServiceOptions.abandonedBursts`. */
  abandonedBursts?: AbandonedBurstsOptions;
  /**
   * Фоновые задачи (пакет `@ykurilov/agent-chat-background`): появляются адреса `{base}/:chatId/tasks`. Не заданы —
   * адресов задач нет (404), запрос к модели прежний.
   */
  background?: BackgroundTasks;
  /**
   * Ход закончен: `{ userId, chatId, messageId, status, modelId, providerId }`, один раз на ход при любом итоге —
   * законченном, остановленном, с ошибкой, прерванном, ждущем человека. Зовётся, когда итог уже записан; ход обработчик
   * не ждёт, его сбой уходит в `logError`. Нет — ничего не зовётся.
   */
  onTurnFinished?: TurnFinishedHandler;
  /**
   * Итог хода для приложения: ход ждёт его до `finish`, возвращённые `events` ложатся в ответ частями `data-app-event`.
   * Повторы, срок, состояние в ответе и доделка после перезапуска — как у `ChatServiceOptions.afterTurn`. Событие вне
   * хода — `service.publishAppEvent` (служба из `createChatServer`): открытая вкладка получит его через `watch`.
   */
  afterTurn?: AfterTurnHandler;
  /** Срок хука итога на все попытки, мс. По умолчанию 30 000. */
  afterTurnTimeoutMs?: number;
  /** Попыток хука итога. По умолчанию 3. */
  afterTurnAttempts?: number;
  /**
   * Состояние чата сменилось (ход, правка, «Переделать», «Повторить», выбор ветки, правка ответа): копия состояния в
   * таблицах приложения. Как у `ChatServiceOptions.onStateChanged`; открытая вкладка получает событие `state-changed`
   * через `watch`.
   */
  onStateChanged?: StateChangedHandler;
  /** Срок хука смены состояния на все попытки, мс. По умолчанию 30 000. */
  onStateChangedTimeoutMs?: number;
  /** Попыток хука смены состояния. По умолчанию 3. */
  onStateChangedAttempts?: number;
  /**
   * Человек выбрал модель или уровень в меню (`PUT {chat}/model`): после записи выбора. Подстановка выбора и
   * `service.setModel(..., { by: "app" })` его не зовут. Как у `ChatServiceOptions.onModelChosen`.
   */
  onModelChosen?: ModelChosenHandler;
  /**
   * Видит ли человек `GET …/models`: `false` — 403 `action_forbidden` (`action: "modelDetails"`). Меню не знает чата,
   * поэтому право `modelDetails` его не закрывает. Нет — меню видно всем. Как у `ChatServiceOptions.modelMenu`.
   */
  modelMenu?: (input: { userId: string }) => boolean | Promise<boolean>;
  /**
   * Закрытые верхние ключи состояния чата: не уходят в браузер ни в истории, ни в потоке хода, ни в `state-changed`
   * адреса `watch`. Сервер видит их как обычно. Как у `ChatServiceOptions.privateStateKeys`.
   */
  privateStateKeys?: readonly string[];
  /** Проверки готового ответа перед записью. Как у `ChatServiceOptions.replyChecks`. */
  replyChecks?: ReplyChecksSetting;
  /** Часы службы: тесты и песочница подменяют время целиком. Как у `ChatServiceOptions.now`. */
  now?: () => Date;
}

export interface ChatHandler {
  basePath: string;
  fetch(request: Request): Promise<Response>;
  /**
   * Помечает «прерванными» ответы, оборванные прошлым запуском сервера, и запускает регулярную проверку брошенных
   * ответов. Вызывать при старте, до приёма запросов; в Next.js — один раз сразу после `createChatHandler`: свои
   * живые ответы проверка не трогает. Без вызова оборванные ответы остаются «идущими». Возвращает число помеченных.
   * `{ soleServer: true }` — копия сервера на этой базе одна: оборванные ответы прерываются сразу, а не через 15–20 с.
   * Только при старте процесса: вызов позже прервёт ход, который как раз запускается. Нельзя с несколькими копиями
   * сервера на одной базе и с несколькими обработчиками в одном процессе (dev-режим Next.js): прервутся живые ответы.
   */
  recoverInterruptedAnswers(options?: RecoverInterruptedAnswersOptions): Promise<number>;
  /**
   * Штатная остановка: после того как сервер перестал принимать запросы, до закрытия хранилища. Ждёт идущие ответы до
   * `waitForAnswersMs` (по умолчанию 0), не успевшие останавливает, как «Стоп», с записью; возвращается, когда всё
   * записано и хуки итога закончены. Подробнее — `ChatService.flush`.
   */
  flush(options?: FlushOptions): Promise<void>;
  /**
   * Открыт ли у чата этого владельца поток `GET /:chatId/watch` (вкладка с чатом). Необязателен: обёртки над сервером
   * (песочница) реализуют этот тип без него; мессенджеры берут его у `ChatServerService`.
   */
  hasWatchers?(ownerId: string, chatId: string): boolean;
}

/** Служба чата сервера: служба ядра плюс то, что знает только сервер, — открытые вкладки и задачи фона. */
export interface ChatServerService extends ChatService {
  /** Открыт ли у чата этого владельца поток `GET /:chatId/watch`. */
  hasWatchers(ownerId: string, chatId: string): boolean;
  /** Задачи фона; нет фона — нет и этого поля. */
  tasks?: { list: BackgroundTasks["listForChat"] } & Pick<BackgroundTasks, "cancel" | "answerApproval">;
}

/** Значение из адреса для строки журнала: с управляющими символами — в кавычках и экранировано, чтобы не подделать строки. */
const logValue = (value: string): string => (/[\p{Cc}\u2028\u2029]/u.test(value) ? JSON.stringify(value) : value);

/** HTTP-обработчик чата на стандартных `Request`/`Response` (contracts/http-api.md). */
export function createChatHandler(options: ChatHandlerOptions): ChatHandler {
  return createChatServer(options).handler;
}

/**
 * Обработчик чата и его служба: приложению (песочнице) служба нужна для своих адресов поверх тех же чатов —
 * в одном процессе с обработчиком, с общим реестром идущих ответов.
 */
export function createChatServer(options: ChatHandlerOptions): { handler: ChatHandler; service: ChatServerService } {
  const basePath = options.basePath.replace(/\/+$/, "");
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  assertHeartbeatInterval(heartbeatIntervalMs);
  const streamResponse = (stream: ReadableStream<unknown>) =>
    createHeartbeatResponse({ stream, heartbeatIntervalMs });
  const logError = options.logError ?? ((message: string) => console.error(message));
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins: options.allowedOrigins,
    onRefused: (refusal) => logError(`Чат: ${originRefusalHint(refusal)}`),
  });
  if (options.newChatData && !options.storage.updateChatData) {
    throw new Error("newChatData требует хранилища с updateChatData: хранилище приложения его не умеет.");
  }
  if (options.subjectChats && !options.storage.findChatBySubject) {
    throw new Error("subjectChats требует хранилища с findChatBySubject: хранилище приложения его не умеет.");
  }
  const service = createChatService({
    storage: options.storage,
    catalog: options.catalog,
    registry: createRunningAnswerRegistry(),
    ...(options.defaultChoice && { defaultChoice: options.defaultChoice }),
    agent: options.agent,
    ...(options.compaction !== undefined && { compaction: options.compaction }),
    ...(options.attachments && { attachments: options.attachments }),
    ...(options.limits && { limits: options.limits }),
    ...(options.maxConcurrentTurnsPerUser !== undefined && { maxConcurrentTurnsPerUser: options.maxConcurrentTurnsPerUser }),
    ...(options.beforeTurn && { beforeTurn: options.beforeTurn }),
    ...(options.turnNotStarted && { turnNotStarted: options.turnNotStarted }),
    ...(options.chatCapabilities && { chatCapabilities: options.chatCapabilities }),
    ...(options.beforeCreateChat && { beforeCreateChat: options.beforeCreateChat }),
    ...(options.memory && { memory: options.memory }),
    ...(options.env && { env: options.env }),
    logError,
    ...(options.turnObserver && { turnObserver: options.turnObserver }),
    ...(options.chatInstructions && { chatInstructions: options.chatInstructions }),
    ...(options.staffOfChat && { staffOfChat: options.staffOfChat }),
    ...(options.lockedToolOutputs && { lockedToolOutputs: options.lockedToolOutputs }),
    ...(options.abandonedBursts && { abandonedBursts: options.abandonedBursts }),
    chatEvents: createChatEvents((error) => logError(`События чата: сбой слушателя: ${describe(error)}`)),
    ...(options.background && { background: options.background }),
    ...(options.onTurnFinished && { onTurnFinished: options.onTurnFinished }),
    ...(options.afterTurn && { afterTurn: options.afterTurn }),
    ...(options.afterTurnTimeoutMs !== undefined && { afterTurnTimeoutMs: options.afterTurnTimeoutMs }),
    ...(options.afterTurnAttempts !== undefined && { afterTurnAttempts: options.afterTurnAttempts }),
    ...(options.onStateChanged && { onStateChanged: options.onStateChanged }),
    ...(options.onStateChangedTimeoutMs !== undefined && { onStateChangedTimeoutMs: options.onStateChangedTimeoutMs }),
    ...(options.onStateChangedAttempts !== undefined && { onStateChangedAttempts: options.onStateChangedAttempts }),
    ...(options.onModelChosen && { onModelChosen: options.onModelChosen }),
    ...(options.modelMenu && { modelMenu: options.modelMenu }),
    ...(options.privateStateKeys && { privateStateKeys: options.privateStateKeys }),
    ...(options.replyChecks && { replyChecks: options.replyChecks }),
    ...(options.now && { now: options.now }),
  });
  /** Ключи состояния, которые не уходят вкладке (служба уже проверила имена). */
  const hiddenStateKey = hiddenStateKeyOf(options.privateStateKeys);
  const background = options.background;
  /** Ответ человека на вопрос фоновой задачи продолжает работу модели: приложение проверяет его, как любой ход. */
  async function answerTaskApproval(ownerId: string, chatId: string, taskId: string, approvalId: string, decision: "allow" | "deny") {
    await service.assertTurnAllowed(ownerId, chatId, "approval");
    return background!.answerApproval(ownerId, chatId, taskId, approvalId, decision);
  }
  /** Открытые потоки `watch` по владельцу и чату. */
  const watchers = new Map<string, number>();
  const watcherKey = (ownerId: string, chatId: string) => JSON.stringify([ownerId, chatId]);
  const hasWatchers = (ownerId: string, chatId: string) => (watchers.get(watcherKey(ownerId, chatId)) ?? 0) > 0;

  /** Подписчик считается, пока поток открыт; снимается при отмене потока, уходе клиента и сбое открытия — ровно один раз. */
  function watchResponse(request: Request, userId: string, chatId: string): Response {
    const key = watcherKey(userId, chatId);
    watchers.set(key, (watchers.get(key) ?? 0) + 1);
    let counted = true;
    const uncount = () => {
      if (!counted) return;
      counted = false;
      const left = (watchers.get(key) ?? 1) - 1;
      if (left > 0) watchers.set(key, left);
      else watchers.delete(key);
    };
    try {
      const stream = createWatchStream({
        ownerId: userId,
        chatId,
        signal: request.signal,
        subscribeEvents: (listener) => service.subscribeEvents(listener),
        hiddenStateKey,
        ...(background && { listTasks: () => background.listForChat(userId, chatId) }),
        async detachedTurn() {
          const history = await service.getHistory(userId, chatId);
          const answer = history.messages.at(-1);
          return history.detachedAnswer && answer ? { messageId: answer.id, ...turnOriginOf(history.messages) } : null;
        },
        onClose: uncount,
        logError,
      });
      return streamResponse(stream);
    } catch (error) {
      uncount();
      throw error;
    }
  }

  async function route(request: Request, userId: string, segments: string[]): Promise<Response> {
    const [chatId, action, ...rest] = segments;
    const method = request.method.toUpperCase();

    if (options.attachments) {
      // Идентификаторы чатов — UUID, поэтому путь `attachments/settings` с чатом не пересекается.
      if (chatId === "attachments" && action === "settings" && rest.length === 0 && method === "GET") {
        return options.attachments.settings();
      }
      if (chatId !== undefined && action === "attachments") {
        await service.assertOwnChat(userId, chatId);
        // Загрузка и удаление — под правом `attachments`; файлы уже отправленных сообщений читаются всегда.
        if (method !== "GET" && method !== "HEAD") await service.assertCapability(userId, chatId, "attachments");
        return options.attachments.handle({ request, userId, chatId, segments: rest });
      }
    }

    // Идентификаторы чатов — UUID, поэтому путь `memory` с чатом не пересекается.
    if (options.memory && chatId === "memory") {
      return handleMemoryRequest({ memory: options.memory, request, userId, segments: segments.slice(1) });
    }

    if (chatId !== undefined && action === "approvals" && rest.length === 1 && method === "POST") {
      const body = await readJsonBody(request);
      const decision = (body as { decision?: unknown } | null)?.decision;
      if (decision !== "allow" && decision !== "deny" && decision !== "always") return errorResponse(400, "invalid");
      const page = parsePage(body);
      if (page === "invalid") return errorResponse(400, "invalid");
      return Response.json(await service.answerApproval(userId, chatId, rest[0]!, decision, page));
    }

    if (chatId !== undefined && action === "widgets" && rest.length === 1 && method === "POST") {
      const toolCallId = rest[0]!;
      const body = await readWidgetAnswerBody(request);
      if (!body) {
        logError(`[виджет] отказ invalid_answer чат=${logValue(chatId)} вызов=${logValue(toolCallId)}`);
        return errorResponse(400, "invalid_answer");
      }
      const page = parsePage(body);
      if (page === "invalid") return errorResponse(400, "invalid");
      return Response.json(await service.answerWidget({ chatId, ownerId: userId, toolCallId, answer: body.answer, ...(page && { page }) }));
    }

    if (chatId !== undefined && action === "browser-tools" && rest.length === 1 && method === "POST") {
      const answer = parseBrowserCallAnswer(await readJsonBody(request, MAX_BROWSER_CALL_BODY_BYTES));
      if (!answer) return errorResponse(400, "invalid");
      await service.answerBrowserCall(userId, chatId, rest[0]!, answer);
      return new Response(null, { status: 204 });
    }

    if (chatId !== undefined && action === "watch" && rest.length === 0 && method === "GET") {
      await service.assertOwnChat(userId, chatId);
      return watchResponse(request, userId, chatId);
    }

    if (background && chatId !== undefined && action === "tasks") {
      const [taskId, taskAction, ...extra] = rest;
      if (taskId === undefined && method === "GET") {
        await service.assertOwnChat(userId, chatId);
        return Response.json(await background.listForChat(userId, chatId));
      }
      if (taskId !== undefined && taskAction === "cancel" && extra.length === 0 && method === "POST") {
        await service.assertOwnChat(userId, chatId);
        const status = await background.cancel(userId, chatId, taskId);
        return status === "not_found" ? errorResponse(404, "not_found") : Response.json({ status });
      }
      if (taskId !== undefined && taskAction === "approval" && extra.length === 0 && method === "POST") {
        await service.assertOwnChat(userId, chatId);
        const body = (await readJsonBody(request)) as { decision?: unknown; approvalId?: unknown } | null;
        const decision = body?.decision;
        const approvalId = body?.approvalId;
        if ((decision !== "allow" && decision !== "deny") || typeof approvalId !== "string" || approvalId === "") return errorResponse(400, "invalid");
        const status = await answerTaskApproval(userId, chatId, taskId, approvalId, decision);
        if (status === "not_found") return errorResponse(409, "approval_not_pending");
        if (status === "stale") return errorResponse(409, "approval_stale");
        return Response.json({ status });
      }
    }

    if (rest.length > 0) return errorResponse(404, "not_found");

    // Идентификаторы чатов — UUID, поэтому путь `subject` с чатом не пересекается.
    if (options.subjectChats && chatId === "subject" && action === undefined && method === "POST") {
      return openSubjectChatRoute({ request, userId, service, resolve: options.subjectChats, invalid: () => errorResponse(400, "invalid") });
    }

    if (chatId === undefined) {
      if (method === "GET" && options.chatList) return Response.json({ chats: await service.listChats(userId, chatListOptions(options.chatList)) });
      if (method !== "POST") return errorResponse(404, "not_found");
      const data = options.newChatData ? await resolveNewChatData(options.newChatData, { user: { id: userId }, request }) : undefined;
      const chat = await service.createChat(userId, data && { data });
      return Response.json({ id: chat.id }, { status: 201 });
    }

    // Идентификаторы чатов — UUID, поэтому путь `models` с чатом не пересекается.
    if (chatId === "models" && action === undefined && method === "GET") {
      return Response.json(await service.getModelMenu(userId));
    }

    if (action === undefined && method === "GET") {
      // `backgroundTasks` — заявка клиенту: адрес `{chat}/tasks` есть, только если фон подключён.
      return Response.json({ ...(await service.getHistory(userId, chatId)), backgroundTasks: background !== undefined });
    }

    if (action === undefined && method === "PATCH" && options.chatList) {
      const title = (await readJsonBody(request) as { title?: unknown } | null)?.title;
      if (typeof title !== "string") return errorResponse(400, "invalid");
      return Response.json({ id: chatId, title: await service.renameChat(userId, chatId, title) });
    }

    if (action === undefined && method === "DELETE" && options.chatList) {
      await service.deleteChat(userId, chatId);
      return new Response(null, { status: 204 });
    }

    if (action === "compactions" && method === "GET") {
      return Response.json(await service.getCompactions(userId, chatId));
    }

    if (action === "spending" && method === "GET" && options.limits) {
      return Response.json(await service.getSpendingStatus(userId, chatId));
    }

    if (action === "branches" && method === "GET") {
      return Response.json(await service.getBranchForks(userId, chatId));
    }

    if (action === "branch" && method === "POST") {
      const messageId = parseMessageId(await readJsonBody(request));
      if (!messageId) return errorResponse(400, "invalid");
      return Response.json(await service.selectBranch(userId, chatId, messageId));
    }

    if (action === "regenerate" && method === "POST") {
      const body = await readJsonBody(request);
      const messageId = parseMessageId(body);
      if (!messageId) return errorResponse(400, "invalid");
      const page = parsePage(body);
      if (page === "invalid") return errorResponse(400, "invalid");
      return streamResponse(await service.regenerate(userId, chatId, messageId, page));
    }

    if (action === "edit" && method === "POST") {
      const body = (await readJsonBody(request)) as { editedMessageId?: unknown; message?: IncomingUserMessage; voiceMode?: unknown; voiceSounds?: unknown } | null;
      const { editedMessageId, message } = body ?? {};
      if (typeof editedMessageId !== "string" || !message || typeof message !== "object") return errorResponse(400, "invalid");
      // Продолжение голосовой фразы (склейка): признак как у отправки; не булево — отказ, ничего не записано.
      if (body?.voiceMode !== undefined && typeof body.voiceMode !== "boolean") return errorResponse(400, "invalid");
      const voiceSounds = parseVoiceSounds(body?.voiceSounds);
      if (voiceSounds === "invalid") return errorResponse(400, "invalid");
      const page = parsePage(body);
      if (page === "invalid") return errorResponse(400, "invalid");
      return streamResponse(
        await service.editMessage(userId, chatId, editedMessageId, message, { voiceMode: body?.voiceMode === true, voiceSounds, ...(page && { page }) }),
      );
    }

    if (action === "model" && method === "PUT") {
      const choice = parseModelChoice(await readJsonBody(request));
      if (!choice) return errorResponse(400, "invalid");
      return Response.json(await service.setModel(userId, chatId, choice));
    }

    if (action === "messages" && method === "POST") {
      const body = (await readJsonBody(request)) as { message?: IncomingUserMessage; voiceMode?: unknown; voiceSounds?: unknown } | null;
      const message = body?.message;
      if (!message || typeof message !== "object") return errorResponse(400, "invalid");
      // Признак голосового режима: не булево — отказ, ничего не записано.
      if (body.voiceMode !== undefined && typeof body.voiceMode !== "boolean") return errorResponse(400, "invalid");
      const voiceSounds = parseVoiceSounds(body.voiceSounds);
      if (voiceSounds === "invalid") return errorResponse(400, "invalid");
      const page = parsePage(body);
      if (page === "invalid") return errorResponse(400, "invalid");
      // Поток не привязан к request.signal: обрыв соединения только отписывает слушателя.
      const stream = await service.sendMessage(userId, chatId, message, { voiceMode: body.voiceMode === true, voiceSounds, ...(page && { page }) });
      return streamResponse(stream);
    }

    if (action === "steer" && method === "POST") {
      const body = (await readJsonBody(request)) as { message?: IncomingUserMessage } | null;
      const message = body?.message;
      if (!message || typeof message !== "object") return errorResponse(400, "invalid");
      const page = parsePage(body);
      if (page === "invalid") return errorResponse(400, "invalid");
      // Поправка к идущему ответу или начало хода; ответ на неё — в потоке GET stream.
      return Response.json(await service.steer(userId, chatId, message, page && { page }), { status: 202 });
    }

    if (action === "retry" && method === "POST") {
      const page = parsePage(await readJsonBody(request));
      if (page === "invalid") return errorResponse(400, "invalid");
      const stream = await service.retry(userId, chatId, page);
      return streamResponse(stream);
    }

    if (action === "stream" && method === "GET") {
      // Как и у отправки, поток не привязан к request.signal: обрыв только отписывает слушателя.
      const stream = await service.subscribe(userId, chatId);
      if (!stream) return new Response(null, { status: 204 });
      return streamResponse(stream);
    }

    if (action === "stop" && method === "POST") {
      const stopped = await service.stop(userId, chatId);
      return new Response(null, { status: stopped ? 202 : 204 });
    }

    return errorResponse(404, "not_found");
  }

  const handler: ChatHandler = {
    basePath,
    recoverInterruptedAnswers: (recoverOptions) => service.recoverInterruptedAnswers(recoverOptions),
    flush: (flushOptions) => service.flush(flushOptions),
    hasWatchers,
    async fetch(request) {
      const segments = pathSegments(new URL(request.url).pathname, basePath);
      if (!segments) return errorResponse(404, "not_found");
      if (!isSafeMethod(request.method) && !allowsOrigin(request)) return errorResponse(403, "forbidden_origin");
      try {
        const resolved = await options.resolveUser(request);
        const refused = accessRefusedResponse(resolved);
        if (refused) return refused;
        const user = allowedUser(resolved);
        if (!user) return errorResponse(401, "invalid");
        return await route(request, user.id, segments);
      } catch (error) {
        const response = errorToResponse(error);
        if (response.status >= 500) logError(`Чат: сбой на ${request.method} ${new URL(request.url).pathname}: ${describe(error)}`);
        return response;
      }
    },
  };
  const serverService: ChatServerService = Object.assign(service, {
    hasWatchers,
    ...(background && { tasks: { list: background.listForChat.bind(background), cancel: background.cancel.bind(background), answerApproval: answerTaskApproval } }),
  });
  return { handler, service: serverService };
}

function pathSegments(pathname: string, basePath: string): string[] | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  try {
    return pathname
      .slice(basePath.length)
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    // Битая кодировка (например, `%E0`): такого чата не бывает.
    return null;
  }
}

/** Звуки человека из голосового режима: не передан — `undefined`; не список или вид вне закрытого списка — `"invalid"`. */
function parseVoiceSounds(value: unknown): VoiceSound[] | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isVoiceSound)) return "invalid";
  return value;
}

/**
 * Место на экране, номер вкладки и часовой пояс человека из тела запроса хода. Нет ничего — `undefined` (как до 021);
 * неверная форма места или вкладки — `"invalid"`, запрос отклоняется до любой записи. Пояс-строку проверяет ядро:
 * не настоящий пояс — дата по запасному поясу, не ошибка; пояс не строкой не берётся.
 */
function parsePage(body: unknown): TurnRequestContext | undefined | "invalid" {
  const { place, tabId, timeZone } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const zone = typeof timeZone === "string" ? timeZone : undefined;
  if (place === undefined && tabId === undefined && zone === undefined) return undefined;
  if (place !== undefined && !isScreenPlaceInput(place)) return "invalid";
  if (tabId !== undefined && !isTabId(tabId)) return "invalid";
  return { ...(place !== undefined && { place }), ...(tabId !== undefined && { tabId }), ...(zone !== undefined && { timeZone: zone }) };
}

/** Ответ вкладки: `{ tabId, output }` или `{ tabId, error: строка }`, ровно одно из двух; иначе `null`. */
function parseBrowserCallAnswer(body: unknown): BrowserCallAnswer | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { tabId } = body as { tabId?: unknown };
  if (!isTabId(tabId)) return null;
  const hasOutput = Object.hasOwn(body, "output");
  const hasError = Object.hasOwn(body, "error");
  if (hasOutput === hasError) return null;
  if (hasOutput) return { tabId, output: (body as { output: unknown }).output };
  const { error } = body as { error: unknown };
  return typeof error === "string" ? { tabId, error } : null;
}

function parseMessageId(body: unknown): string | null {
  const { messageId } = (body ?? {}) as Record<string, unknown>;
  return typeof messageId === "string" && messageId.length > 0 ? messageId : null;
}

function parseModelChoice(body: unknown): ModelChoice | null {
  const { modelId, providerId, reasoning } = (body ?? {}) as Record<string, unknown>;
  if (typeof modelId !== "string" || typeof providerId !== "string") return null;
  if (reasoning !== undefined && typeof reasoning !== "string") return null;
  return { modelId, providerId, ...(reasoning !== undefined && { reasoning }) };
}

/** Ответ вкладки больше этого не читается: модели и так уходит не больше 16 КБ результата. */
const MAX_BROWSER_CALL_BODY_BYTES = 64 * 1024;
/** Тело ответа на виджет: сам ответ не длиннее 16 КБ (его меряет служба), остальное — место на экране. */
const MAX_WIDGET_BODY_BYTES = 64 * 1024;

/** Тело `{ answer, ...место на экране }`; без `answer`, не JSON или длиннее предела — `null`. */
async function readWidgetAnswerBody(request: Request): Promise<{ answer: unknown } | null> {
  try {
    const body = await readJsonBody(request, MAX_WIDGET_BODY_BYTES);
    return typeof body === "object" && body !== null && !Array.isArray(body) && Object.hasOwn(body, "answer") ? (body as { answer: unknown }) : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return null;
    throw error;
  }
}

/** Какие чаты в списке: чаты объектов — только при `chatList: { subjectChats: true }`. */
function chatListOptions(chatList: NonNullable<ChatHandlerOptions["chatList"]>): { subjects?: "include" } | undefined {
  return typeof chatList === "object" && chatList.subjectChats ? { subjects: "include" } : undefined;
}

function errorResponse(status: number, kind: HandlerErrorKind): Response {
  return Response.json({ error: { kind } }, { status });
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function errorToResponse(error: unknown): Response {
  if (error instanceof RequestBodyTooLargeError) return errorResponse(413, "too_large");
  if (error instanceof ChatNotFoundError) return errorResponse(404, "not_found");
  if (error instanceof InvalidChatTitleError) return errorResponse(400, "invalid");
  if (error instanceof InvalidMessageError) return errorResponse(400, "invalid");
  if (error instanceof AttachmentRejectedError) return Response.json({ error: { kind: error.kind } }, { status: 400 });
  if (error instanceof InvalidModelChoiceError) return errorResponse(400, "invalid");
  if (error instanceof SpendingLimitReachedError) {
    const { scope, period, resetsAt, timeZone, reason, windowId, hours, unit } = error;
    const details = { ...(timeZone && { timeZone }), ...(reason && { reason }), ...(windowId && { windowId }), ...(hours !== undefined && { hours }), ...(unit && { unit }) };
    return Response.json({ error: { kind: "spending_limit_reached", scope, period, resetsAt, ...details } }, { status: 429 });
  }
  if (error instanceof TurnRefusedError) return turnRefusalResponse(error.refusal);
  if (error instanceof ActionForbiddenError) {
    return Response.json({ error: { kind: "action_forbidden", action: error.action, code: error.action, message: error.message } }, { status: 403 });
  }
  if (error instanceof ChatClosedError) return Response.json({ error: { kind: "chat_closed", code: error.code, message: error.message } }, { status: 409 });
  if (error instanceof ChatCreationRefusedError) {
    return Response.json({ error: { kind: "chat_creation_refused", code: error.code, message: error.message } }, { status: 403 });
  }
  if (error instanceof TooManyTurnsError) return Response.json({ error: { kind: "too_many_turns", limit: error.limit } }, { status: 429 });
  if (error instanceof ChatBusyError) return errorResponse(409, "busy");
  if (error instanceof DuplicateMessageError) return errorResponse(409, "invalid");
  if (error instanceof NothingToRetryError) return errorResponse(409, "invalid");
  if (error instanceof ApprovalNotPendingError) return errorResponse(409, "approval_not_pending");
  if (error instanceof BrowserCallNotPendingError) return errorResponse(409, "not_pending");
  if (error instanceof WidgetNotPendingError) return errorResponse(409, "widget_not_pending");
  if (error instanceof InvalidWidgetAnswerError) return errorResponse(400, "invalid_answer");
  if (error instanceof WidgetAnswerRefusedError) {
    return Response.json({ error: { kind: "widget_answer_refused", code: "widget_answer_refused", message: error.message } }, { status: 409 });
  }
  if (error instanceof WidgetAnswerCheckAbortedError) {
    return Response.json({ error: { kind: "widget_answer_cancelled", code: "widget_answer_cancelled", message: error.message } }, { status: 409 });
  }
  if (error instanceof WidgetAnswerCheckTimeoutError) {
    return Response.json({ error: { kind: "widget_check_timeout", code: "widget_check_timeout", message: error.message } }, { status: 504 });
  }
  return errorResponse(500, "other");
}
