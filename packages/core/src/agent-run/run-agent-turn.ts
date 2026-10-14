import { stepCountIs, streamText } from "ai";
import type { ModelMessage, StopCondition, ToolSet, UIMessageChunk } from "ai";
import type { MessageAttachments } from "../attachments/message-attachments";
import { closeHangingToolCalls } from "../conversation/hanging-tool-calls";
import { answerStepsFrame, splitAnswerSteps } from "../compaction/answer-steps";
import { emptyTokenUsage } from "../conversation/token-usage";
import { newStoredMessage } from "../conversation/types";
import type { AgentAudience, AgentChannel, ChatSubject, GroupTurn, UsageSource } from "../conversation/types";
import type {
  AgentChatMessage,
  ChatErrorKind,
  ChatMessageMetadata,
  FinalAnswerStatus,
  TokenUsage,
} from "../conversation/types";
import { helpersToContinue } from "../helpers/helper-approval";
import type { HelperPartOutput, HelperToContinue } from "../helpers/helper-approval";
import { helperTools, isHelperToolName } from "../helpers/helper-tools";
import type { AgentHelper, HelperProgress, HelperStepReport } from "../helpers/helper-types";
import { helperSteps } from "../helpers/run-helper";
import type { HelperRunContext } from "../helpers/run-helper";
import { denyPendingApprovals, INTERRUPTED_REASON, pendingHumanInput, RESULT_UNKNOWN_REASON } from "../tool-approval/approval-parts";
import { extraWidgetCallIds, ONE_QUESTION_AT_A_TIME } from "../widgets/pending-widgets";
import type { DataChange, ScreenPlace } from "../page-context/page-context";
import { prepareToolApproval } from "../tool-approval/tool-approval-policy";
import { findModel, MissingProviderKeyError } from "../models/model-catalog";
import type { ModelCatalog, ModelProfile, ProviderDescription, ResolvedModel } from "../models/model-catalog";
import { classifyProviderError } from "../provider-errors/classify-provider-error";
import { describeProviderFailure } from "../provider-errors/provider-failure-log";
import { sleep } from "../provider-errors/transient-retry-middleware";
import type { LongTermMemory } from "../memory/long-term-memory";
import type { ModelSilenceLimits } from "../provider-errors/model-silence";
import { MessageAlreadyFinishedError } from "../storage/chat-storage";
import type { ChatStorage, FinishedMessagePatch } from "../storage/chat-storage";
import { createAnswerSaver } from "./answer-saver";
import { environmentSecrets } from "../text/scrub-secrets";
import type { CacheMissWatch } from "../usage/cache-miss-watch";
import { recordSpentTokens, usageMinusJournaled } from "../usage/record-usage";
import { settleGenerationUsage } from "../usage/settle-generation-usage";
import {
  AUTO_CONTINUES_PER_TURN,
  autoContinueNoteMessage,
  closingChunksForHangingCalls,
  createOpenPartsTracker,
  createSeamJoiner,
  hasAnswerContent,
  partsLeftOutOfAutoContinue,
  textAtBreak,
} from "./auto-continue";
import { createTurnBrowserTools } from "./browser-tools";
import type { PendingBrowserCalls } from "./browser-tools";
import { buildModelRequest } from "./build-model-request";
import { lastStepSettings, STEP_LIMIT_PART_TYPE, turnBudgetSettings } from "./last-step";
import { createTurnBudget } from "./turn-budget";
import type { TurnBudget } from "./turn-budget";
import type { TurnSpendingRules } from "../spending/spending-limits";
import { LENGTH_CUT_PART_TYPE } from "./length-cut";
import { createDataChangeNotifier } from "./data-changes";
import type { ModeNotes } from "./mode-notes";
import { createReasoningTimer } from "./reasoning-timer";
import { decideNextAttempt, fallbackProviders, nextSilenceProvider, resolveSilenceSwitch } from "./next-attempt";
import { chunksForParts } from "./parts-to-chunks";
import { checkedReplyText, createHeldReplyText, createReplyRewrite, createSeenTexts, createShownSteps, lastTextIndex, replacementChunks, withTextAt } from "./reply-checks";
import type { SeenTexts, TurnReplyChecks } from "./reply-checks";
import { erasableStepStart, STEP_RESET_PART_TYPE, STEPS_MAY_RESET_PART_TYPE } from "./step-reset";
import type { NextAttempt, ProviderFallbackSetting } from "./next-attempt";
import { createRepairToolCall, describeToolInputRepair } from "./repair-tool-call";
import { createToolQueue, withSequentialTools } from "./sequential-tools";
import type { ResolvedSequentialTools, ToolQueue } from "./sequential-tools";
import { trackToolErrors } from "./tool-errors";
import type { TurnObserver } from "./turn-observer";
import { createTurnUsage, estimateTextTokens, sumOfSteps } from "./turn-usage";
import { createStepCacheMarks, estimateMessagesTokens } from "./step-cache-mark";
import { createStepSnapshots } from "./step-context";
import type { StepContext } from "./step-context";
import type { TurnUsage } from "./turn-usage";
import { gateToolApproval, gateToolCalls } from "./tool-call-gate";
import { resolveToolTimeout, withToolTimeout } from "./tool-timeout";
import type { ResolvedToolTimeout } from "./tool-timeout";
import { resolveToolResultLimit } from "./tool-result-limit";
import type { ResolvedToolResultLimit } from "./tool-result-limit";
import { runTurnAttempt } from "./turn-attempt";
import type { TurnAttempt } from "./turn-attempt";
import type { AppEvent, StaffActor } from "../turn-hooks/turn-hooks";
import { APP_EVENT_PART_TYPE, createAppEventEmitter } from "../turn-hooks/app-events";
import type { PreparedTurn } from "../turn-hooks/turn-preparation";
import type { AppEventEmitter } from "../turn-hooks/app-events";
import { CHAT_CLOSED_PART_TYPE } from "../access/chat-closure";
import { chatHasExternalContent, createExternalContentWatch, externalContentChunk } from "../external-content/external-content";
import type { ChatClosure } from "../access/chat-closure";
import { createChatClosureRequest } from "./chat-closure-request";
import type { ChatClosureRequest } from "./chat-closure-request";
import { APP_STATE_PART_TYPE, createAppStateWriter, foldAppState, publicAppState } from "../app-state/app-state";
import type { AppStateRecord } from "../app-state/app-state";
import { CLOSED_STATE_KEY, publicStateChunk } from "../app-state/state-messages";
import type { HiddenStateKey } from "../app-state/state-messages";
import { FROZEN_CONTEXT_PART_TYPE, latestFrozenContextOf } from "../frozen-context/context-blocks";
import type { ContextBlocksSource, FrozenContextData } from "../frozen-context/context-blocks";
import { frozenContextForTurn, resumeNoteForTurn } from "../frozen-context/turn-context";
import { createEndTurnRequests, END_TURN_PART_TYPE, endTurnModel } from "./end-turn";
import type { EndTurnRequests } from "./end-turn";
import type { AppStateAccess, AppStateValues, AppStateWriter } from "../app-state/app-state";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_TOOL_RESULT_LIMIT = resolveToolResultLimit(undefined);
const DEFAULT_TOOL_TIMEOUT = resolveToolTimeout(undefined);

/** Выбранная модель: по ней приложение решает, какие инструменты ей дать. */
export interface AgentToolsModel {
  profile: ModelProfile;
  providerId: string;
  /** Чат, в котором идёт ход: нужен инструментам, которые читают историю этого чата. */
  chatId: string;
  /** Человек, чей ход идёт: нужен инструментам, у которых есть данные на человека (например, память). */
  ownerId: string;
  /** Где сейчас человек в приложении (после обрезки по пределам); нет места — `null`. Одно на все шаги хода. */
  place: ScreenPlace | null;
  /**
   * Номер хода — id ответа агента: один на все попытки хода и на запасного провайдера. По нему инструмент считает
   * пределы «N за ход», которые не должны обнуляться на повторной попытке. Нет — вызов вне хода (сжатие истории).
   */
  turnId?: string;
  /**
   * Сообщить браузеру вкладки, где идёт ответ, что данные приложения изменены. Звать после записи: сообщение уходит сразу,
   * не дожидаясь конца вызова. Неверная форма — `TypeError`; после конца хода — ничего, запись в журнал.
   */
  notifyDataChanged(change: DataChange): void;
  /** Откуда ход: веб или мессенджер. Ядро ставит всегда; нет (модель собрана вне ядра) — веб. */
  channel?: AgentChannel;
  /** С кем говорит агент: один человек или группа. Ядро ставит всегда; нет — `"private"`. */
  audience?: AgentAudience;
  /** Id ответа агента, в котором идёт ход. Ядро ставит всегда; у фоновых помощников — пустая строка. */
  messageId?: string;
  /**
   * Положить событие приложения в ответ агента: часть пишется в ответ сразу и уходит в поток. Неверная форма —
   * `TypeError`. Нет — ход без событий приложения.
   */
  emitAppEvent?(event: AppEvent): void;
  /**
   * Сотрудник, который делает ход в копии чата человека; нет — ход делает сам владелец. Есть — инструмент только
   * читает данные `ownerId`: любая запись в них запрещена (отказать текстом), это обязанность инструментов приложения.
   */
  staff?: StaffActor;
  /**
   * Объект чата (урок, заказ…): ключ и данные, с которыми чат открыт (`openSubjectChat`). Одно на все шаги хода; модели
   * сам не уходит. Нет — обычный чат.
   */
  subject?: ChatSubject;
  /**
   * Чат, в котором идёт ход: `data` — данные чата (`Chat.data`), как они записаны к началу хода; нет данных — поля нет.
   * Одно на все шаги хода; модели сами не уходят. Ядро ставит всегда; нет (модель собрана вне ядра) — данных нет.
   */
  chat?: { data?: Record<string, unknown> };
  /**
   * Закрыть чат (заявка отправлена). Флаг `closed` пишется сразу: сервер упадёт посреди хода — чат всё равно закрыт.
   * После записи итога вкладка закрывает поле ввода, в канал наблюдения уходит `chat-closed`. Применяется при любом
   * итоге хода, в том числе после «Стопа»; запросы подтверждения и виджеты, ждущие в конце хода, закрываются отказом.
   * Повторный вызов заменяет код и текст. Неверный код — `TypeError`; после конца хода — ничего, запись в журнал.
   * Нет — хранилище не умеет закрывать чат.
   */
  closeChat?(closure: ChatClosure): void;
  /**
   * Состояние чата на ветке: `get(path?)`, `set(path, value)`, `unset(path)`, путь — ключи через точку (`fields.email`).
   * Запись ложится частью ответа рядом с результатом вызова: правка, «Переделать» и выбор ветки меняют состояние сами.
   * Только значения (JSON), без прибавок: повтор вызова ничего не задваивает. Запись до 16 КБ, всё состояние до 256 КБ —
   * больше `AppStateTooLargeError`. После конца хода запись не принимается, строка в журнал. Одно на все шаги хода.
   * Нет — вызов вне хода (сжатие, фоновая задача): вне хода приложение пишет в данные чата.
   */
  state?: AppStateAccess;
}

/** Инструменты агента: один набор для всех моделей или набор, зависящий от выбранной модели. */
export type AgentToolsSource = ToolSet | ((model: AgentToolsModel) => ToolSet);
export interface AgentTurnInput {
  storage: ChatStorage;
  /** Живые демонстрации включены (`agent.liveDemos`): только тогда клиенту идёт признак чужого текста. */
  liveDemos?: boolean;
  /** Ключи состояния, которые не уходят в поток браузера; нет — только служебные ключи SDK (`$…`). */
  hiddenStateKey?: HiddenStateKey;
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  chatId: string;
  /** Владелец чата: на него пишется расход токенов хода. Нет — расход не записывается. */
  ownerId?: string;
  /** Id будущего сообщения агента. */
  messageId: string;
  /** Сообщение собеседника, на которое отвечает агент. */
  parentId: string;
  modelId: string;
  providerId: string;
  /** Выбранный уровень рассуждений. */
  reasoning?: string;
  instructions: string;
  tools?: AgentToolsSource;
  /** Помощники: каждый — инструмент `helper_<имя>` основного агента со своим циклом (фоновые здесь не участвуют). */
  helpers?: Record<string, AgentHelper>;
  /** Проверка лимита расходов перед каждым шагом помощника; бросает `SpendingLimitReachedError`. */
  assertWithinLimit?: () => Promise<void>;
  maxSteps?: number;
  /** Потолки хода: деньги и вызовы инструментов (`SpendingLimits.turnRules`). Нет — только лимит шагов. */
  turnRules?: TurnSpendingRules;
  /**
   * Текущая ветка до ответа включительно с сообщением собеседника (у сжатой истории — сводка и хвост).
   * Функция вызывается, когда сообщение агента уже в хранилище: ход может ждать сжатия, а поток уже открыт.
   */
  history: readonly AgentChatMessage[] | (() => Promise<readonly AgentChatMessage[]>);
  /** Вложения: что модель увидит вместо частей `file` истории. */
  attachments?: MessageAttachments;
  /** Пометки смены режима для модели; в историю не пишутся (см. `buildModelRequest`). */
  modeNotes?: ModeNotes;
  /**
   * Долгая память: блоки записей читаются один раз на видимую историю чата — в первом ходе и после сжатия — и застывают
   * в вопросе хода (`frozenContextForTurn`). Нужен `ownerId`: без него память не читается.
   */
  memory?: Pick<LongTermMemory, "snapshot" | "blocks">;
  /** Место на экране, уже проверенное по пределам: идёт инструментам и застывшим блоком в вопрос хода. */
  place?: ScreenPlace | null;
  /** Продолжение, чья страница не прислала место: заметка продолжения оставляет блок места прежним (`resumeNoteForTurn`). */
  samePlace?: boolean;
  /** Откуда ход; нет — веб. Идёт инструментам в `AgentToolsModel.channel`. */
  channel?: AgentChannel;
  /** Объект чата: идёт только инструментам в `AgentToolsModel.subject`, в запрос к модели не попадает. Нет — обычный чат. */
  subject?: ChatSubject;
  /** Данные чата: идут только инструментам в `AgentToolsModel.chat.data`, в запрос к модели не попадают. */
  chatData?: Record<string, unknown>;
  /**
   * Состояние чата на ветке до этого хода (у продолжения — вместе с уже записанными частями ответа), свёртка по ветке
   * хранилища: основа `AgentToolsModel.state`. Нет — свёртка `history` (сжатая история может потерять записи).
   */
  appState?: AppStateValues;
  /**
   * Подготовка хода (`agent.prepareTurn`): зовётся до застывших блоков с состоянием ветки. Её записи — основа состояния
   * хода и частями в начале ответа, служебные сообщения — модели вместе с блоками. Нет или `undefined` — ход как раньше.
   */
  prepareTurn?: (turn: { state: AppStateValues; abortSignal: AbortSignal }) => Promise<PreparedTurn | undefined>;
  /** Готовый ответ без модели (`deliverNotices` с `reply`): текстом одного шага, модель не зовётся. */
  reply?: string;
  /** Метка расхода хода в журнале. Нет — `answer`; агент пишет первым — `first_message` (`deliverNotices`). */
  usageSource?: UsageSource;
  /**
   * Проверки законченного ответа перед записью (`createChatService({ replyChecks })`): правят последнюю текстовую часть.
   * Готовый ответ (`reply`) не проверяется. Веб-чат печатает как обычно и заменяет шаг исправленным (`replace`) или
   * придерживает текст до проверки (`hold`); мессенджеры придерживают всегда. Нет — ход и поток прежние.
   */
  replyChecks?: TurnReplyChecks;
  /**
   * Снимок перед каждым шагом модели: сообщением человека в самый конец запроса шага, в историю не пишется. Всё до него
   * от шага к шагу не меняется (кэш модели). Нет — запрос побайтно прежний.
   */
  stepContext?: StepContext;
  /** Срок ответа `stepContext`, мс, уже проверенный; `Infinity` — без срока. Нет — 5 с. */
  stepContextTimeoutMs?: number;
  /** Блоки приложения для вопроса хода: один опрос в начале хода, дальше застывают в ответе (`agent.contextBlocks`). */
  contextBlocks?: ContextBlocksSource;
  /** Срок ответа `contextBlocks`, мс, уже проверенный; `Infinity` — без срока. Нет — 5 с. */
  contextBlocksTimeoutMs?: number;
  /**
   * Групповой ход: без блока памяти; из инструментов приложения и помощников — только `allowedTools` (у помощника —
   * `helper_<имя>`). Автора модель видит по отметке сообщения (см. `withChannelNotes`).
   */
  group?: GroupTurn;
  /**
   * Браузерные инструменты: описания (без `execute`) становятся инструментами, которые ждут ответа вкладки `tabId`.
   * Повтор имени с инструментами приложения — ошибка хода.
   */
  browserTools?: { descriptions: ToolSet; pending: PendingBrowserCalls; timeoutMs: number; tabId?: string };
  abortSignal: AbortSignal;
  /**
   * Продолжение ответа: новые куски дописываются в то же сообщение. После подтверждения `message` — сообщение
   * с отмеченными решениями (уже в хранилище), `usage` — расход, накопленный до паузы. После «Повторить» `message` —
   * сосед с копией выполненных шагов, `usage` — `null`, `replay` — записать соседа (`parentId`, `createdAt`) и сначала
   * отдать клиенту куски копии: ни в хранилище, ни у клиента этого сообщения ещё нет.
   */
  resume?: {
    message: AgentChatMessage;
    usage: TokenUsage | null;
    replay?: boolean;
    /**
     * Части, что служба дописала в ответ вместе с решением человека (записи состояния и события проверки ответа
     * виджета): уже в хранилище, клиенту отдаются сразу после `start`, до продолжения. Нет — ничего.
     */
    announced?: AgentChatMessage["parts"];
  };
  /** Инструменты, про которые человек нажал «Всегда в этом чате»: подтверждение для них не запрашивается. */
  alwaysAllowedTools?: ReadonlySet<string>;
  /**
   * Имена ждущих виджетов (их инструменты уже в `tools`): вызов без результата ставит ход на паузу, как запрос
   * подтверждения. Нет — инструмент без `execute` ход не ждёт, как раньше.
   */
  waitingWidgets?: ReadonlySet<string>;
  /** Виджеты, которые чат может выключить: прошлые вызовы выключенных идут модели текстом (`buildModelRequest`). */
  switchableTools?: ReadonlySet<string>;
  /** Сотрудник, который делает ход в копии чата человека: идёт инструментам в `AgentToolsModel.staff`. */
  staff?: StaffActor;
  /** Время создания ответа; по умолчанию — сейчас. */
  createdAt?: string;
  /** Журнал сервера для сбоев, которые чинит администратор, а не собеседник. По умолчанию `console.error`. */
  logError?: (message: string) => void;
  /**
   * Вызывается сразу после записи итога хода, до последних кусков потока: клиент, узнавший о конце ответа, застаёт
   * уже сделанное хуком. Ход хук не ждёт, сбой уходит в журнал. Для дел «после ответа», например сжатия.
   * `answeredProviderId` — провайдер, который ответил: при запасном — запасной, а не лежащий основной.
   */
  onFinished?: (result: { status: FinalAnswerStatus; messageId: string; answeredProviderId: string }) => void | Promise<void>;
  /**
   * Хук итога хода (служба собирает его из `ChatServiceOptions.afterTurn`). Есть — итог пишется с `afterTurn: "pending"`,
   * а после записи расхода ход ждёт хук: он сам закрывает состояние и дописывает события в ответ, а возвращает
   * дописанные — они уходят клиенту до `message-metadata` и `finish`. Ответ, перехваченный другой копией или не
   * записанный до конца, хук не получает: его позовёт восстановление. `providerId` — ответивший провайдер. `stopWaiting`
   * («Стоп» хода) — хук больше не ждут: он отдаёт `[]` и доделывается сам. Нет — запись и поток прежние.
   */
  afterTurn?: (finished: {
    status: FinalAnswerStatus;
    parts: AgentChatMessage["parts"];
    usage: TokenUsage | null;
    error: { kind: ChatErrorKind } | null;
    providerId: string;
  }, stopWaiting: AbortSignal) => Promise<AppEvent[]>;
  /** Итог ответа записан в хранилище, до расхода и `afterTurn`: для срока хода, который не должен обрывать хук. */
  onAnswerWritten?: () => void;
  /**
   * Закрытие чата, о котором попросил инструмент (`model.closeChat`), записано в ответ (`$closed`): зовётся после
   * записи итога, до `afterTurn` — копия для списка и событие. Нет — у инструментов нет `closeChat`.
   */
  closeChat?: (closure: ChatClosure) => Promise<void>;
  /** Сразу при вызове `model.closeChat`, вместе с записью в ответ: копия для списка, без события. */
  recordChatClosure?: (closure: ChatClosure) => Promise<void>;
  /**
   * Закрыт ли чат сейчас: спрашивается, только если ход кончается на паузе (ждёт подтверждения или виджета). Закрыт —
   * ждущие запросы закрываются отказом, как при «Стопе»: закрытие побеждает паузу.
   */
  isChatClosed?: () => Promise<boolean>;
  /** Пока ход идёт, кладёт сюда функцию «записать несохранённое сейчас»: её зовёт `ChatService.flush`. */
  flushers?: Set<() => Promise<void>>;
  /** Предел результата инструмента, уже проверенный. Нет — 50 000 знаков. */
  toolResultLimit?: ResolvedToolResultLimit;
  /** Запасные провайдеры той же модели, уже проверенные. Нет — значение по умолчанию из `next-attempt`. */
  providerFallback?: ProviderFallbackSetting;
  /** Сроки ответа серверных инструментов по имени, уже проверенные. Нет — 120 с всем. */
  toolTimeout?: ResolvedToolTimeout;
  /** Серверные инструменты, которые идут по одному (FR-049), уже проверенные. Нет — все вместе. */
  sequentialTools?: ResolvedSequentialTools;
  /**
   * Очередь инструментов «по одному» чата: служба держит одну на чат, чтобы «Стоп» и сразу «Повторить» не пустили
   * второй вызов, пока первый, не слушающий отмену, ещё идёт. Нет — своя на ход.
   */
  toolQueue?: ToolQueue;
  /** Часы хода: сегодняшняя дата для хвоста запроса берётся один раз за ход. По умолчанию — сейчас. */
  now?: () => Date;
  /** Часовой пояс человека для даты в хвосте запроса, уже проверенный (IANA). Нет — пояс сервера. */
  timeZone?: string;
  /** Сроки молчания потока модели, уже проверенные. Нет — `DEFAULT_MODEL_SILENCE`. В запрос к модели не идут. */
  modelSilence?: ModelSilenceLimits;
  /** Предел токенов ответа в каждом запросе к модели (`agent.maxOutputTokens` модели хода), уже проверенный. Нет — без предела. */
  maxOutputTokens?: number;
  /**
   * Спрашивается перед каждым новым заходом к модели после сбоя (запасной, автопродолжение, переход при молчании, после
   * сжатия). `false` — служба останавливается: нового захода нет, ход кончается остановкой. Ответ `false` сам
   * останавливает ход, а служба заодно обрывает его своей причиной. Нет — заходы всегда разрешены.
   */
  newAttemptAllowed?: () => boolean;
  /**
   * Ждут ли ответ поправки человека (`ChatService.steer`). Спрашивается после каждого шага с вызовами: `true` — ход
   * кончается на этой границе шага, без итогового шага. Нет — ход идёт как раньше.
   */
  correctionsWaiting?: () => boolean;
  /**
   * Ход упёрся в окно модели (FR-012): сжать историю чата до вопроса и отдать её для ответа. `null` — сжимать нечего
   * или не вышло. Идущее сжатие чата дожидается; «Стоп» обрывает ожидание ошибкой отмены. Нет — переполнение сразу
   * ошибка хода.
   */
  compactForOverflow?: (input: { providerId: string; abortSignal: AbortSignal }) => Promise<AgentChatMessage[] | null>;
  /**
   * Сжатие внутри хода: в окно не влез уже сам текущий ответ. Пересказать его первые шаги `steps` по истории хода
   * `history` (до ответа). `null` — не вышло. Нет — после сжатия истории переполнение сразу ошибка хода.
   */
  compactAnswerSteps?: (input: {
    history: readonly AgentChatMessage[];
    steps: AgentChatMessage["parts"];
    providerId: string;
    abortSignal: AbortSignal;
  }) => Promise<string | null>;
  /** Следилка за промахами кэша: общая на службу, помнит прошлые запросы чатов. Нет — промахи не отмечаются. */
  cacheMissWatch?: CacheMissWatch;
  /**
   * Наблюдатель хода (песочница): каждое обращение к модели и каждый вызов серверного инструмента — событием.
   * Нет — ни прослойки модели, ни обёртки инструментов: запрос побайтно прежний.
   */
  turnObserver?: TurnObserver;
}

/**
 * Один ход агента: создаёт сообщение агента, ведёт модель по шагам, пишет ответ в хранилище
 * по ходу и отдаёт куски UI-потока. Последние куски — `message-metadata` с итогом, затем
 * `error` с видом ошибки, если она была, и `finish` или `abort`; к этому моменту хранилище
 * уже в конечном состоянии. Итог идёт раньше `error`: на куске `error` клиент перестаёт читать.
 */
export function runAgentTurn(input: AgentTurnInput): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      // Служебные и закрытые ключи состояния остаются на сервере: в поток — записи без них (FR-003).
      runTurn(input, (chunk) => {
        const visible = publicStateChunk(chunk, input.hiddenStateKey);
        if (visible) controller.enqueue(visible);
      }).then(
        () => controller.close(),
        (error: unknown) => controller.error(error),
      );
    },
  });
}

/** Шаги хода для попытки: сделано до неё и предел на весь ход. */
interface TurnSteps {
  done: number;
  max: number;
  /** Шагов в ответе до паузы (подтверждение, виджет, «Повторить»): номер шага для `stepContext` идёт по всему ответу. */
  beforeResume: number;
}

async function runTurn(turnInput: AgentTurnInput, emitRaw: (chunk: UIMessageChunk) => void): Promise<void> {
  // Чужой текст (вызов с пометкой `externalContent`, итог помощника с ней) — клиенту сразу, раньше следующего текста.
  const externalContent = createExternalContentWatch();
  const emitShown = (chunk: UIMessageChunk): void => {
    shownSteps?.observe(chunk);
    emitRaw(chunk);
    if (turnInput.liveDemos && externalContent.observe(chunk)) emitRaw(externalContentChunk());
  };
  // Проверка ответа: что агент видел за ход и придержка текста до проверки (`hold`, мессенджеры).
  const replyChecks = turnInput.reply === undefined ? turnInput.replyChecks : undefined;
  const seenTexts = replyChecks && createSeenTexts();
  const heldText = replyChecks && (replyChecks.web === "hold" || (turnInput.channel ?? "web") !== "web") ? createHeldReplyText() : undefined;
  const shownSteps = replyChecks && createShownSteps();
  const emitToClient = (chunk: UIMessageChunk): void => {
    for (const passed of heldText ? heldText.pass(chunk) : [chunk]) emitShown(passed);
  };
  // Ответ прервала другая копия сервера (сочла его брошенным): ход останавливается сам, как по «Стопу» (FR-060).
  const takeover = new AbortController();
  // Служба останавливается: нового захода нет, ход остановлен (`newAttemptAllowed`).
  const noNewAttempts = new AbortController();
  const input: AgentTurnInput = { ...turnInput, abortSignal: AbortSignal.any([turnInput.abortSignal, takeover.signal, noNewAttempts.signal]) };
  const { storage, messageId, modelId, resume } = input;
  const logError = input.logError ?? console.error;
  const startedAt = new Date().toISOString();
  // Новый ответ и сосед-продолжение после «Повторить» (со скопированными шагами) записываются здесь, уже запущенным ходом.
  if (!resume || resume.replay) {
    await storage.insertMessage(
      newStoredMessage({
        id: messageId,
        chatId: input.chatId,
        parentId: input.parentId,
        role: "assistant",
        status: "streaming",
        modelId,
        providerId: input.providerId,
        ...(resume && { parts: resume.message.parts, reasoningDurationsMs: resume.message.metadata?.reasoningDurationsMs ?? {} }),
        ...(input.createdAt && { createdAt: input.createdAt }),
        // Время создания у соседа после «Повторить» может быть старым: знак жизни — сейчас (FR-060).
        alive: "now",
      }),
    );
  }

  const timer = createReasoningTimer(
    Date.now,
    resume && {
      count: resume.message.parts.filter((part) => part.type === "reasoning").length,
      durations: resume.message.metadata?.reasoningDurationsMs ?? {},
    },
  );
  // Расход хода по шагам всех попыток (запасной, продолжение после сжатия — тоже в итог хода, FR-013); у шага без чисел
  // провайдера и у оборванного шага — оценка.
  const turnUsage = createTurnUsage();
  const turnBudget = createTurnBudget(input.turnRules, { catalog: input.catalog, modelId: input.modelId, turnUsage });
  // Расход сообщения: накопленный по паузам и продолжениям (`resume.usage`) и расход этого хода.
  const messageUsage = (): TokenUsage | null => {
    const spent = turnUsage.total();
    return spent ? addUsage(resume?.usage ?? null, spent) : (resume?.usage ?? null);
  };
  // Каждая запись ответа по ходу несёт расход сообщения вместе с ещё не записанным в журнал расходом хода: после
  // перезапуска он не теряется (FR-052), а восстановление пишет в журнал только то, чего там ещё нет.
  // Идущая запись несёт и шаги хода с провайдерами: по ним восстановление выберет ступени цены и провайдеров.
  const streamingUsage = (): TokenUsage | null => {
    const usage = messageUsage();
    const pendingSteps = turnUsage.pendingSteps();
    return usage && pendingSteps.length > 0 ? { ...usage, pendingSteps } : usage;
  };
  const saver = createAnswerSaver(storage, messageId, timer.durations, streamingUsage, () => takeover.abort(), resume?.message);
  input.flushers?.add(saver.flush);
  try {
    // Лимит шагов — на весь ход: каждая попытка получает остаток.
    const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
    let stepsDone = 0;
    const stepsBeforeResume = resume?.message.parts.filter((part) => part.type === "step-start").length ?? 0;
    let started = false;
    // Незакрытые текст и рассуждения: перед автопродолжением они получают закрывающие куски.
    const openParts = createOpenPartsTracker();
    // Шов автопродолжения: потерянный моделью перенос строки подставляется в начало продолжения.
    const seam = createSeamJoiner();
    // Шаг модели начат и не закончен: его можно стереть при переходе посреди ответа.
    let stepOpen = false;
    // Каждый кусок клиенту идёт и в запись. `start` — один на ход: повторный (от попытки) не нужен ни там, ни там.
    const emitNow = (chunk: UIMessageChunk): void => {
      if (chunk.type === "start") {
        if (started) return;
        started = true;
      }
      if (chunk.type === "start-step") stepOpen = true;
      else if (chunk.type === "finish-step") stepOpen = false;
      openParts.observe(chunk);
      saver.observe(chunk);
      emitToClient(chunk);
      if (timer.observe(chunk)) {
        const metadata: ChatMessageMetadata = { reasoningDurationsMs: timer.durations() };
        saver.observe({ type: "message-metadata", messageMetadata: metadata });
        emitToClient({ type: "message-metadata", messageMetadata: metadata });
      }
    };
    const emit = (chunk: UIMessageChunk): void => {
      for (const passed of seam.pass(chunk)) emitNow(passed);
    };
    const dataChanges = createDataChangeNotifier({ emit: emitToClient, logError, chatId: input.chatId });
    // События приложения от инструментов — части ответа: пишутся и идут клиенту.
    const appEvents = createAppEventEmitter({ emit, logError, chatId: input.chatId });
    // Состояние чата от инструментов — части ответа: пишутся и идут клиенту. Основа известна после чтения истории.
    let appState: AppStateWriter | undefined;
    // Служебные ключи хода (закрытие чата) — своим писателем: инструменту они не видны.
    let reservedState: AppStateWriter | undefined;
    // Закрытие чата из инструментов: запись `$closed` в ответ сразу, событие и кусок потока — после записи итога.
    const chatClosure = createChatClosureRequest({
      logError,
      chatId: input.chatId,
      write: (closure) => reservedState?.set(CLOSED_STATE_KEY, closure),
      ...(input.recordChatClosure && { record: input.recordChatClosure }),
    });
    // Очередь серверных инструментов «по одному» — на чат или хотя бы на весь ход: попытки хода её делят.
    const toolQueue = input.toolQueue ?? createToolQueue();
    // Инструмент попросил закончить ход (`endTurn`): просьба живёт на весь ход — новая попытка сразу её исполняет.
    const endTurns = createEndTurnRequests();
    // Чем кончился последний шаг: «length» — ответ оборван пределом длины (FR-054).
    let lastFinishReason: string | undefined;
    const browser = input.browserTools && createTurnBrowserTools({ ...input.browserTools, tabId: input.browserTools.tabId, chatId: input.chatId, emit: emitToClient, signal: input.abortSignal });

    let errors: UIMessageChunk[] = [];
    let terminal: UIMessageChunk[] = [];
    let errorKind: ChatErrorKind | undefined;
    let providerId = input.providerId;
    let answeredProviderId = input.providerId;
    try {
      const { history: historySource } = input;
      const fullHistory = typeof historySource === "function" ? await historySource() : historySource;
      const branchState = input.appState ?? foldAppState(fullHistory);
      // Подготовка приложением — до блоков: её записи видят блоки контекста и инструменты этого хода.
      const prepared = input.prepareTurn && (await input.prepareTurn({ state: branchState, abortSignal: input.abortSignal }));
      const turnNotices = prepared && prepared.notices.length > 0 ? prepared.notices : undefined;
      const stateBase = prepared?.state ?? branchState;
      const writeState = (record: AppStateRecord) => emit({ type: APP_STATE_PART_TYPE, data: record });
      appState = createAppStateWriter({ base: stateBase, write: writeState, logError, chatId: input.chatId });
      reservedState = createAppStateWriter({ base: stateBase, write: writeState, logError, chatId: input.chatId, reserved: true });
      // Продолжение несёт сам ответ последним сообщением истории: история хода до ответа и ответ дальше живут отдельно.
      const answer = createAnswerForRequest({
        messageId,
        history: fullHistory.filter((message) => message.id !== messageId),
        inHistory: fullHistory.find((message) => message.id === messageId),
        original: resume?.message,
      });
      // Блоки контекста — один раз на ответ: дальше все запросы хода берут их из части ответа, байты те же.
      const frozenOfTurn = await frozenContextForTurn(input, {
        history: answer.request().history,
        answer: resume?.message ?? fullHistory.find((message) => message.id === messageId),
        state: publicAppState(appState.values()),
      });
      // Служебные сообщения подготовки — в части блоков: модель видит их в вопросе этого хода, дальше — те же байты.
      const frozen = turnNotices && frozenOfTurn.fresh ? { ...frozenOfTurn, data: { ...frozenOfTurn.data, notices: turnNotices } } : frozenOfTurn;
      // Человек ответил на паузе (виджет, подтверждение): новое в блоках — заметкой сразу за его ответом, частью ответа.
      let resumeNote =
        resume && !resume.replay && !frozen.fresh
          ? await resumeNoteForTurn(input, { history: answer.request().history, answer: resume.message, state: publicAppState(appState.values()) })
          : undefined;
      // Продолжение с сообщениями подготовки: они — заметкой продолжения, даже если блоки не менялись.
      if (resume && turnNotices && !frozen.fresh) {
        const seen = latestFrozenContextOf(resume.message.parts);
        if (seen) resumeNote = { ...(resumeNote ?? { blocks: seen.blocks, sent: { changed: [], removed: [] }, base: messageId }), notices: turnNotices };
      }
      const fallbackProviderIds = fallbackProviders({
        catalog: input.catalog,
        modelId,
        chosenProviderId: input.providerId,
        env: input.env,
        ...(input.providerFallback !== undefined && { setting: input.providerFallback }),
      });
      // Ответ открывается сразу: пока идут тихие повторы и переход к запасному, человек видит обычное ожидание.
      // `start` попыток (они его придерживают) дальше не идёт.
      emit({ type: "start", messageId, messageMetadata: { modelId, providerId: input.providerId } });
      // Чужой текст уже в чате (файл в новом сообщении, прошлые ходы, другие ветки — как в истории): клиент узнаёт об этом
      // до первого слова ответа.
      if (input.liveDemos && chatHasExternalContent(await storage.listMessages(input.chatId)) && externalContent.announce()) emitRaw(externalContentChunk());
      const silenceSetting = resolveSilenceSwitch(input.providerFallback);
      if (silenceSetting.onSilence === "restart-step-on-next" && silenceSetting.maxSwitches > 0) {
        emitToClient({ type: STEPS_MAY_RESET_PART_TYPE, data: true, transient: true });
      }
      // Копия выполненных шагов уже в сохранении: её куски идут только клиенту и мимо попытки — началом ответа модели
      // они не считаются, запасной провайдер для продолжения доступен.
      if (resume?.replay) replayCopiedParts(resume.message, emitToClient);
      if (resume?.announced) for (const chunk of chunksForParts(resume.announced)) emitToClient(chunk);
      // Часть с блоками — только в сохранение: клиенту она не нужна, а в попытке считалась бы началом ответа. Отдельной
      // записи не ждёт: часть первая, и любая запись ответа со словами её уже несёт.
      if (frozen.fresh) saver.observe({ type: FROZEN_CONTEXT_PART_TYPE, data: frozen.data });
      // Записи подготовки — сразу за блоками, до слов: в ответе и у клиента.
      for (const record of prepared?.records ?? []) writeState(record);
      if (resumeNote) {
        saver.observe({ type: FROZEN_CONTEXT_PART_TYPE, data: resumeNote });
        answer.update(await saver.snapshot(), { modelId, providerId: answeredProviderId });
      }
      // Человек ответил помощнику: сначала досчитываются помощники с сохранёнными шагами, затем основной цикл. Помощник
      // снова встал на подтверждении или пришёл «Стоп» — основной цикл не идёт.
      let mainLoopWaits = false;
      if (resume && !resume.replay) {
        const continued = helpersToContinue(resume.message.parts);
        if (continued.length > 0) {
          await continueHelpers(input, continued, { toolQueue, dataChanges, appEvents, chatClosure, appState, emit, logError });
          const parts = await saver.snapshot();
          answer.update(parts, { modelId, providerId: answeredProviderId });
          mainLoopWaits = input.abortSignal.aborted || pendingHumanInput(parts, input.waitingWidgets).length > 0;
        }
      }
      // Готовый ответ: один шаг с текстом, модель не зовётся.
      if (input.reply !== undefined && !mainLoopWaits && !input.abortSignal.aborted) {
        emitReply(input.reply, emit);
        mainLoopWaits = true;
      }
      let fallbackUsed = false;
      let historyCompacted = false;
      let answerStepsCompacted = false;
      let autoContinues = 0;
      let contentSeen = false;
      // Переход посреди ответа при молчании модели (`providerFallback.onSilence`).
      const silenceSwitch = silenceSetting;
      let silenceSwitches = 0;
      // Шаг запасного кончился: следующий шаг — снова у основного (`scope: "step"`). Только для запасного, выбранного
      // переходом при молчании: запасной по перегрузке остаётся до конца хода.
      let backToPrimary = false;
      let switchedBySilence = false;
      // Новый заход уже разрешён службой при решении о переходе: второй раз не спрашивать.
      let attemptAllowed = false;
      /** Куда перейти при молчании сейчас; `undefined` — некуда: переходы кончились, шагов на заход не осталось. */
      const silenceTarget = (): string | undefined =>
        silenceSwitch.onSilence === "restart-step-on-next" && silenceSwitches < silenceSwitch.maxSwitches && stepsDone + 1 < maxSteps
          ? nextSilenceProvider({ currentProviderId: providerId, primaryProviderId: input.providerId, fallbackProviderIds })
          : undefined;
      let attemptsOpened = 0;
      // История хода переписана сжатием или пересказом: начало следующего запроса другое, следилке кэша не с чем сравнивать.
      let historyRewritten = false;
      while (!mainLoopWaits) {
        // Новый заход после сбоя — только если служба не останавливается.
        if (attemptsOpened++ > 0 && !attemptAllowed && input.newAttemptAllowed?.() === false) {
          noNewAttempts.abort();
          break;
        }
        attemptAllowed = false;
        // Просьбы `endTurn` — только у вызовов, чей результат в ответе: стёртый или упавший вызов модель сделает заново.
        if (attemptsOpened > 1) endTurns.nextAttempt(await saver.snapshot());
        let provider: ProviderDescription | undefined;
        const classify = (error: unknown): ChatErrorKind => classifyProviderError(error, provider);
        let attempt: TurnAttempt;
        try {
          const found = findModel(input.catalog, modelId, providerId);
          provider = found.provider;
          attempt = await runAnswerAttempt(input, {
            found,
            ...answer.request(),
            steps: { done: stepsDone, max: maxSteps, beforeResume: stepsBeforeResume },
            historyRewritten,
            frozenContext: frozen.data,
            toolQueue,
            endTurns,
            browser,
            dataChanges,
            appEvents,
            chatClosure,
            appState,
            contentSeen,
            emit,
            turnUsage,
            turnBudget,
            // Есть куда перейти при молчании — у того же провайдера оно не повторяется.
            repeatSilence: () => silenceTarget() === undefined,
            ...(silenceSwitch.scope === "step" &&
              switchedBySilence && {
                backToPrimary: () => {
                  backToPrimary = true;
                },
              }),
            onStep: (finishReason) => {
              stepsDone += 1;
              lastFinishReason = finishReason;
            },
            callSaved: saver.whenCallSaved,
            ...(seenTexts && { seenTexts }),
          });
        } catch (error) {
          // Сбой до запроса к модели (нет ключа, конфликт имён инструментов): переходить некуда.
          if (error instanceof MissingProviderKeyError) logError(error.message);
          if (!input.abortSignal.aborted) {
            errorKind = classify(error);
            errors = [{ type: "error", errorText: errorKind }];
          }
          break;
        }
        const { result } = attempt;
        historyRewritten = false;
        if (result.outcome !== "failed" || result.contentSeen) answeredProviderId = providerId;
        // Шаг запасного кончился, а ход идёт дальше: следующий шаг — у основного. Конец попытки клиенту не нужен.
        if (result.outcome === "ok" && backToPrimary) {
          backToPrimary = false;
          switchedBySilence = false;
          providerId = input.providerId;
          answer.update(await saver.snapshot(), { modelId, providerId: answeredProviderId });
          turnUsage.closeAttempt();
          continue;
        }
        backToPrimary = false;
        if (result.outcome !== "failed") {
          terminal = attempt.terminal;
          // Ответ упёрся в предел длины: отметка в конце ответа — её видят человек и модель на следующих ходах.
          if (result.outcome === "ok" && lastFinishReason === "length") emit({ type: LENGTH_CUT_PART_TYPE, data: true });
          // Ход упёрся в предел шагов: отметка в конце ответа (её видит `afterTurn`) и строка в журнале.
          if (result.outcome === "ok" && stepsDone >= maxSteps && (maxSteps > 1 || lastFinishReason === "tool-calls")) {
            emit({ type: STEP_LIMIT_PART_TYPE, data: true });
            logError(`[предел шагов] чат=${input.chatId} ответ=${messageId} модель=${modelId} шагов=${maxSteps}`);
          }
          break;
        }
        contentSeen ||= result.contentSeen;
        // Продолжение — с частями, которые уже есть: выполненные инструменты второй раз не запускаются.
        const parts = await saver.snapshot();
        const overflowCompaction = () => ({
          history: Boolean(input.compactForOverflow) && !historyCompacted,
          answerSteps: Boolean(input.compactAnswerSteps) && !answerStepsCompacted && splitAnswerSteps(parts) !== null,
        });
        const nextState = () => ({
          fallbackUsed,
          // С запасного — только провайдеры после него: перегрузка у запасного не ведёт обратно к нему же.
          fallbackProviderIds: providerId === input.providerId ? fallbackProviderIds : fallbackProviderIds.slice(fallbackProviderIds.indexOf(providerId) + 1),
          overflowCompaction: overflowCompaction(),
          autoContinue: { done: autoContinues, approvalRequested: pendingHumanInput(parts, input.waitingWidgets).length > 0 },
          silenceSwitch: { done: silenceSwitches, max: silenceSwitch.maxSwitches, nextProviderId: silenceTarget() },
        });
        // Шаги хода кончились — новой попытке делать нечего.
        let next: NextAttempt = stepsDone < maxSteps ? decideNextAttempt(result, nextState()) : { action: "fail" };
        if (next.action === "fallback") {
          logError(`[запасной провайдер] чат=${input.chatId} модель=${modelId} с=${providerId} на=${next.providerId} причина=${result.kind} кэш потерян`);
          fallbackUsed = true;
          switchedBySilence = false;
          providerId = next.providerId;
          // Продолжение после подтверждения: одобренный инструмент уже выполнен до запроса к модели. Запасной получает
          // ответ с его результатом, иначе SDK выполнил бы инструмент второй раз.
          answer.update(parts, { modelId, providerId: answeredProviderId });
          turnUsage.closeAttempt();
          // «Стоп» пришёл в момент перехода: запрос к запасному не строится, ход остановлен.
          if (input.abortSignal.aborted) break;
          continue;
        }
        // Модель молчит: шаг заново у следующего провайдера. Показанное в шаге стирается, начатый инструмент — нет.
        if (next.action === "restart-step") {
          // Остановка службы или «Стоп» — перехода не будет: показанное не стирается, ход останавливается как прежде.
          attemptAllowed = input.newAttemptAllowed?.() !== false;
          if (!attemptAllowed || input.abortSignal.aborted) {
            if (!attemptAllowed) noNewAttempts.abort();
            answer.update(parts, { modelId, providerId: answeredProviderId });
            break;
          }
          silenceSwitches += 1;
          stepsDone += 1;
          for (const chunk of [...seam.flush(), ...openParts.closingChunks()]) emitNow(chunk);
          const broken = await saver.snapshot();
          const eraseFrom = stepOpen ? erasableStepStart(broken) : null;
          const metadata = { modelId, providerId: answeredProviderId };
          let stepFate: "стёрт" | "сохранён" | "не начат" = "не начат";
          if (eraseFrom !== null) {
            stepFate = "стёрт";
            emitToClient({ type: STEP_RESET_PART_TYPE, data: { providerId: next.providerId } });
            const kept = await saver.rewind(eraseFrom);
            timer.rewind(kept.filter((part) => part.type === "reasoning").length);
            // Стёртое — не ответ: перегрузка у следующего до первого куска ведёт к запасному, а не к автопродолжению.
            contentSeen = hasAnswerContent(kept);
            answer.update(kept, metadata);
          } else if (stepOpen) {
            // В шаге уже идёт инструмент: шаг остаётся, ответ продолжается у следующего, как автопродолжение.
            stepFate = "сохранён";
            for (const chunk of closingChunksForHangingCalls(broken)) emitNow(chunk);
            answer.continueAfterBreak(await saver.snapshot(), metadata);
          } else {
            answer.update(broken, metadata);
          }
          stepOpen = false;
          logError(
            `[переход при молчании] чат=${input.chatId} модель=${modelId} с=${providerId} на=${next.providerId} переход=${silenceSwitches} из ${silenceSwitch.maxSwitches} шаг ${stepFate} кэш потерян`,
          );
          providerId = next.providerId;
          switchedBySilence = true;
          turnUsage.closeAttempt({ erased: stepFate === "стёрт" });
          // «Стоп» пришёл в момент перехода: запрос к следующему не строится, ход остановлен.
          if (input.abortSignal.aborted) break;
          continue;
        }
        // Обрыв посреди ответа: закрыть начатое, переждать паузу и продолжить тот же ответ у того же провайдера (FR-037–FR-044).
        if (next.action === "auto-continue") {
          autoContinues += 1;
          // Недописанные текст, рассуждение и вызовы закрываются: в ответе не остаётся вечного «выполняется».
          for (const chunk of [...openParts.closingChunks(), ...closingChunksForHangingCalls(parts)]) emit(chunk);
          const brokenText = textAtBreak(parts);
          if (brokenText !== null) seam.watch(brokenText);
          logError(
            `[автопродолжение] чат=${input.chatId} модель=${modelId} провайдер=${providerId} попытка=${autoContinues} из ${AUTO_CONTINUES_PER_TURN} пауза=${next.pauseMs}мс причина=${result.kind} знаков написано=${writtenChars(parts)}`,
          );
          answer.continueAfterBreak(parts, { modelId, providerId: answeredProviderId });
          turnUsage.closeAttempt();
          try {
            await sleep(next.pauseMs, input.abortSignal);
          } catch {
            // «Стоп» на паузе: продолжения нет, ход остановлен.
            break;
          }
          continue;
        }
        // Переполнение: сжатие истории, затем — если не вышло или не помогло — пересказ первых шагов ответа.
        let compacted = false;
        if (next.action === "compact-and-continue") answer.update(parts, { modelId, providerId: answeredProviderId });
        while (next.action === "compact-and-continue" && !compacted && !input.abortSignal.aborted) {
          compacted = await compactForOverflow(next.scope, parts);
          next = decideNextAttempt(result, nextState());
        }
        if (input.abortSignal.aborted) break;
        if (compacted) {
          historyRewritten = true;
          turnUsage.closeAttempt();
          continue;
        }
        errorKind = result.kind;
        errors = attempt.errors;
        terminal = attempt.terminal;
        logError(
          describeProviderFailure(result.error, { chatId: input.chatId, modelId, providerId, kind: result.kind, env: input.env, catalog: input.catalog }),
        );
        break;
      }

      /**
       * Сжатие при переполнении (каждое — раз на ход): `history` — история чата до вопроса, `answer-steps` — пересказ
       * первых шагов текущего ответа. `true` — сжато, ход идёт дальше по сжатому. Сбой сжатия — как «не вышло».
       */
      async function compactForOverflow(scope: "history" | "answer-steps", parts: AgentChatMessage["parts"]): Promise<boolean> {
        try {
          if (scope === "history") {
            historyCompacted = true;
            const compacted = await input.compactForOverflow!({ providerId, abortSignal: input.abortSignal });
            if (compacted) answer.replaceHistory(compacted);
            return compacted !== null;
          }
          answerStepsCompacted = true;
          const steps = splitAnswerSteps(parts);
          if (!steps) return false;
          const summary = await input.compactAnswerSteps!({
            history: answer.request().history,
            steps: steps.earlier,
            providerId,
            abortSignal: input.abortSignal,
          });
          if (summary !== null) answer.retellSteps(summary, steps.earlier.length);
          return summary !== null;
        } catch (error) {
          // «Стоп» во время сжатия обрывает ожидание отменой: ход остановлен, это не сбой.
          if (!input.abortSignal.aborted) {
            logError(`[переполнение] чат=${input.chatId} сжатие упало: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
          }
          return false;
        }
      }
    } catch (error) {
      // История не прочиталась.
      if (!input.abortSignal.aborted) {
        errorKind = classifyProviderError(error, undefined);
        errors = [{ type: "error", errorText: errorKind }];
      }
    }
    // Ход кончился, пока начало продолжения придержано швом: оно не теряется.
    for (const chunk of seam.flush()) emitNow(chunk);
    // История не прочиталась: поток всё равно открывается куском start с id ответа.
    if (!started) emit({ type: "start", messageId, messageMetadata: { modelId, providerId: input.providerId } });
    // В шаге ждёт один виджет: лишние ждущие вызовы закрываются ошибкой — клиент и запись видят одно и то же (FR-003).
    if (input.waitingWidgets && !input.abortSignal.aborted && errors.length === 0) {
      for (const toolCallId of extraWidgetCallIds(await saver.snapshot(), input.waitingWidgets)) {
        emitNow({ type: "tool-output-error", toolCallId, errorText: ONE_QUESTION_AT_A_TIME });
      }
    }
    // Ход кончен инструментом без слов: служебная отметка в записи — на следующих ходах модель видит после результата
    // постоянную пометку ответа. Клиенту не идёт. Ход ждёт человека (смешанный шаг) — не кончен, отметки нет.
    if (endTurns.endedWithoutText() && !input.abortSignal.aborted && errors.length === 0) {
      const parts = await saver.snapshot();
      if (pendingHumanInput(parts, input.waitingWidgets).length === 0) {
        if (parts.at(-1)?.type !== "step-start") saver.observe({ type: "start-step" });
        saver.observe({ type: END_TURN_PART_TYPE, data: true });
      }
    }
    for (const chunk of [...errors, ...terminal]) saver.observe(chunk);
    dataChanges.close();
    appEvents.close();
    appState?.close();
    reservedState?.close();
    const closure = chatClosure.close();
    browser?.close();

    input.flushers?.delete(saver.flush);
    const savedParts = await saver.finish();
    const reasoningDurationsMs = timer.finalize();
    const failed = input.abortSignal.aborted || errors.length > 0;
    // Закрытие побеждает паузу: в закрытом чате ответить на запрос нельзя, поэтому ход не ждёт человека.
    const closing = !failed && pendingHumanInput(savedParts, input.waitingWidgets).length > 0 && (closure !== undefined || (await chatClosedNow()));
    // Остановка, сбой и закрытие чата не дожидаются ответа человека: незакрытые запросы становятся отказами, а вызовы
    // без результата — ошибками с постоянным текстом, чтобы вызов не остался без результата.
    let parts = failed || closing
      ? closeHangingToolCalls(denyPendingApprovals(savedParts, INTERRUPTED_REASON, RESULT_UNKNOWN_REASON), { notStarted: toolQueue.notStarted })
      : savedParts;
    const status: FinalAnswerStatus = input.abortSignal.aborted
      ? "stopped"
      : errors.length > 0
        ? "error"
        : pendingHumanInput(parts, input.waitingWidgets).length > 0
          ? "awaiting_approval"
          : "complete";
    // Инструмент кончил ход с готовым текстом, а ход кончился раньше (в том же шаге ждёт подтверждения другой вызов,
    // «Стоп», сбой): текст человеку не ушёл. Ход после ответа человека новый — просьба туда не переходит.
    if (endTurns.hasText()) logError(`[endTurn] чат=${input.chatId} готовый текст не показан: ход кончился со статусом ${status}`);
    // Законченный ответ — через проверки до записи: исправленный текст пишется, уходит в итог хода и на экран.
    const textIndex = lastTextIndex(parts);
    if (replyChecks && status === "complete" && textIndex !== -1 && !takeover.signal.aborted) {
      const original = (parts[textIndex] as { text: string }).text;
      const text = await checkedReplyText({
        checks: replyChecks.checks,
        text: original,
        ownerId: input.ownerId ?? "",
        chatId: input.chatId,
        messageId,
        seenTexts: seenTexts?.list() ?? [],
        rewrite: createReplyRewrite({ ...input, providerId: answeredProviderId, messageId, logError }),
        logError,
      });
      if (text !== original) {
        const corrected = withTextAt(parts, textIndex, text);
        if (heldText?.holdsText()) for (const chunk of heldText.release(text)) emitShown(chunk);
        else {
          const resets = shownSteps?.resetsToLastText();
          for (const chunk of (resets && replacementChunks(corrected, textIndex, resets, answeredProviderId)) || []) emitToClient(chunk);
        }
        parts = corrected;
      }
    }
    for (const chunk of heldText?.release() ?? []) emitShown(chunk);
    // Расход хода: все попытки, вместе с оценкой шага, оборванного «Стопом» или сбоем.
    turnUsage.closeAttempt();
    // В сообщении расход копится по паузам и продолжениям, а в журнал расходов идёт только этот ход: до паузы он уже записан.
    const usage = messageUsage();
    const error = status === "error" ? { kind: errorKind ?? "other" } : null;
    // Ответил запасной — сообщение помнит его (FR-031); выбор чата не меняется.
    const answeredByBackup = answeredProviderId !== input.providerId && { providerId: answeredProviderId };
    let finished = false;
    if (!takeover.signal.aborted) {
      try {
        finished = await finishWithRetries(
          storage,
          messageId,
          { status, parts, usage, reasoningDurationsMs, error, ...answeredByBackup, ...(input.afterTurn && { afterTurn: "pending" as const }) },
          logError,
        );
      } catch (failure) {
        if (!(failure instanceof MessageAlreadyFinishedError)) throw failure;
        takeover.abort();
      }
    }
    // Дело инструмента сделано при любом итоге: чат закрывается и после «Стопа», сбоя и перехвата хода.
    if (closure) await applyChatClosure(closure);
    if (takeover.signal.aborted) return await finishTakenOverTurn(reasoningDurationsMs);
    if (!finished) {
      // База так и не приняла конечную запись: ответ остаётся идущим, со всеми частями и расходом по шагам, если запись
      // прошла. Ход его бросает — ответ помечен брошенным: восстановление любой копии (`recoverInterruptedAnswers` и
      // проверка брошенных ответов) сразу переведёт его в прерванный и запишет расход в журнал; здесь журнал не пишется,
      // чтобы не задвоить (FR-061).
      await storage.updateStreamingMessage(messageId, { parts, reasoningDurationsMs, usage: streamingUsage(), alive: "released" }).catch(() => {});
      // Хук узнаёт, что ход кончился (служба отпускает его запись продолжения); сжатие и память не нужны.
      if (input.onFinished) runFinishedHook(input, "interrupted", answeredProviderId);
      throw new Error(`Конечная запись ответа ${messageId} не удалась: ответ оставлен для восстановления`);
    }
    input.onAnswerWritten?.();
    // Остановленный или оборванный ход тоже стоил денег: завершённые шаги и оценка оборванного. Каждому провайдеру хода —
    // своя запись по его цене: попытки основного до перехода на запасной — по цене основного.
    if (input.ownerId) {
      for (const group of turnUsage.stepsByProvider()) {
        await recordSpentTokens({
          storage,
          catalog: input.catalog,
          startedAt,
          ownerId: input.ownerId,
          chatId: input.chatId,
          messageId,
          source: input.usageSource ?? "answer",
          modelId,
          providerId: group.providerId,
          spent: sumOfSteps(group.steps) ?? emptyTokenUsage(),
          steps: group.steps,
          logError,
        });
      }
      // Оборванные генерации: настоящий расход — у провайдера, позже и в фоне; ход его не ждёт (FR-058).
      const stepsToSettle = turnUsage.stepsToSettle();
      if (stepsToSettle.length > 0) {
        void settleGenerationUsage({
          storage,
          catalog: input.catalog,
          env: input.env,
          ownerId: input.ownerId,
          chatId: input.chatId,
          messageId,
          modelId,
          startedAt,
          steps: stepsToSettle,
          logError,
          // Сверка в фоне: даже сбой самого журнала сервера не должен ронять процесс необработанным отказом.
        }).catch((failure: unknown) => console.error(`Сверка расхода генерации упала: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`));
      }
    }
    // Хук итога — после записи итога и расхода, до последних кусков: пока он идёт, поток открыт и чат занят. «Стоп»
    // перестаёт его ждать: поток кончается, чат свободен, а хук доделывается в фоне.
    if (input.afterTurn) {
      const events = await input.afterTurn({ status, parts, usage, error, providerId: answeredProviderId }, input.abortSignal);
      for (const event of events) emitToClient({ type: APP_EVENT_PART_TYPE, data: event });
    }
    if (input.onFinished) runFinishedHook(input, status, answeredProviderId);

    emitToClient({
      type: "message-metadata",
      messageMetadata: { status, reasoningDurationsMs, ...answeredByBackup, ...(usage && { usage }), ...(error && { error }) },
    });
    if (status === "error") for (const chunk of errors) emitToClient(chunk);
    if (terminal.length === 0) terminal.push(status === "stopped" ? { type: "abort" } : { type: "finish" });
    for (const chunk of terminal) emitToClient(chunk);

    /**
     * Ответ уже закрыла другая копия сервера: её запись не трогается. Расход в закрытом ответе — её снимок, его она
     * пишет в журнал сама (возможно, ещё не успела), а ход пишет только расход сверх снимка. Человек видит «прерван»,
     * поток кончается без ошибки.
     */
    /** Закрыт ли чат кодом приложения посреди хода; сбой чтения — строка в журнал, ход ждёт как обычно. */
    async function chatClosedNow(): Promise<boolean> {
      if (!input.isChatClosed) return false;
      return input.isChatClosed().catch((failure: unknown) => {
        logError(`Не удалось проверить закрытие чата ${input.chatId} в конце хода: ${failure instanceof Error ? failure.message : String(failure)}`);
        return false;
      });
    }

    /** Закрытие из инструмента: флаг и событие пишет служба, вкладка получает признак в потоке. Сбой ход не роняет. */
    async function applyChatClosure(closure: ChatClosure): Promise<void> {
      await chatClosure.recorded();
      try {
        await input.closeChat!(closure);
      } catch (failure) {
        logError(`Чат ${input.chatId} не закрылся после хода (closeChat): ${failure instanceof Error ? failure.message : String(failure)}`);
        return;
      }
      emitToClient({ type: CHAT_CLOSED_PART_TYPE, data: closure, transient: true });
    }

    async function finishTakenOverTurn(reasoningDurationsMs: Record<string, number>): Promise<void> {
      turnUsage.closeAttempt();
      const usage = messageUsage();
      if (input.ownerId && usage) {
        const taken = await storage.getMessage(messageId).then(
          (closed) => [closed?.usage ?? {}],
          (failure: unknown) => {
            // Неизвестно, что учла другая копия: лучше недосчитать, чем задвоить.
            logError(`Расход перехваченного ответа ${messageId} не записан: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`);
            return null;
          },
        );
        const unjournaled = taken && usageMinusJournaled(usage, taken);
        if (unjournaled) {
          await recordSpentTokens({
            storage,
            catalog: input.catalog,
            startedAt,
            ownerId: input.ownerId,
            chatId: input.chatId,
            messageId,
            source: input.usageSource ?? "answer",
            modelId,
            providerId: answeredProviderId,
            spent: unjournaled,
            logError,
          });
        }
      }
      if (input.onFinished) runFinishedHook(input, "interrupted", answeredProviderId);
      emitToClient({ type: "message-metadata", messageMetadata: { status: "interrupted", reasoningDurationsMs, ...(usage && { usage }) } });
      emitToClient({ type: "finish" });
    }
  } finally {
    // Исключение в любом месте хода не оставляет таймеров записи и знака жизни.
    saver.stop();
    input.flushers?.delete(saver.flush);
  }
}

/** Куски, из которых клиент соберёт скопированные части, и длительности их рассуждений. */
function replayCopiedParts(message: AgentChatMessage, emitToClient: (chunk: UIMessageChunk) => void): void {
  for (const chunk of chunksForParts(message.parts)) emitToClient(chunk);
  const reasoningDurationsMs = message.metadata?.reasoningDurationsMs;
  if (reasoningDurationsMs && Object.keys(reasoningDurationsMs).length > 0) {
    emitToClient({ type: "message-metadata", messageMetadata: { reasoningDurationsMs } });
  }
}

/**
 * Одна попытка продолжить тот же ответ: запрос по истории хода `history`, затем ответ `answer` в том виде, в каком его
 * видит модель (уже сделанные в этом ходе части — модель продолжит с них), затем `tailMessages` (только в запросе,
 * в ответ не пишутся). Куски дописываются в сообщение `originalMessage` с тем же id; повторный `start` ход не отдаёт.
 * Без `answer` — первая попытка нового ответа. Запасной провайдер, продолжение после сжатия и автопродолжение — всё
 * через неё.
 */
async function runAnswerAttempt(
  input: AgentTurnInput,
  attempt: {
    found: ResolvedModel;
    history: readonly AgentChatMessage[];
    answer?: AgentChatMessage;
    originalMessage?: AgentChatMessage;
    tailMessages?: readonly ModelMessage[];
    /** Шаги хода: сделано до этой попытки и предел на весь ход. */
    steps: TurnSteps;
    /** Начало запроса другое, чем у прошлой попытки: история переписана сжатием или пересказом. */
    historyRewritten: boolean;
    /** Застывшие блоки этого ответа. */
    frozenContext: FrozenContextData;
    toolQueue: ToolQueue;
    endTurns: EndTurnRequests;
    browser: ReturnType<typeof createTurnBrowserTools> | undefined;
    dataChanges: ReturnType<typeof createDataChangeNotifier>;
    appEvents: AppEventEmitter;
    chatClosure: ChatClosureRequest;
    appState: AppStateWriter;
    /** Содержательный кусок уже был в этом ходе. */
    contentSeen: boolean;
    emit: (chunk: UIMessageChunk) => void;
    turnUsage: TurnUsage;
    turnBudget: TurnBudget;
    /** Повторять ли молчание до первого куска у того же провайдера. */
    repeatSilence: () => boolean;
    /** Есть — попытка у запасного: после шага, за которым ход пошёл бы дальше, она кончается и зовёт это. */
    backToPrimary?: () => void;
    /** Каждый завершённый шаг попытки: причина конца. */
    onStep: (finishReason: string) => void;
    /** Ждёт, пока начатый вызов инструмента попадёт в хранилище. */
    callSaved: (toolCallId: string) => Promise<void>;
    /** Есть — ход с проверками ответа: сюда идёт всё, что модель видит в запросах. */
    seenTexts?: SeenTexts;
  },
): Promise<TurnAttempt> {
  const { found, answer, originalMessage } = attempt;
  const classify = (error: unknown): ChatErrorKind => classifyProviderError(error, found.provider);
  // Своя отмена попытки (FR-057), связанная со «Стопом» хода: оборванная попытка отменяет запрос и инструменты,
  // которые ещё идут, — их поздние результаты никуда не попадают, следующая попытка их не ждёт.
  const attemptAbort = new AbortController();
  const onTurnAbort = () => attemptAbort.abort(input.abortSignal.reason);
  if (input.abortSignal.aborted) onTurnAbort();
  else input.abortSignal.addEventListener("abort", onTurnAbort, { once: true });
  try {
    const opened = await openAttempt(input, { ...attempt, history: answer ? [...attempt.history, answer] : attempt.history }, attemptAbort.signal);
    const result = await readAnswerAttempt(input, attempt, opened, classify);
    if (result.result.outcome === "failed") attemptAbort.abort(new Error("попытка оборвалась"));
    return result;
  } catch (error) {
    attemptAbort.abort(error);
    throw error;
  } finally {
    input.abortSignal.removeEventListener("abort", onTurnAbort);
  }
}

/** Читает поток попытки до конца: куски — клиенту и в сохранение, начала шагов и написанное — в оценку расхода. */
function readAnswerAttempt(
  input: AgentTurnInput,
  attempt: Parameters<typeof runAnswerAttempt>[1],
  opened: Awaited<ReturnType<typeof openAttempt>>,
  classify: (error: unknown) => ChatErrorKind,
): Promise<TurnAttempt> {
  const { found, originalMessage } = attempt;
  const invalidInputs = createInvalidInputReasons();
  return runTurnAttempt({
    open: (onError) =>
      opened.result
        .toUIMessageStream<AgentChatMessage>({
          generateMessageId: () => input.messageId,
          // Только id сообщения: SDK дописывает куски в ответ с этим id.
          ...(originalMessage && { originalMessages: [originalMessage] }),
          sendReasoning: true,
          messageMetadata: ({ part }): ChatMessageMetadata | undefined =>
            part.type === "start" ? { modelId: input.modelId, providerId: found.provider.id } : undefined,
          onError,
        })
        // Начала шагов и написанное — в оценку шага, который оборвётся.
        .pipeThrough(
          new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
              attempt.turnUsage.observe(chunk);
              controller.enqueue(invalidInputs.carryReason(chunk));
            },
          }),
        ),
    // Ошибка инструмента приложения идёт в строку вызова своим текстом, ошибка провайдера — видом.
    describeError: (error) => opened.toolErrors.describe(error, classify),
    classify,
    abortSignal: input.abortSignal,
    contentSeen: attempt.contentSeen,
    emit: attempt.emit,
  });
}

/**
 * Запрос одной попытки к провайдеру `providerId`: инструменты, запрос и обёртка повторов строятся заново под него —
 * у провайдеров разные модели, ключи и цены.
 */
async function openAttempt(
  input: AgentTurnInput,
  attempt: {
    found: ResolvedModel;
    history: readonly AgentChatMessage[];
    tailMessages?: readonly ModelMessage[];
    steps: TurnSteps;
    historyRewritten: boolean;
    /** Застывшие блоки этого ответа. */
    frozenContext: FrozenContextData;
    toolQueue: ToolQueue;
    endTurns: EndTurnRequests;
    browser: ReturnType<typeof createTurnBrowserTools> | undefined;
    dataChanges: ReturnType<typeof createDataChangeNotifier>;
    appEvents: AppEventEmitter;
    chatClosure: ChatClosureRequest;
    appState: AppStateWriter;
    turnUsage: TurnUsage;
    turnBudget: TurnBudget;
    repeatSilence: () => boolean;
    backToPrimary?: () => void;
    /** Каждый завершённый шаг попытки: причина конца. */
    onStep: (finishReason: string) => void;
    /** Ждёт, пока начатый вызов инструмента попадёт в хранилище. */
    callSaved: (toolCallId: string) => Promise<void>;
    /** Есть — ход с проверками ответа: сюда идёт всё, что модель видит в запросах. */
    seenTexts?: SeenTexts;
  },
  attemptSignal: AbortSignal,
) {
  const logError = input.logError ?? console.error;
  const { found } = attempt;
  const providerId = found.provider.id;
  const limit = input.toolResultLimit ?? DEFAULT_TOOL_RESULT_LIMIT;
  const toolsModel = turnToolsModel(input, found, attempt);
  const appTools = attempt.endTurns.tools(onlyAllowedTools(typeof input.tools === "function" ? input.tools(toolsModel) : input.tools, input.group));
  // Предел ожидания — только серверным инструментам: у браузерных свой срок ответа вкладки.
  const toolTimeout = input.toolTimeout ?? DEFAULT_TOOL_TIMEOUT;
  // Очередь — снаружи предела ожидания: ожидание своей очереди не съедает срок ответа инструмента.
  const serverTools = withSequentialTools(
    withToolTimeout(appTools, {
      timeoutFor: (toolName, declaredMs) => toolTimeout.forTool(toolName, declaredMs),
      onTimeout: (toolName, timeoutMs) => logError(`[инструмент не ответил] чат=${input.chatId} инструмент=${toolName} срок=${timeoutMs}мс`),
    }),
    { isSequential: (toolName) => input.sequentialTools?.isSequential(toolName) ?? false, queue: attempt.toolQueue, ...(appTools && { kindsFrom: appTools }) },
  );
  // Помощники — без предела ожидания и очереди: их собственные инструменты получают их внутри цикла помощника.
  const helpers = input.helpers && helperTools(onlyAllowedHelpers(input.helpers, input.group), limit, ({ name, helper, task, abortSignal }) =>
    helperPartOutputs(task, helperSteps({ name, helper, task, model: toolsModel, context: helperRunContext(input, attempt.toolQueue, logError), abortSignal })),
  );
  const ownTools = helpers ? withHelperTools(serverTools, helpers, input.chatId, logError) : serverTools;
  // Шаг без инструментов (последний шаг хода, итог по потолку): вызов вопреки запрету не выполняется.
  let toolsClosed = false;
  const tools = gateToolCalls(attempt.browser ? withBrowserTools(ownTools, attempt.browser.tools, logError) : ownTools, {
    closed: () => toolsClosed,
    callSaved: attempt.callSaved,
    kindsFrom: { ...appTools, ...helpers },
  });
  const toolErrors = trackToolErrors(tools, {
    limit,
    secrets: environmentSecrets(input.env, input.catalog),
    onCut: (toolName, length) =>
      logError(`[результат обрезан] чат=${input.chatId} инструмент=${toolName} знаков=${length} предел=${limit.forTool(toolName)}`),
  });
  // Снаружи обрезки: наблюдатель видит то, что увидит модель. Браузерные инструменты — нет: их вход и ответ в частях сообщения.
  const observedTools = input.turnObserver
    ? withToolObserver(toolErrors.tools, {
        observer: input.turnObserver,
        chatId: input.chatId,
        ownerId: input.ownerId ?? "",
        messageId: input.messageId,
        skip: new Set(Object.keys(attempt.browser?.tools ?? {})),
        logError,
      })
    : toolErrors.tools;
  const approval = prepareToolApproval(observedTools, input.alwaysAllowedTools ?? new Set());
  const {
    tools: _toolsSource,
    helpers: _helpers,
    assertWithinLimit: _assertWithinLimit,
    history: _history,
    memory: _memory,
    resume: _resume,
    toolTimeout: _toolTimeout,
    sequentialTools: _sequentialTools,
    now: _now,
    usageSource: _usageSource,
    replyChecks: _replyChecks,
    waitingWidgets: _waitingWidgets,
    newAttemptAllowed: _newAttemptAllowed,
    correctionsWaiting,
    cacheMissWatch,
    turnObserver,
    stepContext,
    stepContextTimeoutMs,
    contextBlocks: _contextBlocks,
    contextBlocksTimeoutMs: _contextBlocksTimeoutMs,
    ...requestInput
  } = input;
  const request = await buildModelRequest({
    ...requestInput,
    providerId,
    history: attempt.history,
    frozenContext: { current: { answerId: input.messageId, data: attempt.frozenContext }, group: Boolean(input.group) },
    ...(attempt.tailMessages && { tailMessages: attempt.tailMessages }),
    logError,
    repeatSilence: attempt.repeatSilence,
    ...(turnObserver && { observe: { observer: turnObserver, ownerId: input.ownerId ?? "", messageId: input.messageId, purpose: "answer" as const } }),
    ...(tools && { tools: approval.tools }),
    // Каждый запрос, на который провайдер начал отвечать, — в расход хода с номером генерации (FR-051, FR-058).
    requestWatch: {
      opened: (request) => attempt.turnUsage.requestOpened(request),
      refused: () => attempt.turnUsage.requestRefused(),
    },
  });
  attempt.turnUsage.beginAttempt(request, providerId);
  attempt.seenTexts?.instructions(request.instructions);
  const cacheWatch = cacheMissWatch?.forRequest({
    chatId: input.chatId,
    modelId: found.profile.id,
    providerId,
    historyIds: attempt.history.map((message) => message.id),
    answerId: input.messageId,
    historyRewritten: attempt.historyRewritten,
    ...(attempt.tailMessages?.length && { tailNoteInside: true }),
    price: found.profile.pricing?.[providerId],
  });
  // Снимок шага: перед служебной пометкой попытки (она есть только в начале попытки), иначе последним.
  const snapshots =
    stepContext && createStepSnapshots({ stepContext, logError, chatId: input.chatId, ...(stepContextTimeoutMs !== undefined && { timeoutMs: stepContextTimeoutMs }) });
  // Метка конца шага — только у провайдера с явными метками (FR-012); у автоматического кэша сообщения не трогаются.
  const stepMarks = createStepCacheMarks(found.provider.requestOptions({ chatId: input.chatId, profile: found.profile }).lastMessageProviderOptions);
  let stepTailTokens = 0;
  let wrappedUp = false;
  // Идёт последний шаг хода без запроса (`endTurn`).
  let endTurnStep = false;
  // Человек дописал поправку: шаг кончился — ответ тоже, служба продолжит ход новым ответом на поправку.
  const stopConditions: StopCondition<ToolSet>[] = [stepCountIs(attempt.steps.max - attempt.steps.done), helperAwaitsApproval, () => wrappedUp, () => correctionsWaiting?.() === true];
  // Попытка запасного (`scope: "step"`): шаг кончился, ход пошёл бы дальше — попытка кончается, следующий шаг у основного.
  const backToPrimary: StopCondition<ToolSet> = async (options) => {
    if (!attempt.backToPrimary) return false;
    const stops = await Promise.all(stopConditions.map((condition) => condition(options)));
    if (stops.some(Boolean)) return false;
    attempt.backToPrimary();
    return true;
  };
  const { noteAfterApprovals, ...modelRequest } = request;
  const result = streamText({
    ...modelRequest,
    ...(approval.toolApproval && { toolApproval: gateToolApproval(approval.toolApproval, () => toolsClosed) }),
    // Попытке — остаток шагов хода.
    // Помощник встал на подтверждении человека — ход ждёт, модель основного агента его незаконченным не видит.
    // Итоговый шаг по потолку хода — последний в попытке, даже если модель вызвала инструмент вопреки запрету.
    // Инструмент кончил ход: без текста — стоп сразу; с текстом — ещё шаг подставной модели, его держит только помощник
    // на подтверждении (ход ждёт человека). Потолок шагов и прочие стопы готовый текст не теряют.
    stopWhen: async (options) => {
      if (attempt.endTurns.requested()) {
        if (attempt.endTurns.hasText()) return helperAwaitsApproval(options);
        attempt.endTurns.stopWithoutText();
        return true;
      }
      for (const condition of [...stopConditions, backToPrimary]) if (await condition(options)) return true;
      return false;
    },
    // Последний шаг хода — без вызовов, с пометкой «подведи итог» в самом конце запроса (FR-048). Счёт — по шагам
    // всего хода: повтор после сбоя не делает свой последний шаг последним шагом хода. Ход дошёл до потолка денег или
    // вызовов — так же, со своей пометкой.
    prepareStep: async ({ stepNumber, messages: stepMessages }) => {
      // Ход кончен инструментом (после шага или одобренный до первого шага продолжения): запроса к провайдеру нет.
      if (attempt.endTurns.requested()) {
        endTurnStep = true;
        return { model: endTurnModel(attempt.endTurns.take()) };
      }
      const turnStep = attempt.steps.done + stepNumber;
      // Заметка продолжения после подтверждения — за результатами одобренных вызовов (AI SDK выполнил их до шага 0).
      const withNote = stepNumber === 0 && noteAfterApprovals ? [...stepMessages, ...noteAfterApprovals] : stepMessages;
      const saved = stepMarks.messagesFor({ messages: withNote, stepNumber });
      const snapshot = snapshots
        ? await snapshots.messagesFor({
            messages: saved,
            trailing: stepNumber === 0 ? (attempt.tailMessages?.length ?? 0) : 0,
            context: {
              state: publicAppState(attempt.appState.values()),
              stepNumber: attempt.steps.beforeResume + turnStep,
              chatId: input.chatId,
              ownerId: input.ownerId ?? "",
              messageId: input.messageId,
              // Кто, где и о чём — как у инструментов, но копиями: правка функции не доходит до хода.
              chat: structuredClone(toolsModel.chat ?? {}),
              ...(toolsModel.subject && { subject: structuredClone(toolsModel.subject) }),
              channel: toolsModel.channel ?? "web",
              audience: toolsModel.audience ?? "private",
              ...(toolsModel.staff && { staff: structuredClone(toolsModel.staff) }),
              modelId: found.profile.id,
              providerId,
              abortSignal: attemptSignal,
            },
          })
        : undefined;
      const messages = snapshot?.messages ?? saved;
      attempt.turnUsage.beforeStep(stepNumber, messages);
      wrappedUp ||= attempt.turnBudget.reached();
      const settings = wrappedUp ? turnBudgetSettings(messages) : lastStepSettings({ turnStep, maxSteps: attempt.steps.max, messages });
      toolsClosed = settings !== undefined;
      // Концовка шага не сохраняется: снимок, пометка попытки (только на шаге 0), пометка «подведи итог».
      const notes = [...(stepNumber === 0 ? (attempt.tailMessages ?? []) : []), ...(settings?.messages.slice(messages.length) ?? [])];
      stepTailTokens = (snapshot?.tokens ?? 0) + estimateMessagesTokens(notes);
      attempt.seenTexts?.messages(settings?.messages ?? messages);
      return settings ?? (messages === stepMessages ? undefined : { messages });
    },
    // Временные сбои повторяет обёртка модели из `buildModelRequest`, там же сроки молчания модели.
    maxRetries: 0,
    abortSignal: attemptSignal,
    // Кривые аргументы чинятся по схеме без обращения к модели; каждая починка — строкой в журнал.
    repairToolCall: createRepairToolCall({
      onRepaired: (repair) => logError(describeToolInputRepair(repair, { chatId: input.chatId, modelId: found.profile.id, providerId })),
    }),
    // Размер контекста после ответа — по последнему шагу: у прежних шагов тот же префикс, сумма считала бы его много раз.
    onStepFinish: (step) => {
      if (endTurnStep) {
        // Шаг без запроса: ни расхода, ни оценки, ни счёта кэша.
        endTurnStep = false;
        attempt.turnUsage.finishFreeStep();
        attempt.onStep(step.finishReason);
        return;
      }
      attempt.turnUsage.finishStep(step.usage, step.content);
      attempt.turnBudget.countToolCalls(step.toolCalls.length);
      attempt.onStep(step.finishReason);
      cacheWatch?.onStep({
        inputTokens: step.usage.inputTokens ?? 0,
        cachedInputTokens: step.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWriteTokens: step.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        ...(stepTailTokens > 0 && { tailTokens: stepTailTokens }),
      });
    },
    onError: () => {
      // Ошибка приходит куском `error` в UI-поток; сырой текст провайдера наружу не идёт.
    },
  });
  return { result, toolErrors };
}

/**
 * Негодный вход вызова: SDK шлёт `tool-input-error` с причиной, а следом `tool-output-error`, где причина уже строкой
 * и `describe` её не узнаёт («other»). Закрывающий кусок получает причину из первого: модель на следующих ходах и
 * человек видят, что не так со входом.
 */
function createInvalidInputReasons() {
  const reasons = new Map<string, string>();
  return {
    carryReason(chunk: UIMessageChunk): UIMessageChunk {
      if (chunk.type === "tool-input-error") reasons.set(chunk.toolCallId, chunk.errorText);
      if (chunk.type !== "tool-output-error") return chunk;
      const reason = reasons.get(chunk.toolCallId);
      reasons.delete(chunk.toolCallId);
      return reason === undefined ? chunk : { ...chunk, errorText: reason };
    },
  };
}

/**
 * Каждый вызов инструмента с `execute` — событием наблюдателю на конец: вход, результат (уже обрезанный), ошибка
 * (в том числе таймаут), длительность. Результат отдаётся того же вида; бросок наблюдателя уходит в журнал.
 */
export function withToolObserver(
  tools: ToolSet,
  context: { observer: TurnObserver; chatId: string; ownerId: string; messageId: string; skip: ReadonlySet<string>; logError: (message: string) => void },
): ToolSet {
  const observed: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = original.execute;
    observed[name] =
      execute && !context.skip.has(name)
        ? {
            ...original,
            execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
              const startedAt = Date.now();
              const report = (output: unknown, error: unknown) => {
                try {
                  context.observer.toolCall({
                    chatId: context.chatId,
                    ownerId: context.ownerId,
                    messageId: context.messageId,
                    toolCallId: options.toolCallId,
                    toolName: name,
                    input,
                    output,
                    error: error === undefined ? null : error instanceof Error ? error.message : String(error),
                    startedAt: new Date(startedAt),
                    durationMs: Date.now() - startedAt,
                  });
                } catch (failure) {
                  context.logError(
                    `Наблюдатель хода не принял вызов инструмента ${name} в чате ${context.chatId}: ${failure instanceof Error ? failure.message : String(failure)}`,
                  );
                }
              };
              const failed = (error: unknown): never => {
                report(null, error ?? new Error("неизвестная ошибка"));
                throw error;
              };
              let result: unknown;
              try {
                result = execute(input, options);
              } catch (error) {
                return failed(error);
              }
              if (isAsyncIterable(result)) return reportLastValue(result, (output) => report(output, undefined), failed);
              if (isPromiseLike(result)) {
                return Promise.resolve(result).then((output) => {
                  report(output, undefined);
                  return output;
                }, failed);
              }
              report(result, undefined);
              return result;
            },
          }
        : original;
  }
  return observed;
}

/** Промежуточные результаты идут дальше как есть; наблюдатель видит последний. */
async function* reportLastValue(
  results: AsyncIterable<unknown>,
  done: (output: unknown) => void,
  failed: (error: unknown) => never,
): AsyncGenerator<unknown> {
  let last: unknown;
  try {
    for await (const value of results) {
      last = value;
      yield value;
    }
  } catch (error) {
    failed(error);
  }
  done(last);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | null)?.[Symbol.asyncIterator] === "function";
}

/**
 * Досчёт помощников после ответа человека: каждый продолжает со своих сохранённых шагов и ответа, его часть получает
 * промежуточные результаты и итог. «Стоп» обрывает досчёт без ошибки — ход остановлен.
 */
async function continueHelpers(
  input: AgentTurnInput,
  continued: readonly HelperToContinue[],
  turn: {
    toolQueue: ToolQueue;
    dataChanges: ReturnType<typeof createDataChangeNotifier>;
    appEvents: AppEventEmitter;
    chatClosure: ChatClosureRequest;
    appState: AppStateWriter;
    emit: (chunk: UIMessageChunk) => void;
    logError: (message: string) => void;
  },
): Promise<void> {
  const found = findModel(input.catalog, input.modelId, input.providerId);
  const toolsModel = turnToolsModel(input, found, turn);
  for (const { toolCallId, name, task, messages } of continued) {
    const helper = input.helpers?.[name];
    if (!helper) {
      const output: HelperPartOutput = { task, steps: [], text: "", status: "failed", error: `помощник «${name}» больше не задан` };
      turn.emit({ type: "tool-output-available", toolCallId, output });
      continue;
    }
    const reports = helperSteps({
      name,
      helper,
      task,
      model: toolsModel,
      context: helperRunContext(input, turn.toolQueue, turn.logError),
      priorMessages: messages,
      abortSignal: input.abortSignal,
    });
    // Каждый результат, кроме последнего, — промежуточный: последний становится итогом части.
    let last: HelperPartOutput | undefined;
    try {
      for await (const output of helperPartOutputs(null, reports)) {
        if (last) turn.emit({ type: "tool-output-available", toolCallId, output: last, preliminary: true });
        last = output;
      }
    } catch (error) {
      if (input.abortSignal.aborted) return;
      throw error;
    }
    if (last) turn.emit({ type: "tool-output-available", toolCallId, output: last });
  }
}

/** Последний шаг кончился помощником, который ждёт подтверждения человека. */
const helperAwaitsApproval: StopCondition<ToolSet> = ({ steps }) =>
  steps.at(-1)?.toolResults.some(
    (result) => isHelperToolName(result.toolName) && (result.output as Partial<HelperProgress> | undefined)?.status === "awaiting_approval",
  ) ?? false;

/** Всё, что цикл помощника в ходе берёт у хода: расход — на ответ основного агента, очередь инструментов — общая. */
function helperRunContext(input: AgentTurnInput, toolQueue: ToolQueue, logError: (message: string) => void): HelperRunContext {
  return {
    storage: input.storage,
    catalog: input.catalog,
    env: input.env,
    chatId: input.chatId,
    ownerId: input.ownerId ?? "",
    messageId: input.messageId,
    usageSource: "helper",
    toolQueue,
    logError,
    ...(input.toolResultLimit && { toolResultLimit: input.toolResultLimit }),
    ...(input.toolTimeout && { toolTimeout: input.toolTimeout }),
    ...(input.sequentialTools && { sequentialTools: input.sequentialTools }),
    ...(input.providerFallback !== undefined && { providerFallback: input.providerFallback }),
    ...(input.modelSilence && { modelSilence: input.modelSilence }),
    ...(input.turnObserver && { turnObserver: input.turnObserver }),
    ...(input.assertWithinLimit && { assertWithinLimit: input.assertWithinLimit }),
  };
}

/**
 * Результаты части `helper_<имя>` по шагам цикла помощника: сначала «работает» без шагов, затем вид после каждого шага.
 * Помощник встал на подтверждении — в результате и его сообщения: по ним ход досчитает его после ответа человека.
 */
async function* helperPartOutputs(task: string | null, reports: AsyncIterable<HelperStepReport>): AsyncGenerator<HelperPartOutput> {
  if (task !== null) yield { task, steps: [], text: "", status: "running" };
  for await (const { messages, progress } of reports) {
    yield progress.status === "awaiting_approval" ? { ...progress, resume: { messages } } : progress;
  }
}

/** Помощники рядом с инструментами приложения; `helper_<имя>` у инструмента приложения (функцией) — ошибка хода. */
function withHelperTools(appTools: ToolSet | undefined, helpers: ToolSet, chatId: string, logError: (message: string) => void): ToolSet {
  const clash = Object.keys(helpers).find((name) => appTools && Object.hasOwn(appTools, name));
  if (clash) {
    const message = `Инструмент ${clash} задан и помощником, и инструментом приложения (чат ${chatId}): переименуйте один из них`;
    logError(message);
    throw new Error(message);
  }
  return { ...appTools, ...helpers };
}

/** Браузерные инструменты рядом с инструментами приложения; повтор имени — ошибка (тихо подменить инструмент нельзя). */
function withBrowserTools(appTools: ToolSet | undefined, browserTools: ToolSet, logError: (message: string) => void): ToolSet {
  const clash = Object.keys(browserTools).find((name) => appTools && Object.hasOwn(appTools, name));
  if (clash) {
    const message = `Инструмент «${clash}» задан и приложением, и браузерными инструментами: переименуйте один из них`;
    logError(message);
    throw new Error(message);
  }
  return { ...appTools, ...browserTools };
}

/** Модель инструментов хода: одна на все шаги. */
function turnToolsModel(
  input: AgentTurnInput,
  found: { profile: ModelProfile; provider: { id: string } },
  turn: { dataChanges: ReturnType<typeof createDataChangeNotifier>; appEvents: AppEventEmitter; chatClosure: ChatClosureRequest; appState: AppStateAccess },
): AgentToolsModel {
  return {
    profile: found.profile,
    providerId: found.provider.id,
    chatId: input.chatId,
    ownerId: input.ownerId ?? "",
    place: input.place ?? null,
    turnId: input.messageId,
    notifyDataChanged: turn.dataChanges.notify,
    emitAppEvent: turn.appEvents.emit,
    channel: input.channel ?? "web",
    audience: input.group ? "group" : "private",
    messageId: input.messageId,
    ...(input.subject && { subject: input.subject }),
    chat: { ...(input.chatData && { data: input.chatData }) },
    ...(input.staff && { staff: input.staff }),
    ...(input.closeChat && { closeChat: turn.chatClosure.request }),
    // Инструменту — только чтение и запись: конец записи и служебные ключи — дело ядра.
    state: { get: turn.appState.get, set: turn.appState.set, unset: turn.appState.unset },
  };
}

/** В группе — только разрешённые инструменты приложения; вне группы — все. */
function onlyAllowedTools(tools: ToolSet | undefined, group: GroupTurn | undefined): ToolSet | undefined {
  if (!group || !tools) return tools;
  const allowed = new Set(group.allowedTools);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => allowed.has(name)));
}

/** В группе — только помощники, чей `helper_<имя>` разрешён. */
function onlyAllowedHelpers(helpers: Record<string, AgentHelper>, group: GroupTurn | undefined): Record<string, AgentHelper> {
  if (!group) return helpers;
  const allowed = new Set(group.allowedTools);
  return Object.fromEntries(Object.entries(helpers).filter(([name]) => allowed.has(`helper_${name}`)));
}

function runFinishedHook(input: AgentTurnInput, status: FinalAnswerStatus, answeredProviderId: string): void {
  const reportFailure = (failure: unknown) =>
    (input.logError ?? console.error)(`Хук окончания хода упал: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`);
  try {
    void Promise.resolve(input.onFinished!({ status, messageId: input.messageId, answeredProviderId })).catch(reportFailure);
  } catch (failure) {
    reportFailure(failure);
  }
}

/**
 * Текущий ответ для запросов хода. История хода (до ответа) и ответ живут отдельно: после сжатия меняется история,
 * после пересказа первых шагов модель видит только последние шаги, а записывается и уходит клиенту ответ целиком.
 */
function createAnswerForRequest(input: {
  messageId: string;
  history: readonly AgentChatMessage[];
  /** Ответ в истории хода (продолжение): так его видит модель. */
  inHistory?: AgentChatMessage;
  /** Ответ, в который дописываются куски (продолжение). */
  original?: AgentChatMessage;
}) {
  let history = input.history;
  let answer = input.inHistory;
  let original = input.original;
  let retoldParts = 0;
  // Номера частей, которые модель не видит: недописанное при обрыве. Части только дописываются, номера не сдвигаются.
  const leftOut = new Set<number>();
  // Ответ оборвался посреди: следующие запросы хода несут пометку автопродолжения.
  let continuing = false;
  // Пересказанные шаги уходят, застывшие блоки среди них остаются: заметка продолжения не теряется вместе с шагами.
  const forModel = (parts: AgentChatMessage["parts"]) =>
    parts.filter((part, index) => (index >= retoldParts || part.type === FROZEN_CONTEXT_PART_TYPE) && !leftOut.has(index));
  /** Попытка оборвалась: следующая продолжает с частей `parts`. Новый ответ без частей так и идёт без ответа. */
  function update(parts: AgentChatMessage["parts"], metadata: ChatMessageMetadata): void {
    if (!original && parts.length === 0) return;
    // Шаг стёрт: номера за концом ответа больше ни на что не указывают.
    for (const index of leftOut) if (index >= parts.length) leftOut.delete(index);
    original = { ...(original ?? { id: input.messageId, role: "assistant", metadata }), parts };
    answer = { ...original, parts: forModel(parts) };
  }
  return {
    /** Вход попытки: история, ответ для модели, сам ответ и пометка после ответа (только в запросе). */
    request(): {
      history: readonly AgentChatMessage[];
      answer?: AgentChatMessage;
      originalMessage?: AgentChatMessage;
      tailMessages?: readonly ModelMessage[];
    } {
      // Модели нечего продолжать (были только начала шагов и недописанное) — запрос как новый: без ответа и без пометки.
      const forRequest = answer && hasAnswerContent(answer.parts) ? answer : undefined;
      const tailMessages = forRequest && continuing ? [autoContinueNoteMessage(forRequest.parts)] : undefined;
      return { history, ...(forRequest && { answer: forRequest }), ...(original && { originalMessage: original }), ...(tailMessages && { tailMessages }) };
    },
    update,
    /**
     * Ответ оборвался посреди: недописанное рассуждение и аргументы модель больше не видит (`partsLeftOutOfAutoContinue`),
     * написанный текст видит. Пометка автопродолжения идёт последним сообщением всех следующих запросов хода; хвост в ней —
     * по ответу этого запроса, байты предсказуемы.
     */
    continueAfterBreak(parts: AgentChatMessage["parts"], metadata: ChatMessageMetadata): void {
      for (const index of partsLeftOutOfAutoContinue(parts)) leftOut.add(index);
      continuing = true;
      update(parts, metadata);
    },
    /** История чата сжата: дальше ход идёт по ней. */
    replaceHistory(compacted: readonly AgentChatMessage[]): void {
      history = compacted;
    },
    /**
     * Первые `count` частей ответа пересказаны: пересказ — частью в конце вопроса человека, ответ для модели — без них.
     * Пересказ один на ход: все следующие запросы хода получают те же байты.
     */
    retellSteps(summary: string, count: number): void {
      retoldParts = count;
      history = withLastUserPart(history, { type: "text", text: answerStepsFrame(summary) });
      if (original) answer = { ...original, parts: forModel(original.parts) };
    },
  };
}

/** Сколько знаков текста ответ уже написал: для строки журнала автопродолжения. */
function writtenChars(parts: AgentChatMessage["parts"]): number {
  return parts.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
}

/** Часть в конец последнего сообщения человека. */
function withLastUserPart(history: readonly AgentChatMessage[], part: AgentChatMessage["parts"][number]): AgentChatMessage[] {
  const index = history.findLastIndex((message) => message.role === "user");
  return history.map((message, position) => (position === index ? { ...message, parts: [...message.parts, part] } : message));
}

/** Паузы перед повторами конечной записи ответа, мс: база на миг недоступна — не теряем ход (FR-061). */
export const FINISH_RETRY_PAUSES_MS: readonly number[] = [1_000, 3_000];

/**
 * Конечная запись ответа с повторами после `FINISH_RETRY_PAUSES_MS`. `false` — база так и не приняла запись. Ответ уже
 * законченный (его закрыло восстановление) — ошибка сразу, без повторов. Но оборванная попытка могла пройти, а
 * потеряться — только ответ базы: тогда в базе лежит ровно наш итог, и это успех. Не вышло прочитать — проверка
 * повторяется по тем же паузам; все попытки оборвались — итог проверяется ещё раз в конце.
 */
async function finishWithRetries(
  storage: ChatStorage,
  messageId: string,
  final: FinishedMessagePatch,
  logError: (message: string) => void,
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    let failure: unknown;
    try {
      await storage.finishMessage(messageId, final);
      return true;
    } catch (caught) {
      failure = caught;
    }
    if (failure instanceof MessageAlreadyFinishedError) {
      if (attempt === 0) throw failure;
      const finished = failure;
      const ours = await isOurFinal(storage, messageId, final).catch((readFailure: unknown) => {
        failure = readFailure;
        return undefined;
      });
      if (ours === true) return true;
      if (ours === false) throw finished;
    }
    const pause = FINISH_RETRY_PAUSES_MS[attempt];
    logError(
      `Конечная запись ответа ${messageId} не удалась (попытка ${attempt + 1}): ${failure instanceof Error ? failure.message : "неизвестная ошибка"}${pause === undefined ? "" : `; повтор через ${pause} мс`}`,
    );
    if (pause === undefined) return isOurFinal(storage, messageId, final).catch(() => false);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

/** В базе — наш итог: тот же статус и те же части. */
async function isOurFinal(storage: ChatStorage, messageId: string, final: FinishedMessagePatch): Promise<boolean> {
  const stored = await storage.getMessage(messageId);
  return stored !== null && stored.status === final.status && (final.parts === undefined || sameJson(stored.parts, final.parts));
}

/** Равенство значений после записи в базу: порядок ключей и ключи со значением `undefined` не важны. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  }
  const defined = (value: object) => Object.entries(value).filter(([, item]) => item !== undefined);
  const leftEntries = defined(left);
  const rightValues = new Map(defined(right));
  return leftEntries.length === rightValues.size && leftEntries.every(([key, item]) => rightValues.has(key) && sameJson(item, rightValues.get(key)));
}

/** Расход продолжения прибавляется к расходу до паузы; размер контекста — по последнему шагу, то есть новый. */
function addUsage(previous: TokenUsage | null, next: TokenUsage): TokenUsage {
  if (!previous) return next;
  const cacheWriteTokens = (previous.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0);
  return {
    inputTokens: previous.inputTokens + next.inputTokens,
    cachedInputTokens: previous.cachedInputTokens + next.cachedInputTokens,
    outputTokens: previous.outputTokens + next.outputTokens,
    reasoningTokens: previous.reasoningTokens + next.reasoningTokens,
    ...(cacheWriteTokens > 0 && { cacheWriteTokens }),
    ...((next.contextTokens ?? previous.contextTokens) !== undefined && {
      contextTokens: next.contextTokens ?? previous.contextTokens!,
    }),
    ...((previous.estimated || next.estimated) && { estimated: true }),
  };
}

/** Готовый ответ куском шага: те же куски, что у текста модели. */
function emitReply(text: string, emit: (chunk: UIMessageChunk) => void): void {
  const id = "reply";
  emit({ type: "start-step" });
  emit({ type: "text-start", id });
  emit({ type: "text-delta", id, delta: text });
  emit({ type: "text-end", id });
  emit({ type: "finish-step" });
}
