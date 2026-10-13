import type { ToolSet, UIMessageChunk } from "ai";
import { AttachmentRejectedError } from "./attachments/message-attachments";
import type { IncomingFilePart, MessageAttachments, StoredFilePart } from "./attachments/message-attachments";
import { isVoiceMessage, soundsOfMessage, voiceModePart } from "./agent-run/mode-notes";
import { uniqueVoiceSounds, voiceSoundsNote } from "./agent-run/voice-sounds";
import type { VoiceSound } from "./agent-run/voice-sounds";
import type { ModeNotes } from "./agent-run/mode-notes";
import { DEFAULT_TEXT_MODE_NOTE, DEFAULT_VOICE_MODE_HINT, sameVoiceTagSet, voiceChangeNote, voiceModeHint as voiceModeHintFor } from "./agent-run/voice-mode-texts";
import type { VoiceTagSet } from "./agent-run/voice-mode-texts";

import { resolvePlaceMaxLength, resolveTurnPlace } from "./agent-run/screen-place";
import { resolveTimeZone, sameTimeZone } from "./agent-run/today";
import { continuationRequestContext } from "./page-context/page-context";
import type { ScreenPlace, TurnRequestContext } from "./page-context/page-context";
import { checkBrowserToolDescriptions, createPendingBrowserCalls, resolveBrowserToolTimeoutMs } from "./agent-run/browser-tools";
import type { BrowserCallAnswer } from "./agent-run/browser-tools";
import { runAgentTurn } from "./agent-run/run-agent-turn";
import type { AgentToolsModel, AgentToolsSource } from "./agent-run/run-agent-turn";
import { DEFAULT_STEP_CONTEXT_TIMEOUT_MS } from "./agent-run/step-context";
import type { StepContext } from "./agent-run/step-context";
import { DEFAULT_CONTEXT_BLOCKS_TIMEOUT_MS } from "./frozen-context/app-blocks";
import type { ContextBlocksSource } from "./frozen-context/context-blocks";
import { channelPart, isHumanMessage, turnChannelOf } from "./agent-run/channel-notes";
import { createChatEvents } from "./chat-events/chat-events";
import { chatHasExternalContent } from "./external-content/external-content";
import type { ChatEvent, ChatEvents, ChatTurnTrigger } from "./chat-events/chat-events";
import type { BackgroundPort, BackgroundTasks } from "./background/background-tasks";
import { helperToolsModel, runHelper } from "./helpers/run-helper";
import type { DeliverNoticesInput, DeliverNoticesResult } from "./notices/agent-notice";
import { deliveryKeyOf, MAX_SERVER_TURNS_IN_ROW, noticeMessageParts, serverTurnsInRow } from "./notices/deliver-notices";
import type { TurnObserver } from "./agent-run/turn-observer";
import { checkProviderFallback } from "./agent-run/next-attempt";
import type { ProviderFallbackSetting } from "./agent-run/next-attempt";
import { resolveToolResultLimit } from "./agent-run/tool-result-limit";
import { createToolQueue, resolveSequentialTools } from "./agent-run/sequential-tools";
import type { SequentialToolsSetting, ToolQueue } from "./agent-run/sequential-tools";
import { resolveToolTimeout } from "./agent-run/tool-timeout";
import type { ToolTimeoutSetting } from "./agent-run/tool-timeout";
import { resolveTurnLimits } from "./agent-run/turn-limits";
import type { MaxOutputTokensSetting, TurnTimeoutSetting } from "./agent-run/turn-limits";
import { resolveModelSilence, resolveTimeoutMs } from "./provider-errors/model-silence";
import type { ModelSilenceSetting } from "./provider-errors/model-silence";
import { createTurnSlots, resolveMaxConcurrentTurns, TooManyTurnsError } from "./running-answers/turn-slots";
import type { TurnSlot } from "./running-answers/turn-slots";
import type { ResolvedToolResultLimit, ToolResultLimitSetting } from "./agent-run/tool-result-limit";
import { checkHelpers, helperToolDescriptions } from "./helpers/helper-tools";
import type { AgentHelper } from "./helpers/helper-types";
import type { LongTermMemory } from "./memory/long-term-memory";
import { createMemoryAfterAnswer } from "./memory/memory-after-answer";
import { createCompactionService } from "./compaction/compaction-service";
import type { CompactionMarker, CompactionOutcome } from "./compaction/compaction-service";
import { resolveCompactionSettings } from "./compaction/compaction-settings";
import type { CompactionSettings } from "./compaction/compaction-settings";
import { deriveChatTitle, normalizeChatTitle } from "./conversation/chat-title";
import { createSubjectChats, withoutSubjectData } from "./subject-chats/subject-chats";
import type { ChatGreeting, ImportChatInput, OpenSubjectChatInput, OpenSubjectChatResult } from "./subject-chats/subject-chats";
import { branchForks, currentChildOf, nextSiblingTime, selectCurrentBranch } from "./conversation/branches";
import { withoutGlueFragments } from "./conversation/glue-fragments";
import { closeHangingToolCalls, partsForContinuation } from "./conversation/hanging-tool-calls";
import { loadCurrentBranchLinks } from "./conversation/load-current-branch";
import { appStatePart, foldAppState, publicAppState } from "./app-state/app-state";
import type { AppStateRecord, AppStateValues } from "./app-state/app-state";
import { branchStateOf, readBranchState } from "./app-state/branch-state";
import type { BranchState } from "./app-state/branch-state";
import { createStateChanged } from "./app-state/state-changed";
import type { StateChangeReason, StateChangedHandler } from "./app-state/state-changed";
import { CLOSED_STATE_KEY, closureOfState, hiddenStateKeyOf, isStateMessage, publicMessages, stateMessage } from "./app-state/state-messages";
import type { BranchFork } from "./conversation/branches";
import { toAgentChatMessage } from "./conversation/to-agent-chat-message";
import { newStoredMessage, subjectOfChat } from "./conversation/types";
import type { AnswerEdit } from "./conversation/answer-edit";
import { AnswerEditError, editAnswerParts } from "./conversation/edit-answer-parts";
import { sumOfSteps } from "./agent-run/turn-usage";
import type { AgentChannel, AgentChatMessage, AnswerStatus, Chat, ExternalChannel, GroupTurn, PendingStepUsage, StoredMessage, TokenUsage, UsageSum } from "./conversation/types";
import { cachePriceWarnings, findModel, modelAcceptsImages } from "./models/model-catalog";
import type { ModelCatalog } from "./models/model-catalog";
import {
  InvalidModelChoiceError,
  buildModelMenu,
  effectiveChoiceOfChat,
  resolveDefaultChoice,
  validateModelChoice,
  isHiddenChoice,
} from "./models/model-choice";
import type { ModelChoice, ModelMenu } from "./models/model-choice";
import { createCacheMissWatch } from "./usage/cache-miss-watch";
import { recordSpentTokens, usageMinusJournaled } from "./usage/record-usage";
import { ChatBusyError, createRunningAnswerRegistry } from "./running-answers/running-answer-registry";
import { createTurnSteering, isCorrection, steerPart } from "./steering/turn-steering";
import type { SteeringTurn } from "./steering/turn-steering";
import type { RunningAnswerRegistry } from "./running-answers/running-answer-registry";
import { createLiveTurns, STOPPED_TURNS_WAIT_MS, turnStopReasonOf } from "./running-answers/live-turns";
import { SpendingLimitReachedError } from "./spending/spending-limits";
import { createTurnGate } from "./turn-hooks/turn-gate";
import type { TurnGateInput } from "./turn-hooks/turn-gate";
import type { SpendingLimits, SpendingStatus } from "./spending/spending-limits";
import { CHAT_DATA_MAX_BYTES, assertChatData, assertChatDataFilter, assertChatDataPatch, chatDataOfInput } from "./storage/chat-data";
import type { ChatDataFilter } from "./storage/chat-data";
import { MessageAlreadyFinishedError, MessageNotAwaitingError } from "./storage/chat-storage";
import type { AwaitingMessagePatch, ChatStorage, ChatSubjectFilter } from "./storage/chat-storage";
import { createAfterTurn } from "./turn-hooks/after-turn";
import { validateAppEvent } from "./turn-hooks/turn-hooks";
import { APP_EVENT_PART_TYPE, markedAsCopiedAppEvents } from "./turn-hooks/app-events";
import { ActionForbiddenError, resolveChatCapabilities } from "./access/chat-capabilities";
import { clientVisibilityOf } from "./access/client-visibility";
import type { ClientVisibility } from "./access/client-visibility";
import type { ChatCapabilities, ChatCapabilitiesHandler, ChatCapability } from "./access/chat-capabilities";
import { ChatClosedError, normalizeChatClosure } from "./access/chat-closure";
import type { ChatClosure } from "./access/chat-closure";
import { ChatCreationRefusedError } from "./access/chat-creation";
import type { BeforeCreateChatHandler } from "./access/chat-creation";
import { abandonedAnswersOf, abandonedOnRetry, isRetryableAnswer } from "./conversation/abandoned-answers";
import type { AbandonedAnswers, AfterTurnHandler, AppEvent, BeforeTurnHandler, StaffActor, TurnAction, TurnNotStartedHandler, TurnNotStartedReason } from "./turn-hooks/turn-hooks";
import { ANSWER_STALE_AFTER_MS, STALE_ANSWERS_SWEEP_EVERY_MS } from "./agent-run/answer-liveness";
import {
  ALWAYS_IN_CHAT,
  DENIED_BY_USER_REASON,
  IGNORED_REASON,
  INTERRUPTED_REASON,
  RESULT_UNKNOWN_REASON,
  alwaysAllowedTools,
  denyPendingApprovals,
  offersAlways,
  pendingHumanInput,
  pendingPartOf,
  recordDecision,
} from "./tool-approval/approval-parts";
import type { ApprovalDecision } from "./tool-approval/approval-parts";
import { closeWidgetsByMessage, pendingWidgetCall, recordWidgetAnswer } from "./widgets/pending-widgets";
import { WidgetAnswerCheckAbortedError, WidgetAnswerCheckTimeoutError, WidgetAnswerRefusedError, checkWidgetAnswerByApp } from "./widgets/widget-answer-check";
import type { CheckedWidgetAnswer } from "./widgets/widget-answer-check";
import { createAgentWidgets, withWidgetTools } from "./widgets/widget-tools";
import { logValue } from "./text/log-value";
import type { AgentWidgets } from "./widgets/widget-tools";
import type { AgentWidgetSettings } from "./widgets/widget-types";
import { assembleInstructions, createInstructionsAssembler } from "./instructions/assemble-instructions";
import type { InstructionBlocks } from "./instructions/assemble-instructions";
import { notifyTurnFinished } from "./agent-run/turn-finished";
import type { TurnFinishedHandler } from "./agent-run/turn-finished";

export { DEFAULT_TEXT_MODE_NOTE, DEFAULT_VOICE_MODE_HINT };

/**
 * Голоса приложения для пометок модели (FR-024): чей голос сейчас у человека и какие теги этому голосу идут.
 * Каталог голосов голосового режима (`createVoiceCatalog` в `@ykurilov/agent-chat-voice-dialog/server`) подходит как есть.
 */
export interface VoiceTagSource {
  /** Голос человека для следующей реплики. */
  current(userId: string): Promise<string>;
  /** Набор тегов голоса; `undefined` — у голоса набора нет, ему идёт общий список. */
  tagsOf(voiceId: string): VoiceTagSet | undefined;
}

const MAX_MESSAGE_LENGTH = 100_000;
const MAX_MESSAGE_ID_LENGTH = 200;
/** Сколько раз перечитать ждущий ответ, если другая копия сервера записала в него между чтением и записью. */
const WAITING_WRITE_ATTEMPTS = 3;
/** Сколько раз поправка ждёт занятый чат (запуск, передачу хода) и пробует снова, прежде чем отказать «занято». */
const STEER_ATTEMPTS = 5;

/** Право, без которого действие хода запрещено; у остальных действий своего права нет. */
const TURN_ACTION_CAPABILITY: Partial<Record<TurnAction, ChatCapability>> = { edit: "edit", retry: "retry", regenerate: "regenerate" };
/** Ходы, которых нет в закрытом чате. Правка и «Переделать» уводят на другую ветку — закрытие там своё. */
const OPEN_CHAT_ACTIONS: ReadonlySet<TurnAction> = new Set<TurnAction>(["send", "retry", "approval", "widget", "notice"]);
/** Почему сменилось состояние после хода. */
const STATE_CHANGE_REASON: Partial<Record<TurnAction, StateChangeReason>> = { edit: "editMessage", regenerate: "regenerate", retry: "retry" };

export { InvalidModelChoiceError };
export { AttachmentRejectedError, SpendingLimitReachedError, TooManyTurnsError };
export type { CompactionMarker, CompactionOutcome, CompactionSettings, ModelChoice, ModelMenu, SpendingLimits, SpendingStatus };

export interface AgentSettings {
  /** Постоянная инструкция, без времени и прочего меняющегося (FR-023). */
  instructions: string;
  /** Схемы блоком ```mermaid: `true` — к инструкции дописывается строка `diagramsInstructions`. Рисует их экран. */
  diagrams?: boolean;
  /**
   * Живые демонстрации блоком ```html-demo (docs/live-demos.md): `true` — к инструкции дописывается абзац
   * `liveDemosInstructions`. Запускает их экран (`<AgentChat liveDemos />`).
   */
  liveDemos?: boolean;
  /** Набор инструментов или функция от выбранной модели (например, скриншот только моделям, которые видят картинки). */
  tools?: AgentToolsSource;
  /**
   * Помощники: каждый — инструмент `helper_<имя>` с входом `{ task }`. Помощник идёт своим циклом на своей модели, со
   * своей инструкцией и инструментами, без истории чата; модель агента видит только его итог. Нет — запрос как прежде.
   */
  helpers?: Record<string, AgentHelper>;
  maxSteps?: number;
  /**
   * Пометка модели при входе в голосовой режим: добавляется один раз, отдельной текстовой частью в конец первого
   * голосового сообщения подряд. В историю чата не пишется: выводится из отметок сообщений, начало запроса от хода
   * к ходу не меняется, кэш модели цел. По умолчанию — «отвечай коротко и разговорно» и список тегов голоса. Свой текст
   * заменяет пометку целиком, и тогда пометок о теги и смене голоса нет: список тегов в нём приложение пишет само.
   */
  voiceModeHint?: string;
  /**
   * Голоса приложения. Задано — сообщение из голосового режима запоминает голос человека, пометка входа несёт теги этого
   * голоса, а если голос сменился посреди разговора, первое сообщение с новым голосом получает пометку с его тегами (один
   * раз). Не задано — у всех голосов общий список тегов.
   */
  voices?: VoiceTagSource;
  /**
   * Пометка модели при возврате к тексту: у первого текстового сообщения после голосовых. Пишется так же, как
   * `voiceModeHint`. По умолчанию — «разговор снова идёт текстом, ответ не озвучивается».
   */
  textModeNote?: string;
  /**
   * Предел описания места на экране, знаков. По умолчанию 1000, не меньше 100. Длиннее — описание обрезается с «…»,
   * в журнал сервера идёт строка без текста.
   */
  placeMaxLength?: number;
  /**
   * Браузерные инструменты: описания `tool({ description, inputSchema, needsApproval? })` без `execute`, общий модуль
   * сервера и страницы. Модель видит их наравне с серверными; вызов исполняет вкладка, с которой пришёл запрос хода
   * (функции — `browserTools` у панели), сервер ждёт её ответа. Ожидающие вызовы — в памяти процесса: один сервер.
   */
  browserTools?: ToolSet;
  /** Срок ответа вкладки на браузерный инструмент, мс. По умолчанию 30 000, от 1000 до 2³¹−1. */
  browserToolTimeoutMs?: number;
  /**
   * Виджеты: кнопки выбора, оценка, короткая форма, подсказки и свои виджеты приложения (`defineWidget`). Вызов ждущего
   * виджета ставит ход на паузу, как запрос подтверждения (`awaiting_approval`): ответ — `answerWidget`, сообщение
   * человека закрывает виджет пометкой `{"ответ":"сообщением"}`. Имена не совпадают с `tools`, памятью и `browserTools`,
   * иначе исключение при создании службы. Не задано — виджетов нет, запрос модели как раньше.
   */
  widgets?: AgentWidgetSettings;
  /**
   * Предел результата инструмента, знаков (строка как есть, остальное — JSON). Длиннее — начало и пометка
   * «[Результат обрезан: показано N из M знаков]», в журнал сервера строка без содержимого.
   * По умолчанию 50 000, не меньше 1000. Браузерные инструменты дополнительно режутся до 16 КБ, как раньше.
   */
  toolResultMaxLength?: ToolResultLimitSetting;
  /**
   * Запасные провайдеры той же модели: при перегрузке или лимите после тихих повторов, если ход ещё не получил
   * ни одного куска ответа, ход один раз идёт к следующему провайдеру с ключом на сервере.
   * Не задано — включено, порядок из `providerModelIds` модели (маршруты OpenRouter тоже в нём). `false` — выключено.
   * `byModel[modelId]` — свой порядок (провайдеры этой модели) или `false` для модели.
   * `onSilence: "restart-step-on-next"` — молчание модели и посреди ответа: шаг стирается и начинается заново у
   * следующего провайдера; `scope` и `maxSwitches` — см. `ProviderFallbackSetting`.
   */
  providerFallback?: ProviderFallbackSetting;
  /**
   * Срок ответа серверного инструмента (с `execute`: приложения, памяти, веб-инструментов), мс. Не ответил — инструмент
   * получает отмену через `abortSignal`, вызов закрывается ошибкой «Инструмент не ответил за N с…», модель видит её и
   * продолжает ход; в журнал сервера — строка `[инструмент не ответил]`. По умолчанию 120 000; 0 или `Infinity` — без
   * предела; иначе от 1000 до 2³¹−1. Свой срок инструмента — `{ default?, byTool? }`, как у `toolResultMaxLength`:
   * например, `{ byTool: { ask_user: 0 } }` — инструмент, чей `execute` сам ждёт ответа человека, не отменяется.
   * Инструменты с `needsApproval` ждут «Разрешить» без срока: он идёт с вызова `execute`. Браузерные инструменты живут
   * по `browserToolTimeoutMs`.
   */
  toolTimeoutMs?: ToolTimeoutSetting;
  /**
   * Серверные инструменты с последствиями («спиши деньги», «забронируй слот»), которые не должны идти одновременно:
   * `true` — все, список — только названные. Такой вызов ждёт всех начатых раньше вызовов хода, а начатые после ждут
   * его; обычные вызовы друг друга не ждут. Ожидание очереди не съедает срок `toolTimeoutMs`. Промежуточный вывод
   * держит очередь до последнего значения: такие инструменты объявляйте `async function*`. Браузерные инструменты
   * идут как раньше. Не задано — все вместе.
   */
  sequentialTools?: SequentialToolsSetting;
  /**
   * Запасной часовой пояс для сегодняшней даты в запросе (IANA, например `Europe/Moscow`), когда пояс браузера человека
   * не пришёл или не настоящий. Не задано — пояс лимитов расходов (`createSpendingLimits({ timeZone })`), без него —
   * пояс сервера. Не IANA-пояс или другой пояс, чем у лимитов, — ошибка при создании службы.
   */
  timeZone?: string;
  /**
   * Сроки молчания потока модели, мс: `firstChunkMs` — до первого куска ответа (по умолчанию 90 000; сработал — тихий
   * повтор, затем запасной провайдер), `betweenChunksMs` — между кусками (по умолчанию 120 000; сработал —
   * автопродолжение). Время, пока работает серверный инструмент, не считается. 0 или `Infinity` у срока — без него,
   * `false` — без обоих; иначе от 1000 до 2³¹−1. В журнал сервера — строка `[молчание модели]`. Запрос к модели не меняют.
   */
  modelSilenceTimeout?: ModelSilenceSetting;
  /**
   * Общий срок хода от запуска до записи итога, мс: вышел — ход останавливается, как по «Стопу» (написанное записывается,
   * `status: "stopped"`), а `afterTurn` видит `stopReason: "timeout"`. `afterTurn` записанного ответа срок не обрывает.
   * Время, пока ход ждёт решения человека, не считается: такой ход уже закончен. `{ default?, byModel? }` — свой срок модели. 0 или `Infinity` — без срока; иначе от
   * 1000 до 2³¹−1. Модель из `byModel`, которой нет в каталоге, — ошибка при создании службы. Не задано — без срока.
   */
  turnTimeoutMs?: TurnTimeoutSetting;
  /**
   * Предел токенов ответа в каждом запросе к модели (шаге хода), уходит провайдеру как `maxOutputTokens`. Ответ упёрся —
   * шаг оборван (`finishReason: "length"`), в ответе пометка обрыва, а `afterTurn` видит `lengthCut: true`.
   * `{ default?, byModel? }` — свой предел модели. Целое от 1; модель из `byModel`, которой нет в каталоге, — ошибка при
   * создании службы. Не задано — в запросе его нет, запрос как раньше. Сжатие истории живёт по своим пределам.
   */
  maxOutputTokens?: MaxOutputTokensSetting;
  /**
   * Журнал промахов кэша: когда начало запроса то же, что в прошлом ходе, а провайдер почти ничего не взял из кэша
   * (например, в инструкцию вписано текущее время), в журнал сервера идёт одна строка `[промах кэша]` с числом токенов
   * и примерной переплатой в долларах. Текстов сообщений в ней нет. Не задано — включено; `false` — выключено.
   */
  cacheMissLog?: false;
  /**
   * Снимок перед каждым шагом модели: текст ложится сообщением человека в самый конец запроса шага, после результатов
   * инструментов, и в историю не пишется. Видит живое состояние ветки (`state`, записи прошлых шагов уже в нём), данные
   * и объект чата, номер шага. Всё до снимка от шага к шагу не меняется (кэш модели). `null` или пустая строка — шаг без
   * снимка; бросок — шаг без снимка и строка в журнал. Не задано — запрос побайтно прежний.
   */
  stepContext?: StepContext;
  /**
   * Срок ответа `stepContext`, мс. Не ответила — шаг без снимка, функция получает отмену через `abortSignal`, в журнал
   * сервера — строка `[снимок шага] … не ответил`. «Стоп» отменяет её сразу. По умолчанию 5000; 0 или `Infinity` — без
   * срока; иначе от 1000 до 2³¹−1.
   */
  stepContextTimeoutMs?: number;
  /**
   * Блоки приложения для вопроса хода (список скиллов, роль, правила): зовётся один раз в начале хода, блоки
   * вписываются в вопрос после памяти и даты и дальше не меняются ни на байт (кэш модели). На следующих ходах в вопрос
   * идут только изменённые блоки целиком и одна строка про убранные. Текст ядро не меняет и не оборачивает. Ключи
   * `memory`, `memory:*`, `today` и `screen_place` заняты ядром: такой блок отбрасывается со строкой в журнал.
   * `private: true` — блок не показывается в групповом ходе. Не задано — запрос побайтно прежний.
   */
  contextBlocks?: ContextBlocksSource;
  /**
   * Срок ответа `contextBlocks`, мс. Не ответила или бросила — блоки приложения берутся из прошлого ответа чата, в
   * журнал сервера — строка `[блоки контекста] …`; функция получает отмену через `abortSignal`. «Стоп» отменяет её
   * сразу. По умолчанию 5000; 0 или `Infinity` — без срока; иначе от 1000 до 2³¹−1.
   */
  contextBlocksTimeoutMs?: number;
}

/** Как отправлено сообщение. */
export interface SendMessageOptions {
  /** С чем пришёл запрос: место на экране (идёт модели хвостом сообщения и инструментам; в историю не пишется) и вкладка. */
  page?: TurnRequestContext;
  /**
   * Сообщение из голосового режима: оно запоминается голосовым (отметка в сообщении), от этого зависят пометки режима для модели.
   * У правки (`editMessage`) — склейка голосовой фразы: см. там.
   */
  voiceMode?: boolean;
  /**
   * Звуки человека в этой фразе (смех, вздох; FR-027), только вместе с `voiceMode`. Попадают в отметку сообщения, модель узнаёт
   * о них по пометке в конце сообщения (текст пометки в историю не пишется), на экране их нет. У правки (склейки) новые звуки
   * дописываются к звукам заменяемого сообщения.
   */
  voiceSounds?: readonly VoiceSound[];
  /** Откуда сообщение: веб или мессенджер. По умолчанию `"web"`. Не веб — без браузерных инструментов, с заметкой о канале. */
  channel?: AgentChannel;
  /**
   * Групповой ход: без снимка памяти, инструментов памяти и поиска по истории; из инструментов приложения — только
   * `allowedTools`; имя автора — в хвосте сообщения человека. Список инструментов стабилен для чата группы.
   */
  group?: GroupTurn;
}

export interface ChatServiceOptions {
  storage: ChatStorage;
  catalog: ModelCatalog;
  /** Реестр идущих ответов; по умолчанию свой на службу. */
  registry?: RunningAnswerRegistry;
  /**
   * Выбор для новых чатов. Не задан или не подходит (тогда запись в журнал) — первая модель каталога
   * у первого провайдера, у которого есть ключ.
   */
  defaultChoice?: ModelChoice;
  agent: AgentSettings;
  /**
   * Автосжатие истории. Включено по умолчанию (порог 200 тыс. токенов, хвост 20 тыс., потолок сводки 20 тыс.);
   * `false` выключает. Уже сделанные записи применяются к истории в любом случае.
   */
  compaction?: CompactionSettings | false;
  /** Вложения к сообщениям (пакет `@ykurilov/agent-chat-attachments`). Не заданы — сообщения только текстовые. */
  attachments?: MessageAttachments;
  /**
   * Долгая память между чатами (пакет `@ykurilov/agent-chat-memory`). Ядро дописывает инструкцию памяти (один раз) и
   * её инструменты, а блок записей кладёт в вопрос хода один раз на чат — в первом ходе и после сжатия истории. В идущем
   * чате память не перечитывается: новые записи доходят, когда память читается заново. Не задана — всё как прежде.
   */
  memory?: LongTermMemory;
  /**
   * Лимиты расходов (пакет `@ykurilov/agent-chat-limits`). Проверяются до начала хода, до любой записи. Не заданы —
   * ходы не ограничены; расход токенов в журнал пишется в любом случае.
   */
  limits?: SpendingLimits;
  /**
   * Проверка приложения перед ходом: вернуть `{ code, message }` — ход не начнётся, ничего не запишется, человек
   * получит `TurnRefusedError` (сервер отвечает 403 `turn_refused`). Зовётся в `sendMessage`, `editMessage`, `retry`,
   * `regenerate`, `answerApproval`, `answerWidget` и `deliverNotices`. Порядок: свой чат → проверка сообщения →
   * `beforeTurn` → занятость чата и лимиты → запись. Поэтому у занятого чата отказ приложения придёт раньше
   * «занято»: человек получит 403, а не 409. Ещё проверку можно позвать напрямую: `assertTurnAllowed`. Код — `[a-z0-9_.-]`, 1–64 знака (иначе ошибка приложения: ход не начат, `TypeError`, строка в
   * `logError`); текст — до 300 знаков, длиннее обрезается. Исключение из хука идёт наружу как есть, ход не начат.
   * `deliverNotices` отказ не показывает человеку: сообщение записывается без хода. Не задана — ходы не проверяются.
   * `send` и `edit` получают `messageId` — id сообщения человека. Ход, пропущенный хуком, но не начатый, закрывается
   * хуком `turnNotStarted`.
   */
  beforeTurn?: BeforeTurnHandler;
  /**
   * Ход не начался, хотя `beforeTurn` его пропустил: занят чат (`busy`), предел ходов (`too_many_turns`), лимит расходов
   * (`spending_limit`), повтор id сообщения (`duplicate_message`), неверный запрос (`invalid`), чат закрыли, пока ход
   * запускался (`chat_closed`), хода и не будет
   * (`no_turn`: `assertTurnAllowed`, ответ ждёт ещё решений, служебное сообщение без хода) или сбой (`error`). Так
   * приложение снимает резерв, взятый в `beforeTurn`: каждый пропуск закрывается ровно одним — `afterTurn` начатого
   * хода или этим хуком. Ошибка хода наружу прежняя (409, 429…); бросок хука — строка в `logError`. Не задан — как раньше.
   */
  turnNotStarted?: TurnNotStartedHandler;
  /**
   * Права человека в чате: частичный список `{ право: boolean }`, пропущенное — `true`; нет функции — всё разрешено.
   * Запрещённое действие — `ActionForbiddenError` до любой записи (сервер отвечает 403 `action_forbidden`), экран
   * прячет его кнопки (`capabilities` в истории). Порядок: свой чат → проверка сообщения → права → закрытие чата →
   * `beforeTurn` → занятость и лимиты. Не булево значение или исключение — ошибка приложения, строка в `logError`.
   */
  chatCapabilities?: ChatCapabilitiesHandler;
  /**
   * Можно ли человеку завести новый чат (`createChat`: `POST {base}`, `/new` в мессенджере): вернуть `{ code, message }` —
   * чат не создаётся, `ChatCreationRefusedError` (сервер отвечает 403 `chat_creation_refused`, мессенджер — текстом).
   * Правила кода и текста — как у `beforeTurn`; неверный отказ — `TypeError` и строка в `logError`. Чаты объектов
   * (`openSubjectChat`, `importChat`) хук не спрашивает. Не задан — чаты заводятся без проверки.
   */
  beforeCreateChat?: BeforeCreateChatHandler;
  /**
   * Сколько ответов одного человека могут идти одновременно во всех его чатах. Сверх этого ход не начинается
   * (`TooManyTurnsError`), ничего не записано. Считается в памяти процесса. По умолчанию 3; `Infinity` — без предела.
   */
  maxConcurrentTurnsPerUser?: number;
  env?: Record<string, string | undefined>;
  /** Журнал сервера. По умолчанию `console.error`. */
  logError?: (message: string) => void;
  /**
   * Наблюдатель хода (песочница): каждое обращение к модели (ответ, сжатие, память, повторы) и каждый вызов серверного
   * инструмента — событием. Вызывается синхронно и не ждётся; бросок уходит в `logError`. Нет — запрос побайтно прежний.
   */
  turnObserver?: TurnObserver;
  /**
   * Своя инструкция чата (песочница): берётся перед каждым ходом и сжатием, служебные блоки ядра дописываются к ней.
   * `null` — инструкция приложения. Нет — инструкция собирается один раз, запрос побайтно прежний.
   */
  chatInstructions?: (chat: Chat) => Promise<string | null>;
  /**
   * Сотрудник хода по чату (песочница: копия чата человека у админа). Берётся перед каждым ходом; есть — инструменты
   * получают `model.staff`, хук итога — `staff` и `actorId` сотрудника. `null` или нет — ход делает сам владелец,
   * запрос побайтно прежний. При `model.staff` любая запись в данные `ownerId` запрещена: следить за этим — обязанность
   * инструментов приложения, ядро их записи не перехватывает.
   */
  staffOfChat?: (chat: Chat) => StaffActor | null | undefined;
  /**
   * Инструменты, чей результат правка ответа (`editAnswer`) не меняет: их результат — файлы (картинки, видео).
   * Имена знает приложение (песочница); результаты виджетов не правятся и без этого списка.
   */
  lockedToolOutputs?: readonly string[];
  /** События чата вне потока ответа. Нет — служба создаёт свои (`createChatServer` создаёт сам). */
  chatEvents?: ChatEvents;
  /** Фоновые задачи (пакет `@ykurilov/agent-chat-background`). Нет — запрос к модели побайтно прежний. */
  background?: BackgroundTasks;
  /**
   * Ход закончен (любой итог: законченный, остановленный, с ошибкой, прерванный, ждущий человека): итог уже записан.
   * Ход обработчик не ждёт; бросок или отказ уходит в `logError`. Нет — ничего не зовётся.
   */
  onTurnFinished?: TurnFinishedHandler;
  /**
   * Итог хода для приложения (зачёт урока, выдача награды). Зовётся после записи итога и расхода, до `finish` клиенту;
   * пока хук идёт, чат занят. Возвращённые `events` ложатся в конец ответа частями `data-app-event` и идут в поток.
   * Сбой — повторы с паузой 1 с, затем 3 с; после всех попыток или по сроку — `logError`, событие `after-turn-failed`,
   * ответ цел. Состояние хука хранится в ответе: `recoverInterruptedAnswers` и регулярная проверка брошенных ответов
   * доделывают ждущие хуки, чей срок с запасом вышел (`recovered: true`; свежий может вести другая копия), и зовут хук
   * для ответов, прерванных восстановлением. Ключ повтора — `messageId` + `status`, см.
   * `AfterTurnHandler`. «Стоп» во время хука его больше не ждёт: поток кончается, чат свободен, а хук доделывается в
   * фоне, и его события открытая вкладка получает через канал наблюдения. Нужно хранилище с `setAfterTurnState` и
   * `listPendingAfterTurn`, иначе ошибка при создании службы.
   * Нет — состояние хука не пишется, запрос и поток прежние.
   */
  afterTurn?: AfterTurnHandler;
  /** Срок хука итога на все попытки и паузы, мс. По умолчанию 30 000. */
  afterTurnTimeoutMs?: number;
  /** Попыток хука итога. По умолчанию 3. */
  afterTurnAttempts?: number;
  /**
   * Состояние чата сменилось: после хода, правки, «Переделать», «Повторить», выбора ветки, правки ответа и записи
   * `checkAnswer` виджета (`widgetAnswer`). Получает
   * состояние до и после без служебных ключей; не изменилось — не зовётся. Ход его не ждёт; сбой — повторы в своём
   * сроке, затем строка в журнал и событие `state-changed-failed`. Нет — только событие `state-changed`.
   */
  onStateChanged?: StateChangedHandler;
  /** Срок хука смены состояния на все попытки и паузы, мс. По умолчанию 30 000. */
  onStateChangedTimeoutMs?: number;
  /** Попыток хука смены состояния. По умолчанию 3. */
  onStateChangedAttempts?: number;
  /**
   * Человек выбрал модель или уровень рассуждений (`setModel` без `{ by: "app" }`, адрес `PUT {chat}/model`): после
   * записи выбора. Подстановка выбора при открытии пустого чата и `setModel` сервера приложения его не зовут. Сбой —
   * строка в журнал, выбор остаётся.
   */
  onModelChosen?: ModelChosenHandler;
  /**
   * Видит ли человек меню моделей (`getModelMenu(userId)`, адрес `GET …/models`). Меню не знает чата, поэтому право
   * `modelDetails` его не закрывает: публичному чату верните `false` для посетителей. Нет — меню видно всем.
   */
  modelMenu?: (input: { userId: string }) => boolean | Promise<boolean>;
  /**
   * Закрытые верхние ключи состояния чата (`model.state`): служебные номера брони, ревизии и т. п. В браузер не
   * уходят — ни в истории, ни в потоке хода, ни в `state-changed` наблюдения (`useChatState` их не видит). Сервер видит
   * их как обычно: модель, `getChatState`, `onStateChanged`, `subscribeEvents`. Имя — без точки и не на `$`.
   * Нет — закрыты только служебные ключи SDK (`$…`).
   * @throws TypeError (при создании службы) неверное имя.
   */
  privateStateKeys?: readonly string[];
}

/** Хук `onModelChosen`: чей и какой выбор сохранён. */
export type ModelChosenHandler = (input: { userId: string; chatId: string; choice: ModelChoice }) => void | Promise<void>;

/**
 * Кто действует. По умолчанию человек (адреса HTTP): проверяются права экрана (`chatCapabilities`). `"app"` — сервер
 * приложения: права экрана не проверяются, владение чатом — как всегда.
 */
export interface ActionOptions {
  by?: "person" | "app";
}

/** Опции `recoverInterruptedAnswers`. */
export interface RecoverInterruptedAnswersOptions {
  /**
   * Сервер — единственная копия на этой базе: при старте все идущие ответы, кроме ответов этой службы, прерываются
   * сразу, а не через 15–20 с (`ANSWER_STALE_AFTER_MS` плюс до одного `STALE_ANSWERS_SWEEP_EVERY_MS`). Только при старте
   * процесса, до приёма запросов: вызов позже прервёт ход, который как раз запускается. Нельзя, если на одной базе
   * несколько копий сервера или несколько экземпляров службы в одном процессе (dev-режим Next.js при горячей
   * перезагрузке создаёт службу заново): прервутся живые ответы соседей.
   */
  soleServer?: boolean;
}

/** Новая реплика собеседника в формате, который шлёт клиент. */
export interface IncomingUserMessage {
  id: string;
  role: string;
  parts: ReadonlyArray<{ type: string; text?: unknown; url?: unknown; mediaType?: unknown; filename?: unknown }>;
}

export interface ChatHistory {
  chat: Chat;
  messages: AgentChatMessage[];
  running: boolean;
  /**
   * Последний ответ ещё идёт, но его потока на этой копии сервера нет: его вела упавшая или другая копия (FR-060).
   * Клиент перечитывает историю, пока ответ не закончится или его не прервёт проверка брошенных ответов.
   */
  detachedAnswer: boolean;
  /** Записи сжатия на текущей ветке: на их границах экран рисует разделители. */
  compactions: CompactionMarker[];
  /** Сжатие сейчас идёт. */
  compacting: boolean;
  /** Развилки текущей ветки: у сообщения с соседями экран рисует переключатель «‹ 2/3 ›». */
  forks: BranchFork[];
  /** Права человека в этом чате (`chatCapabilities`): все, без функции — все `true`. */
  capabilities: ChatCapabilities;
  /**
   * Видит ли модель чата картинки: экрану оно нужно для вложений, а меню моделей без выбора модели он не запрашивает.
   * Модели нет в каталоге — поля нет. При скрытой модели (`modelDetails: false`) у `chat` нет `ownerId`, `modelId`,
   * `providerId`, `reasoning`, а у сообщений — `metadata.modelId`, `providerId`, `usage` и метаданных поставщика.
   */
  modelAcceptsImages?: boolean;
  /**
   * Поправки человека после идущего ответа (`steer`), ещё не взятые агентом, по порядку. В `messages` их нет: экран
   * рисует их после ответа с пометкой. Нет поправок — поля нет.
   */
  pendingMessages?: AgentChatMessage[];
  /**
   * В чат попал чужой текст: файл человека, вызов инструмента с пометкой `metadata: { externalContent: true }` (веб,
   * письма), итог помощника или фоновой задачи с ней. Экран не запускает в таком чате живые демонстрации. Смотрятся все
   * сообщения чата, не только текущая ветка; признак не пропадает. Нет чужого текста — поля нет.
   */
  externalContent?: true;
}

/** Итог поправки: `queued` — ждёт границы шага идущего хода; `started` — хода не было, начат обычный ход. */
export interface SteerResult {
  status: "queued" | "started";
  messageId: string;
}

/** Развилки текущей ветки без сообщений: лёгкий ответ, когда сообщения уже на экране. */
export type ChatBranchForks = Pick<ChatHistory, "forks">;

/** Записи сжатия без сообщений: лёгкий ответ для опроса, пока сжатие идёт. */
export type ChatCompactions = Pick<ChatHistory, "compactions" | "compacting">;

/** Состояние чата на текущей ветке (`getChatState`). */
export interface ChatState {
  /** Свёртка записей `model.state` по ветке, без служебных ключей SDK. */
  values: AppStateValues;
  /** Последнее сообщение ветки, на котором снято состояние; пустой чат — `null`. */
  atMessageId: string | null;
}

/** Строка списка чатов: только то, что нужно для списка. */
export interface ChatListItem {
  id: string;
  /** `null` — у чата ещё нет названия. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
  /** Из какого мессенджера создан чат; нет — из веба. */
  origin?: ExternalChannel;
  /** Ключ объекта (`openSubjectChat`); есть только в списке с `subjects` и только у чатов объектов. */
  subjectKey?: string;
  /**
   * Чат закрыт (`closeChat`): переписка видна, писать нельзя. Нет — открыт. В истории — закрытие текущей ветки; в списке
   * и `chatCapabilities` — его копия, которая догоняет смену ветки.
   */
  closed?: ChatClosure;
}

/** Чата нет или он чужой — снаружи это неотличимо. */
export class ChatNotFoundError extends Error {
  constructor(chatId: string) {
    super(`Чат ${chatId} не найден`);
    this.name = "ChatNotFoundError";
  }
}

export class InvalidMessageError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidMessageError";
  }
}

/** Повторять нечего: последний ответ законченный и непустой или вопроса нет. */
export class NothingToRetryError extends Error {
  constructor(chatId: string) {
    super(`В чате ${chatId} нечего повторять`);
    this.name = "NothingToRetryError";
  }
}

/** Нет ожидающего запроса с таким id: решён, закрыт новым сообщением или его не было. */
export class ApprovalNotPendingError extends Error {
  constructor(approvalId: string) {
    super(`Запрос подтверждения ${approvalId} не ждёт ответа`);
    this.name = "ApprovalNotPendingError";
  }
}

/** Виджет не ждёт ответа: вызова нет, он отвечен, закрыт сообщением, не в последнем ответе ветки или убран из настроек. */
export class WidgetNotPendingError extends Error {
  constructor(toolCallId: string) {
    super(`Виджет ${toolCallId} не ждёт ответа`);
    this.name = "WidgetNotPendingError";
  }
}

/** Ответ на виджет не прошёл схему или длиннее 16 КБ в JSON. Содержимого ответа в сообщении нет. */
export class InvalidWidgetAnswerError extends Error {
  constructor(toolCallId: string) {
    super(`Ответ на виджет ${toolCallId} не подходит`);
    this.name = "InvalidWidgetAnswerError";
  }
}

/** Регулярная проверка брошенных ответов: таймер следующей, идущая итерация и остановка. */
/** Один запрос к службе: права спрашиваются у приложения один раз. */
interface RequestScope {
  capabilities?: Promise<ChatCapabilities>;
}

interface StaleSweep {
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
  stopped: boolean;
}

/** Ход начался, но кончился до подписки на поток: его закроет `afterTurn`, а не `turnNotStarted`. */
class TurnEndedBeforeSubscribeError extends Error {
  constructor(chatId: string) {
    super(`Ход в чате ${chatId} закончился до подписки`);
    this.name = "TurnEndedBeforeSubscribeError";
  }
}

/** Ответ человека на запрос подтверждения. */
export type ApprovalAnswer = "allow" | "deny" | "always";

/** Ответ человека на ждущий виджет. */
export interface WidgetAnswerRequest {
  chatId: string;
  /** Человек, который отвечает: чат должен быть его. */
  ownerId: string;
  toolCallId: string;
  /** Ответ: у базовых — `{ "выбрано": … }`, `{ "оценка": n }`, `{ "поля": {…} }`; у своего — по `answerSchema`. */
  answer: unknown;
  /** С чем пришёл запрос: место на экране и вкладка, как у `answerApproval`. */
  page?: TurnRequestContext;
}

export interface ChatService {
  /**
   * `origin` — мессенджер, из которого создан чат. `greeting.text` — первое сообщение от агента: пишется сразу, без модели,
   * хода и расхода, с датой чата. `greeting.instruction` — указание агенту: после создания он один раз просыпается
   * (`conversation_started`) и пишет первым; сбой побудки — в `logError`, чат всё равно отдаётся.
   * `data` — данные чата (`Chat.data`): JSON-объект до 16 КБ, видят `beforeTurn`, `chatInstructions`, инструменты
   * (`model.chat.data`) и `afterTurn` (`turn.chatData`); в браузер и модели не уходят.
   * @throws TypeError в приветствии не ровно одно из text/instruction или оно пустое либо длиннее 10 000 знаков, `data` не
   * JSON-объект или больше 16 КБ: чат не создан.
   */
  createChat(userId: string, options?: { origin?: ExternalChannel; greeting?: ChatGreeting; data?: Record<string, unknown> }): Promise<Chat>;
  /**
   * Чат объекта приложения (урок, заказ): у владельца один чат на ключ. Нет — создаётся (с данными, названием и
   * приветствием), есть — отдаётся как есть: данные и приветствие у найденного чата не меняются. Одновременные вызовы
   * дают один чат. Возвращает чат с данными объекта — только для сервера.
   * @throws TypeError ключ, данные или приветствие не подходят: ничего не записано.
   * @throws Error хранилище не умеет `findChatBySubject`.
   */
  openSubjectChat(input: OpenSubjectChatInput): Promise<OpenSubjectChatResult>;
  /**
   * Переносит готовую переписку (из старой системы, копия для проверки): даты как есть, одна ветка, ответы законченные,
   * без хода, памяти, расхода и лимитов. Картинки сохраняет `attachments.importFile` до записи; запись не удалась —
   * файлы убираются. Адреса HTTP нет: вызывает только сервер.
   * @throws TypeError данные импорта не подходят: ничего не записано.
   * @throws ChatAlreadyExistsError чат с таким id уже есть.
   * @throws Error хранилище не умеет `importChat` или картинки без `attachments.importFile`.
   */
  importChat(input: ImportChatInput): Promise<{ chatId: string }>;
  /**
   * Служебные сообщения в конец текущей ветки (результат фоновой задачи, «агент пишет первым»). Ключ доставки
   * проверяется под замком чата: повтор ничего не добавляет. Занятый чат — `busy`, ничего не записано; чата нет — `chat_gone`.
   * Неотвеченные подтверждения и виджеты закрываются. Ход идёт тем же путём, что ответ на сообщение человека; без
   * `wakeAgent`, после 5 ходов сервера подряд без человека или при исчерпанном лимите — сообщение без хода.
   */
  deliverNotices(input: DeliverNoticesInput): Promise<DeliverNoticesResult>;
  /**
   * Слияние верхних ключей в данные чата: ключ патча заменяет старый целиком, ключ со значением `undefined` удаляется.
   * Возвращает данные после записи (не осталось ключей — `{}`). Новое значение видят инструменты, хуки и инструкция чата
   * со следующего хода; событие `chat-data-changed` (без данных) идёт слушателям `subscribeEvents`.
   * @throws ChatNotFoundError чата нет или он чужой.
   * @throws TypeError патч не объект, не переводится в JSON или итог больше 16 КБ: данные не изменены.
   * @throws Error хранилище не умеет `updateChatData`.
   */
  updateChatData(userId: string, chatId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  /**
   * Данные чата копией, без записи и событий: те же проверки владения, что у `updateChatData`. Нет данных — `{}`.
   * @throws ChatNotFoundError чата нет или он чужой.
   */
  getChatData(userId: string, chatId: string): Promise<Record<string, unknown>>;
  /** События чата: начало и конец хода (с причиной и каналом), смена задач фона, смена данных чата. Возвращает отписку. */
  subscribeEvents(listener: (event: ChatEvent) => void): () => void;
  /**
   * Чаты пользователя, самые недавние первыми. Чаты объектов (`openSubjectChat`) по умолчанию не входят;
   * `subjects: "include"` — вместе с ними, `"only"` — только они. `data` — только чаты, у которых данные содержат все
   * эти верхние ключи с такими же значениями (строка, число, булево или `null`).
   * @throws TypeError значение фильтра по данным не строка, не число, не булево и не `null`.
   * @throws Error фильтр по данным, а хранилище не умеет `updateChatData`.
   */
  listChats(userId: string, options?: { subjects?: ChatSubjectFilter; data?: ChatDataFilter }): Promise<ChatListItem[]>;
  /**
   * Название чата, заданное человеком: пробелы схлопнуты. Возвращает записанное. Занятость не проверяется:
   * переименовать можно и во время ответа.
   * @throws InvalidChatTitleError пустое или длиннее 100 знаков: прежнее название остаётся.
   */
  renameChat(userId: string, chatId: string, title: string): Promise<string>;
  /**
   * Удаляет чат насовсем: идущий ответ останавливается (он не мешает удалению), сжатие отменяется, файлы вложений
   * убираются, из хранилища уходят чат, сообщения, записи сжатия и выбор веток. Пока чат удаляется, он занят:
   * новое сообщение, «повторить», «переделать», правка, `compactNow` и адреса вложений получают `ChatBusyError`.
   * `{ by: "app" }` — удаляет сервер приложения: право экрана `chatList` не проверяется.
   * @throws ChatBusyError чат уже удаляется или в этот миг запускается ход.
   * @throws ActionForbiddenError без `{ by: "app" }` у человека нет права `chatList`.
   */
  deleteChat(userId: string, chatId: string, actionOptions?: ActionOptions): Promise<void>;
  /**
   * Список для меню выбора: провайдеры с ключами на сервере, их модели и уровни рассуждений; без ключей и адресов.
   * `userId` — кто спрашивает: опция `modelMenu` может ему отказать.
   * @throws ActionForbiddenError `modelMenu` вернула `false` (право `modelDetails`).
   */
  getModelMenu(userId?: string): Promise<ModelMenu>;
  /**
   * Записывает выбор модели и уровня в чат; уровень не указан — уровень по умолчанию модели. Можно в любой момент:
   * идущий ответ дописывает прежняя модель. Возвращает выбор, как он сохранён. Выбор человека запоминается для его новых
   * чатов и зовёт `onModelChosen`. `{ by: "app" }` — выбор ставит сервер приложения: без права `modelChoice`, без
   * запоминания и без `onModelChosen`.
   * @throws InvalidModelChoiceError выбор не подходит: ничего не сохранено.
   */
  setModel(userId: string, chatId: string, choice: ModelChoice, actionOptions?: ActionOptions): Promise<ModelChoice>;
  /**
   * Проверяет, что чат есть, принадлежит человеку и не удаляется. Для расширений с адресами внутри чата.
   * @throws ChatNotFoundError
   * @throws ChatBusyError чат удаляется: загрузку файлов в него не принимаем.
   */
  assertOwnChat(userId: string, chatId: string): Promise<void>;
  /**
   * Проверка приложения (`beforeTurn`) для работы, которую служба сама не ведёт, но которая тратит деньги или пишет:
   * продолжение фоновой задачи, приём файлов и расшифровка голоса до отправки. Без `beforeTurn` ничего не делает.
   * `text` — если он уже известен. Хода за проверкой нет: пропуск сразу закрывается `turnNotStarted` с `no_turn`.
   * @throws ChatNotFoundError
   * @throws TurnRefusedError
   */
  assertTurnAllowed(userId: string, chatId: string, action: TurnAction, text?: string): Promise<void>;
  /**
   * Состояние лимитов расходов чата для экрана; без лимитов — всегда `ok`.
   * @throws ChatNotFoundError
   */
  getSpendingStatus(userId: string, chatId: string): Promise<SpendingStatus>;
  getHistory(userId: string, chatId: string): Promise<ChatHistory>;
  /**
   * История текущей ветки только на чтение (сотрудник смотрит чат человека): как `getHistory`, но ничего не пишет —
   * пустой чат не переходит на последний выбор модели, брошенный ответ не прерывается (виден как `detachedAnswer`).
   * @throws ChatNotFoundError
   */
  peekHistory(userId: string, chatId: string): Promise<ChatHistory>;
  getCompactions(userId: string, chatId: string): Promise<ChatCompactions>;
  getBranchForks(userId: string, chatId: string): Promise<ChatBranchForks>;
  /**
   * Состояние чата на текущей ветке: свёртка записей `model.state` всех сообщений ветки из хранилища (сжатие его не
   * теряет), без служебных ключей SDK. `atMessageId` — последнее сообщение ветки; пустой чат — `null`.
   * @throws ChatNotFoundError
   */
  getChatState(userId: string, chatId: string): Promise<ChatState>;
  /**
   * Переключает текущую ветку: `messageId` — одно из соседних сообщений на развилке текущей ветки.
   * Записывает выбор, сообщения не меняются. Возвращает историю новой текущей ветки.
   * @throws ChatBusyError идёт ответ. @throws InvalidMessageError сообщение не на развилке текущей ветки.
   */
  selectBranch(userId: string, chatId: string, messageId: string): Promise<ChatHistory>;
  /**
   * Новый ответ агента вместо ответа `messageId` на текущей ветке: сосед прежнего под тем же вопросом, прежний цел.
   * Запрос к модели тот же, что был на первый ответ.
   * @throws InvalidMessageError не ответ агента, не на текущей ветке или до него нет сообщения человека (приветствие).
   */
  regenerate(userId: string, chatId: string, messageId: string, page?: TurnRequestContext): Promise<ReadableStream<UIMessageChunk>>;
  /**
   * Правка отправленного вопроса: новое сообщение рядом с прежним (тот же родитель) и новый ответ на него.
   * Прежний вопрос и всё после него остаются соседней веткой.
   * С `voiceMode` правка — продолжение голосовой фразы (склейка): сообщение запоминается голосовым, а название чата,
   * взятое из первого сообщения, обновляется по новому тексту.
   * @throws InvalidMessageError правится не вопрос собеседника на текущей ветке или текст не годится.
   */
  editMessage(
    userId: string,
    chatId: string,
    editedMessageId: string,
    message: IncomingUserMessage,
    options?: SendMessageOptions,
  ): Promise<ReadableStream<UIMessageChunk>>;
  /**
   * Правка готового ответа агента (песочница): новый ответ-сосед под тем же вопросом с новым текстом и, по желанию,
   * новыми результатами инструментов; он становится текущей веткой. Прежний ответ остаётся. Модель не вызывается.
   * @throws AnswerEditError почему правка не принята — в `kind`.
   * @throws ActionForbiddenError право `answerEditing` запрещено (`chatCapabilities`): ничего не записано.
   */
  editAnswer(userId: string, chatId: string, messageId: string, edit: AnswerEdit): Promise<StoredMessage>;
  /**
   * Сжимает историю чата сейчас, не глядя на порог. Наружу по HTTP не открыта: команда для приложения и тестов.
   * Идущее сжатие не дублируется: вызов дожидается его.
   */
  compactNow(userId: string, chatId: string): Promise<CompactionOutcome>;
  /** Сохраняет реплику, запускает ход и отдаёт поток ответа с начала. */
  sendMessage(
    userId: string,
    chatId: string,
    message: IncomingUserMessage,
    options?: SendMessageOptions,
  ): Promise<ReadableStream<UIMessageChunk>>;
  /**
   * Поправка, пока агент отвечает: сообщение человека пишется сразу (ребёнок идущего ответа или прошлой поправки), агент
   * берёт его на ближайшей границе шага — ответ закрывается, и ход продолжается новым ответом на поправки (поток —
   * `subscribe`). Ответ кончился раньше — новый ход на поправки сразу после него. Хода нет — обычное сообщение и ход
   * (`started`). Проверки — как у `sendMessage` (`beforeTurn` с действием `send`, лимиты, файлы).
   * @throws ChatBusyError ответ идёт на другой копии сервера.
   */
  steer(userId: string, chatId: string, message: IncomingUserMessage, options?: { page?: TurnRequestContext }): Promise<SteerResult>;
  /**
   * Новый ответ на последний вопрос ветки: после ошибки, стопа, прерывания или пустого ответа,
   * а также если вопрос остался без ответа. Прежний ответ остаётся соседней веткой.
   */
  retry(userId: string, chatId: string, page?: TurnRequestContext): Promise<ReadableStream<UIMessageChunk>>;
  /**
   * Решение человека по запросу подтверждения: разрешить, отклонить или разрешить и больше не спрашивать в этом чате.
   * Когда отвечены все запросы ответа, ход продолжается в том же сообщении: `resumed: true`, поток — `subscribe`.
   * @throws ApprovalNotPendingError такого ожидающего запроса нет.
   * @throws ChatBusyError ход в чате уже идёт.
   */
  answerApproval(
    userId: string,
    chatId: string,
    approvalId: string,
    answer: ApprovalAnswer,
    page?: TurnRequestContext,
  ): Promise<{ resumed: boolean }>;
  /**
   * Ответ человека на ждущий виджет в последнем ответе текущей ветки. Записывается результатом вызова; когда ждать
   * больше нечего (нет других виджетов и запросов подтверждения), ход продолжается в том же сообщении: `resumed: true`,
   * поток — `subscribe`. Каждый отказ — строка `[виджет] отказ <вид> чат=… вызов=…` в журнал, без содержимого ответа.
   * @throws ChatNotFoundError чат не этого человека.
   * @throws WidgetNotPendingError виджет не ждёт ответа (в том числе одновременный ответ через другую копию сервера).
   * @throws InvalidWidgetAnswerError ответ не прошёл схему или длиннее 16 КБ; ничего не записано.
   * @throws WidgetAnswerRefusedError приложение отказало текстом (`checkAnswer`): ничего не записано, виджет ждёт дальше.
   * @throws ChatBusyError ход в чате уже идёт.
   */
  answerWidget(request: WidgetAnswerRequest): Promise<{ resumed: boolean }>;
  /**
   * Ответ вкладки на браузерный инструмент: результат (JSON до 16 КБ, больше — ошибка вызова «Слишком большой результат»)
   * или текст ошибки (обрезается до 1000 знаков). Ход продолжается тем же ответом; свободным быть ему не нужно.
   * @throws ChatNotFoundError
   * @throws BrowserCallNotPendingError вызов не ждёт ответа (уже отвечен, срок вышел, ход кончился) или `tabId` чужой.
   */
  answerBrowserCall(userId: string, chatId: string, toolCallId: string, answer: BrowserCallAnswer): Promise<void>;
  /** Поток идущего ответа с начала; `null`, если хода нет. */
  subscribe(userId: string, chatId: string): Promise<ReadableStream<UIMessageChunk> | null>;
  /** Останавливает идущий ответ; ход, который ещё запускается, остановится сразу после старта. `false`, если хода нет. */
  stop(userId: string, chatId: string): Promise<boolean>;
  /**
   * Брошенные ответы — `streaming` без знака жизни дольше `ANSWER_STALE_AFTER_MS` (копия сервера упала или выключена) —
   * переводит в `interrupted`, написанное не трогает, незаписанный расход пишет в журнал. Живые ответы, в том числе
   * других копий сервера на той же базе, не трогает (FR-060). Вызывать при старте сервера: заодно запускает такую же
   * проверку раз в `STALE_ANSWERS_SWEEP_EVERY_MS`, до `flush`. Возвращает число прерванных при этом вызове.
   * `{ soleServer: true }` — копия сервера одна: прерываются все идущие ответы, кроме ответов этой службы. Только при
   * старте процесса; подробно — `RecoverInterruptedAnswersOptions.soleServer`.
   */
  recoverInterruptedAnswers(recoverOptions?: RecoverInterruptedAnswersOptions): Promise<number>;
  /**
   * Событие приложения вне хода (оплата прошла, урок открыт): открытая вкладка чата получает его живьём через канал
   * наблюдения (`watch`) событием `app-event`. В историю не пишется: закрытая вкладка его не увидит. Чужой чат —
   * `ChatNotFoundError`, событие не по правилам — `TypeError`.
   */
  publishAppEvent(input: { ownerId: string; chatId: string; event: AppEvent }): Promise<void>;
  /**
   * Закрывает чат (заявка отправлена, форма снята): отправка, «Повторить» и ответы на запросы получают
   * `ChatClosedError` (сервер — 409 `chat_closed`), служебные сообщения пишутся без хода. Открытая вкладка закрывает поле
   * ввода живьём (событие `chat-closed`). Ответ, ждущий подтверждения или виджета, перестаёт ждать: запросы закрываются
   * отказом, как при «Стопе» (закрытие побеждает паузу; идущий ход сделает так в своём конце). Повторный вызов заменяет
   * код и текст. Закрытие — запись в конце текущей ветки (идёт ход — после него): правка, «Переделать» или выбор ветки
   * до этой точки открывают чат. Закрыть навсегда — правами (`chatCapabilities` видит `chat.closed`).
   * Чужой чат — `ChatNotFoundError`, неверный код — `TypeError`.
   */
  closeChat(input: { ownerId: string; chatId: string } & ChatClosure): Promise<void>;
  /** Снимает закрытие записью в конце ветки (событие `chat-reopened`); открытый чат — ничего. Чужой чат — `ChatNotFoundError`. */
  reopenChat(input: { ownerId: string; chatId: string }): Promise<void>;
  /**
   * Право человека в чате — для адресов расширений (загрузка вложений и т. п.).
   * @throws ChatNotFoundError
   * @throws ActionForbiddenError
   */
  assertCapability(userId: string, chatId: string, capability: ChatCapability): Promise<void>;
  /**
   * Штатная остановка: вызывать после того, как сервер перестал принимать запросы, и до закрытия хранилища. Новые ходы
   * не начинаются (чат занят). Идущие ответы ждёт до `waitForAnswersMs`; не успевшие останавливает, как «Стоп»:
   * написанное записывается, `status: "stopped"`, `afterTurn` видит `stopReason: "shutdown"`. Возвращается, когда все
   * ответы записаны, хуки `afterTurn` (в своём сроке), сжатие, память и фон закончены — после этого хранилище можно
   * закрывать. Проверка брошенных ответов останавливается (идущая дожидается). Без `waitForAnswersMs` (или 0) ответы
   * останавливаются сразу. Остановленный ход, не записавший итог за 10 с (база висит), остановка больше не ждёт: строка в
   * `logError`, ответ прервёт восстановление при следующем старте. Такой ход может дописать итог и после возврата `flush`;
   * закрытая к тому времени база даст лишь строки в `logError`.
   * @throws TypeError неверный `waitForAnswersMs`
   */
  flush(options?: FlushOptions): Promise<void>;
  /** Включены ли живые демонстрации (`agent.liveDemos`): мессенджеры вместо блока ```html-demo пишут «доступна на сайте». */
  readonly liveDemos?: boolean;
}

/** Как останавливать службу. */
export interface FlushOptions {
  /** Сколько ждать идущие ответы, мс, прежде чем остановить их: от 0 до 2³¹−1. По умолчанию 0 — остановить сразу. */
  waitForAnswersMs?: number;
}

/** Срок ожидания ответов при остановке или `TypeError`. */
function resolveWaitForAnswersMs(options: FlushOptions | undefined): number {
  const value = options?.waitForAnswersMs ?? 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2 ** 31 - 1) {
    throw new TypeError("flush: waitForAnswersMs — число мс от 0 до 2³¹−1");
  }
  return value;
}

/** Ошибки неверного запроса службы: ход после пропуска не начат с причиной `invalid`. */
function isInvalidTurnRequest(error: unknown): boolean {
  return (
    error instanceof InvalidMessageError ||
    error instanceof NothingToRetryError ||
    error instanceof ApprovalNotPendingError ||
    error instanceof WidgetNotPendingError ||
    error instanceof InvalidWidgetAnswerError ||
    error instanceof WidgetAnswerRefusedError ||
    error instanceof AttachmentRejectedError ||
    error instanceof ChatNotFoundError
  );
}

/**
 * Инструменты памяти рядом с инструментами приложения (инструкцию памяти дописывает `assembleInstructions`).
 * Повтор имени — ошибка: тихо подменить чужой инструмент нельзя.
 */
function withLongTermMemory(agent: AgentSettings, memory: LongTermMemory | undefined, logError: (message: string) => void): AgentSettings {
  if (!memory) return agent;
  const clash = (own: ToolSet, memoryNames: readonly string[]) => memoryNames.find((name) => Object.hasOwn(own, name));
  const clashMessage = (name: string) => `Инструмент «${name}» задан и приложением, и долгой памятью: переименуйте инструмент приложения`;
  if (agent.tools && typeof agent.tools !== "function") {
    const name = clash(agent.tools, memory.toolNames);
    if (name) throw new Error(clashMessage(name));
  }
  const appTools = agent.tools;
  return {
    ...agent,
    tools: (model) => {
      const own = typeof appTools === "function" ? appTools(model) : (appTools ?? {});
      // В группе памяти владельца нет: её инструменты даже не собираются.
      if (model.audience === "group") return own;
      const fromMemory = memory.tools(model);
      const name = clash(own, Object.keys(fromMemory));
      if (name) {
        logError(clashMessage(name));
        throw new Error(clashMessage(name));
      }
      return { ...own, ...fromMemory };
    },
  };
}

/**
 * Инструменты фона рядом с инструментами приложения и памяти. Повтор имени — ошибка: при создании службы для набора,
 * на ходе — для набора из функции.
 */
function withBackgroundTools(agent: AgentSettings, background: BackgroundTasks | undefined, logError: (message: string) => void): AgentSettings {
  if (!background) return agent;
  const clashMessage = (name: string) => `Инструмент «${name}» задан и приложением, и фоном: переименуйте инструмент приложения`;
  if (agent.tools && typeof agent.tools !== "function") {
    const name = background.toolNames.find((toolName) => Object.hasOwn(agent.tools as ToolSet, toolName));
    if (name) throw new Error(clashMessage(name));
  }
  const appTools = agent.tools;
  return {
    ...agent,
    instructions: `${agent.instructions}\n\n${background.instructions}`,
    tools: (model) => {
      const own = typeof appTools === "function" ? appTools(model) : (appTools ?? {});
      const fromBackground = background.tools(model);
      const name = Object.keys(fromBackground).find((toolName) => Object.hasOwn(own, toolName));
      if (name) {
        logError(clashMessage(name));
        throw new Error(clashMessage(name));
      }
      return { ...own, ...fromBackground };
    },
  };
}

/**
 * Описания браузерных инструментов, проверенные при создании службы: без `execute`, имена не совпадают с инструментами
 * приложения (заданными набором) и памяти. Совпадение с набором из функции видно только на ходе — тогда ошибка хода.
 */
function checkedBrowserTools(agent: AgentSettings, memory: LongTermMemory | undefined, widgets: AgentWidgets): ToolSet | undefined {
  if (!agent.browserTools) return undefined;
  const descriptions = checkBrowserToolDescriptions(agent.browserTools);
  const taken = [...(agent.tools && typeof agent.tools !== "function" ? Object.keys(agent.tools) : []), ...(memory?.toolNames ?? [])];
  const clash = Object.keys(descriptions).find((name) => taken.includes(name));
  if (clash) throw new Error(`Инструмент «${clash}» задан и браузерным инструментом, и инструментом приложения или памяти: переименуйте один из них`);
  const widgetClash = Object.keys(descriptions).find((name) => Object.hasOwn(widgets.tools, name));
  if (widgetClash) throw new Error(`Инструмент «${widgetClash}» задан и браузерным инструментом, и виджетом: переименуйте браузерный инструмент`);
  return descriptions;
}


/** Имена виджетов не заняты памятью и фоном: проверка при создании службы, с `enabledFor` и без. */
function checkWidgetNamesFree(widgets: AgentWidgets, memory: LongTermMemory | undefined, background: BackgroundTasks | undefined): void {
  const memoryClash = memory?.toolNames.find((name) => Object.hasOwn(widgets.tools, name));
  if (memoryClash) throw new Error(`Инструмент «${memoryClash}» задан и долгой памятью, и виджетом: переименуйте виджет`);
  const backgroundClash = background?.toolNames.find((name) => Object.hasOwn(widgets.tools, name));
  if (backgroundClash) throw new Error(`Инструмент «${backgroundClash}» задан и фоном, и виджетом: переименуйте виджет`);
}

/** Инструменты виджетов рядом с инструментами приложения и памяти. Без виджетов — те же настройки. */
function withWidgets(agent: AgentSettings, widgets: AgentWidgets, logError: (message: string) => void): AgentSettings {
  const tools = withWidgetTools(agent.tools, widgets, logError);
  return tools === agent.tools ? agent : { ...agent, tools };
}

/**
 * Инструкция чата на ход и сжатие, когда приложение задало `chatInstructions`: своя — со служебными блоками
 * (собранная строка запоминается по тексту), `null` — собранная инструкция приложения.
 */
function chatInstructionsSource(
  chatInstructions: ((chat: Chat) => Promise<string | null>) | undefined,
  appInstructions: string,
  blocks: InstructionBlocks,
  backgroundInstructions: string | undefined,
): ((chat: Chat) => Promise<string>) | undefined {
  if (!chatInstructions) return undefined;
  const assembler = createInstructionsAssembler(blocks);
  return async (chat) => {
    const base = await chatInstructions(chat);
    if (base === null) return appInstructions;
    const assembled = assembler.forBase(base);
    return backgroundInstructions === undefined ? assembled : `${assembled}\n\n${backgroundInstructions}`;
  };
}

/** Сжатию — те же инструменты, что и ответу, с браузерными описаниями: начало запроса сводки совпадает с ответом (кэш). */
/** Инструменты, которые сжатию нужны только описаниями: браузерные и помощники. Нет ни тех, ни других — `undefined`. */
function describedOnlyTools(
  browserTools: ToolSet | undefined,
  helpers: Record<string, AgentHelper> | undefined,
  limit: ResolvedToolResultLimit,
): ToolSet | undefined {
  if (!helpers) return browserTools;
  return { ...browserTools, ...helperToolDescriptions(helpers, limit) };
}

function withBrowserDescriptions(tools: AgentToolsSource | undefined, descriptions: ToolSet | undefined): AgentToolsSource | undefined {
  if (!descriptions) return tools;
  if (typeof tools !== "function") return { ...tools, ...descriptions };
  return (model) => ({ ...tools(model), ...descriptions });
}

export function createChatService(input: ChatServiceOptions): ChatService {
  const logError = input.logError ?? ((message: string) => console.error(message));
  const widgets = createAgentWidgets(input.agent.widgets);
  checkWidgetNamesFree(widgets, input.memory, input.background);
  const browserToolDescriptions = checkedBrowserTools(input.agent, input.memory, widgets);
  checkHelpers(input.agent.helpers, {
    catalog: input.catalog,
    takenToolNames: [
      ...(input.agent.tools && typeof input.agent.tools !== "function" ? Object.keys(input.agent.tools) : []),
      ...(input.memory?.toolNames ?? []),
      ...Object.keys(widgets.tools),
      ...Object.keys(browserToolDescriptions ?? {}),
      ...(input.background?.toolNames ?? []),
    ],
    backgroundConnected: Boolean(input.background),
  });
  // Служебные блоки инструкции: без `chatInstructions` собираются один раз (запрос как прежде), с ним — на ход.
  const instructionBlocks: InstructionBlocks = {
    ...(input.attachments?.instructions && { attachments: input.attachments.instructions }),
    ...(input.agent.diagrams && { diagrams: true }),
    ...(input.agent.liveDemos && { liveDemos: true }),
    ...(input.memory && { memory: input.memory.instructions }),
  };
  const options = {
    ...input,
    agent: withWidgets(
      withLongTermMemory(
        withBackgroundTools({ ...input.agent, instructions: assembleInstructions(input.agent.instructions, instructionBlocks) }, input.background, logError),
        input.memory,
        logError,
      ),
      widgets,
      logError,
    ),
  };
  const { storage } = options;
  /** Вызовы, чей результат правка ответа не меняет: файлы (по списку приложения) и ответы человека на виджеты. */
  const uneditableTools: ReadonlySet<string> = new Set([...(input.lockedToolOutputs ?? []), ...Object.keys(widgets.tools)]);
  const instructionsOfChat = chatInstructionsSource(input.chatInstructions, options.agent.instructions, instructionBlocks, input.background?.instructions);
  const chatEvents = input.chatEvents ?? createChatEvents((error) => logError(`Слушатель событий чата упал: ${String(error)}`));
  const afterTurn =
    options.afterTurn &&
    createAfterTurn({
      settings: { handler: options.afterTurn, timeoutMs: options.afterTurnTimeoutMs, attempts: options.afterTurnAttempts },
      storage,
      catalog: options.catalog,
      chatEvents,
      logError,
      ...(options.staffOfChat && { staffOf: options.staffOfChat }),
    });
  const stateChanged = createStateChanged({
    ...(options.onStateChanged && { handler: options.onStateChanged }),
    ...(options.onStateChangedTimeoutMs !== undefined && { timeoutMs: options.onStateChangedTimeoutMs }),
    ...(options.onStateChangedAttempts !== undefined && { attempts: options.onStateChangedAttempts }),
    chatEvents,
    logError,
  });
  const {
    voiceModeHint,
    textModeNote,
    voices,
    placeMaxLength: placeMaxLengthSetting,
    browserTools: _browserTools,
    browserToolTimeoutMs: browserToolTimeoutSetting,
    toolResultMaxLength,
    providerFallback,
    cacheMissLog,
    toolTimeoutMs: toolTimeoutSetting,
    sequentialTools: sequentialToolsSetting,
    timeZone: timeZoneSetting,
    modelSilenceTimeout,
    widgets: _widgets,
    turnTimeoutMs,
    maxOutputTokens,
    stepContextTimeoutMs: stepContextTimeoutSetting,
    contextBlocksTimeoutMs: contextBlocksTimeoutSetting,
    ...agentSettings
  } = options.agent;
  const stepContextTimeoutMs = resolveTimeoutMs(stepContextTimeoutSetting, DEFAULT_STEP_CONTEXT_TIMEOUT_MS, "agent.stepContextTimeoutMs");
  const contextBlocksTimeoutMs = resolveTimeoutMs(contextBlocksTimeoutSetting, DEFAULT_CONTEXT_BLOCKS_TIMEOUT_MS, "agent.contextBlocksTimeoutMs");
  const turnLimits = resolveTurnLimits({ turnTimeoutMs, maxOutputTokens }, options.catalog);
  /** Ходы этой службы: общий срок хода и штатная остановка. */
  const liveTurns = createLiveTurns();
  const toolResultLimit = resolveToolResultLimit(toolResultMaxLength);
  const toolTimeout = resolveToolTimeout(toolTimeoutSetting);
  const sequentialTools = resolveSequentialTools(sequentialToolsSetting);
  // Инструменты SDK, которым нужен экран: видны при любых правах. Свои инструменты приложение помечает `showOnScreen`.
  const sdkScreenToolNames = new Set([...Object.keys(widgets.tools), ...Object.keys(browserToolDescriptions ?? {})]);
  const isScreenTool = (toolName: string) => sdkScreenToolNames.has(toolName);
  const hiddenStateKey = hiddenStateKeyOf(options.privateStateKeys);
  const fallbackTimeZone = resolveFallbackTimeZone(timeZoneSetting, options.limits?.timeZone);
  const modelSilence = resolveModelSilence(modelSilenceTimeout);
  const cacheMissWatch = cacheMissLog === false ? undefined : createCacheMissWatch({ logError });
  checkProviderFallback(providerFallback, options.catalog);
  const placeMaxLength = resolvePlaceMaxLength(placeMaxLengthSetting);
  const browserToolTimeoutMs = resolveBrowserToolTimeoutMs(browserToolTimeoutSetting);
  /** Браузерные вызовы, которые ждут ответа вкладки: в памяти процесса, как и реестр идущих ответов. */
  const pendingBrowserCalls = createPendingBrowserCalls();
  const tagsOf = (voiceId: string | undefined) => (voiceId === undefined ? undefined : voices?.tagsOf(voiceId));
  /** Голос человека сейчас; не ответило — без голоса (общий список тегов), отправку сообщения это не ломает. */
  const currentVoice = async (userId: string): Promise<string | undefined> => {
    try {
      return await voices?.current(userId);
    } catch (error) {
      logError(`Голос: не удалось узнать голос человека: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const modeNotes: ModeNotes = {
    voice: voiceModeHint ?? ((voiceId) => voiceModeHintFor(tagsOf(voiceId))),
    text: textModeNote ?? DEFAULT_TEXT_MODE_NOTE,
    sounds: voiceSoundsNote,
    // Голоса с одним и тем же списком тегов друг от друга для модели не отличаются: пометка им не нужна.
    ...(voiceModeHint === undefined && voices && {
      voiceChanged: (from: string, to: string) => (sameVoiceTagSet(tagsOf(from), tagsOf(to)) ? undefined : voiceChangeNote(tagsOf(to))),
    }),
  };
  const registry = options.registry ?? createRunningAnswerRegistry();
  const env = options.env ?? process.env;
  const defaultChoice = resolveDefaultChoice(options.catalog, env, options.defaultChoice, logError);
  for (const warning of cachePriceWarnings(options.catalog)) logError(`[цена кэша] ${warning}`);
  /** Чаты, где ход уже запускается, но ещё не в реестре. */
  const starting = new Set<string>();
  /** Идущая проверка ответа виджета приложением по чату (под замком чата она одна): «Стоп» отменяет её сигнал. */
  const widgetChecks = new Map<string, AbortController>();
  /** Работа под замком чата: остановка службы ждёт её, прежде чем ждать ответы. */
  const startingWork = new Set<Promise<unknown>>();
  /** Идёт остановка службы (`flush`): новые ходы не начинаются. */
  let closing = false;
  const turnSlots = createTurnSlots(resolveMaxConcurrentTurns(options.maxConcurrentTurnsPerUser));
  /** Места ходов, которые запускаются: при запуске место переходит к ходу, при сорванном запуске освобождается. */
  const startingSlots = new Map<string, TurnSlot>();
  /** Ходы человека на проверках до хода (`beforeTurn`, лимит), по чатам: «Стоп» в это время ждёт старта хода. */
  const admittingTurns = new Map<string, number>();
  /** «Стоп», пришедший, пока ход запускался: ход останавливается, как только попадёт в реестр. */
  const stopsWhileStarting = new Set<string>();
  /** Чаты, которые удаляются: сжатие «сейчас» и загрузка файлов в них не пускаются. */
  const deleting = new Set<string>();
  /**
   * Закрытие и открытие из кода, пока чат занят ходом: чат уже такой (`null` — открыт), запись ляжет в конец ветки после
   * хода. Иначе запись встала бы между вопросом и ответом.
   */
  const pendingClosures = new Map<string, ChatClosure | null>();
  /** Чаты, где сейчас пишется ждущее закрытие. */
  const writingClosures = new Set<string>();
  /** Работа после хода (состояние, закрытие): остановка службы её ждёт. */
  const afterTurnWork = new Set<Promise<void>>();
  const flushers = new Set<() => Promise<void>>();
  /** Ответы ходов этой копии: проверка брошенных их не трогает, даже если база не принимала знаки жизни. */
  const liveAnswerIds = new Set<string>();
  /** Поправки человека к идущим ходам этой копии (`steer`). */
  const steering = createTurnSteering<TurnRequestContext>();
  /** Передачи хода новому ответу на поправки, по чатам: чат занят, `subscribe` ждёт новый ход. */
  const handOffs = new Map<string, Promise<void>>();
  /** Приём поправок этой копии по чату и id: повтор, пришедший до итога, получает тот же итог. */
  const steersInFlight = new Map<string, Promise<SteerResult>>();
  /** Работа под замком чата по чатам: поправка, пришедшая в это время, ждёт её конца. */
  const startingByChat = new Map<string, Promise<unknown>>();
  // Очереди инструментов «по одному» по чатам: живут, пока в них есть вызовы (FR-057).
  const chatToolQueues = new Map<string, ToolQueue>();
  /** Проверка брошенных ответов раз в `STALE_ANSWERS_SWEEP_EVERY_MS`: идёт после `recoverInterruptedAnswers`, до `flush`. */
  let staleSweep: StaleSweep | null = null;
  /** Продолжающийся после подтверждения ответ, каким он был до продолжения: его куски дописываются на клиенте. */
  const resumeBases = new Map<string, AgentChatMessage>();
  const compaction = createCompactionService({
    storage,
    catalog: options.catalog,
    env,
    // Сжатие берёт кэш хода: у него те же инструменты, что у модели агента, — с браузерными и помощниками.
    agent: { ...options.agent, tools: withBrowserDescriptions(options.agent.tools, describedOnlyTools(browserToolDescriptions, options.agent.helpers, toolResultLimit)) },
    ...(options.attachments && { attachments: options.attachments }),
    settings: resolveCompactionSettings(options.compaction),
    logError,
    ...(options.turnObserver && { turnObserver: options.turnObserver }),
    ...(instructionsOfChat && { instructionsFor: instructionsOfChat }),
    ...(widgets.switchable.size > 0 && { switchableTools: widgets.switchable }),
  });
  const memoryAfterAnswer = createMemoryAfterAnswer({
    memory: options.memory,
    storage,
    catalog: options.catalog,
    env,
    logError,
    ...(options.turnObserver && { turnObserver: options.turnObserver }),
  });

  /** Отказ в ответе на виджет — строка в журнал: вид, чат и вызов, без содержимого ответа (FR-010a). */
  async function loggingWidgetRefusal<T>(chatId: string, toolCallId: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const kind = widgetRefusalKind(error);
      if (kind) logError(`[виджет] отказ ${kind} чат=${logValue(chatId)} вызов=${logValue(toolCallId)}`);
      throw error;
    }
  }

  /**
   * Проверка ответа виджета приложением (`checkAnswer`), если она задана; под замком чата, до записи ответа.
   * Отказ идёт наружу как `WidgetAnswerRefusedError`, «Стоп» — как `WidgetAnswerCheckAbortedError`, вышедший срок — как `WidgetAnswerCheckTimeoutError` (оба не сбой службы), любая другая ошибка — ещё и строкой в журнал (без содержимого ответа).
   */
  async function checkingWidgetAnswerByApp(
    call: { ownerId: string; chat: Chat; messageId: string; toolName: string; toolCallId: string; input: unknown },
    accepted: unknown,
    branch: readonly StoredMessage[],
  ): Promise<CheckedWidgetAnswer> {
    const check = widgets.appCheckOf(call.toolName);
    if (!check) return { output: accepted, stateRecords: [], appEvents: [] };
    const subject = subjectOfChat(call.chat);
    const chatData = chatDataOfInput(call.chat);
    const controller = new AbortController();
    widgetChecks.set(call.chat.id, controller);
    try {
      return await checkWidgetAnswerByApp({
        check,
        answer: accepted,
        context: {
          ownerId: call.ownerId,
          chatId: call.chat.id,
          messageId: call.messageId,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          input: call.input,
          ...(subject && { subject }),
          ...(chatData && { chatData }),
        },
        base: foldAppState(branch),
        timeoutMs: widgets.checkTimeoutMs,
        controller,
        logError,
      });
    } catch (error) {
      if (!isWidgetCheckOutcome(error)) {
        // Только имя ошибки: её текст может нести данные ответа или базы.
        logError(`[виджет] ошибка проверки чат=${logValue(call.chat.id)} вызов=${logValue(call.toolCallId)}: ${logValue(error instanceof Error ? error.name : "не ошибка")}`);
      }
      throw error;
    } finally {
      widgetChecks.delete(call.chat.id);
    }
  }

  const turnGate = createTurnGate({
    beforeTurn: options.beforeTurn,
    turnNotStarted: options.turnNotStarted,
    isInvalidRequest: isInvalidTurnRequest,
    isStartedTurn: (error) => error instanceof TurnEndedBeforeSubscribeError,
    logError,
  });

  /**
   * Ход человека: проверка приложения, лимит расходов, затем `start` под замком чата. Пропуск без начатого хода (бросок
   * или `notStartedBecause` вернул причину) закрывается `turnNotStarted`.
   */
  async function startingTurn<T>(
    input: TurnGateInput,
    start: () => Promise<T>,
    notStartedBecause?: (result: T) => TurnNotStartedReason | undefined,
  ): Promise<T> {
    return admitting(input.chat.id, () => turnGate.admit(input, () => checkedStart(input, start), notStartedBecause));
  }

  /** Лимит расходов, затем `start` под замком чата: чат закрыт или занят — отказ до записи. */
  async function checkedStart<T>(input: TurnGateInput, start: () => Promise<T>): Promise<T> {
    const chatId = input.chat.id;
    await assertWithinSpendingLimit(input.userId, chatId);
    return whileStarting(chatId, async () => {
      if (OPEN_CHAT_ACTIONS.has(input.action)) await assertStillOpen(chatId);
      else await carryLegacyClosure(chatId);
      return start();
    });
  }

  /** Ход человека на проверках до хода: «Стоп» в это время ждёт старта хода. */
  async function admitting<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    admittingTurns.set(chatId, (admittingTurns.get(chatId) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const left = admittingTurns.get(chatId)! - 1;
      if (left > 0) admittingTurns.set(chatId, left);
      else admittingTurns.delete(chatId);
      forgetStopIfIdle(chatId);
    }
  }

  /** Ответы, которые уйдут с ветки, — для хуков приложения; без хуков ветка не читается. */
  async function abandonedForHooks(chatId: string, of: (branch: StoredMessage[]) => AbandonedAnswers): Promise<AbandonedAnswers> {
    if (!options.beforeTurn && !options.turnNotStarted) return {};
    return of((await loadTree(chatId)).branch);
  }

  const unlessResumed = (result: { resumed: boolean }): TurnNotStartedReason | undefined => (result.resumed ? undefined : "no_turn");

  /** Лимиты проверяются после чата и до всего, что пишет: нет лимитов — нет и проверки. */
  async function assertWithinSpendingLimit(userId: string, chatId: string): Promise<void> {
    await options.limits?.assertWithinLimit({ userId, chatId });
  }

  /**
   * Сообщение человека (отправка, правка) берёт место в окнах сообщений до записи — после проверки хода, денег и занятости
   * чата. `write` не дошла до записи (файлы, повтор id, сбой базы) — место отдаётся назад: сообщения нет, счёт прежний.
   */
  async function writingCountedMessage<T>(userId: string, chatId: string, write: () => Promise<T>): Promise<T> {
    const giveBack = await options.limits?.takeMessage?.({ userId, chatId });
    try {
      return await write();
    } catch (error) {
      await giveBack?.().catch((failure: unknown) => logError(`Место в лимите сообщений не вернулось (чат ${chatId}): ${failure instanceof Error ? failure.message : String(failure)}`));
      throw error;
    }
  }

  /** Ход по служебному сообщению: лимит исчерпан — сообщение пишется без хода, ошибки человеку не показать. */
  async function withinSpendingLimit(userId: string, chatId: string): Promise<boolean> {
    try {
      await assertWithinSpendingLimit(userId, chatId);
      return true;
    } catch (error) {
      if (error instanceof SpendingLimitReachedError) return false;
      throw error;
    }
  }

  /**
   * Файлы отмечаются прикреплёнными до записи сообщения. Отмеченный, но не отправленный файл безвреден (уйдёт вместе с чатом),
   * а неотмеченный файл записанного сообщения через сутки удалила бы чистка брошенных, если сервер упал между двумя шагами.
   * Сбой отметки сообщение не отменяет.
   */
  async function confirmFiles(messageId: string, fileParts: Parameters<NonNullable<typeof options.attachments>["confirmUserParts"]>[0]): Promise<void> {
    if (fileParts.length === 0) return;
    await options.attachments!.confirmUserParts(fileParts).catch((error: unknown) => logError(`Не удалось отметить вложения сообщения ${logValue(messageId)}: ${String(error)}`));
  }

  async function ownChat(userId: string, chatId: string): Promise<Chat> {
    const chat = await storage.getChat(chatId);
    if (!chat || chat.ownerId !== userId) throw new ChatNotFoundError(chatId);
    return chat;
  }

  /**
   * Права человека в чате; ошибка приложения (исключение, не булево значение) — строка в журнал и наружу. `scope` —
   * один запрос: права спрашиваются у приложения один раз, даже если их ждут и проверка, и история.
   */
  async function capabilitiesOf(userId: string, chat: Chat, scope?: RequestScope): Promise<ChatCapabilities> {
    if (!scope) return askCapabilities(userId, chat);
    scope.capabilities ??= askCapabilities(userId, chat);
    return scope.capabilities;
  }

  async function askCapabilities(userId: string, chat: Chat): Promise<ChatCapabilities> {
    if (!options.chatCapabilities) return resolveChatCapabilities(undefined);
    try {
      return resolveChatCapabilities(await options.chatCapabilities({ userId, chat }));
    } catch (error) {
      logError(`chatCapabilities упал или вернул неверные права (чат ${chat.id}): ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Что из ответа видит этот человек (права `reasoning`, `toolDetails`, `modelDetails`), с закрытием текущей ветки, как у проверок.
   * Без `chatCapabilities` видно всё и приложение не спрашивается.
   */
  async function visibilityFor(userId: string, chat: Chat, scope?: RequestScope): Promise<ClientVisibility> {
    if (!options.chatCapabilities) return clientVisibilityOf(resolveChatCapabilities(undefined), isScreenTool);
    return clientVisibilityOf(await capabilitiesOf(userId, withClosure(chat, await closureOf(chat)), scope), isScreenTool);
  }

  /** Поток хода для зрителя: права считаются до запуска хода, скрытое не уходит ни в живые куски, ни в повтор. */
  async function viewerStream(
    userId: string,
    chat: Chat,
    scope: RequestScope,
    open: () => Promise<ReadableStream<UIMessageChunk>>,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const visibility = await visibilityFor(userId, chat, scope);
    return visibility.visibleChunks(await open());
  }

  /** Правила чата до `beforeTurn` и любой записи: сначала права, потом закрытие (`open`). */
  async function assertChatRules(
    userId: string,
    chat: Chat,
    needs: { capabilities?: Array<ChatCapability | false>; open?: boolean },
    scope?: RequestScope,
  ): Promise<void> {
    const wanted = (needs.capabilities ?? []).filter((capability): capability is ChatCapability => capability !== false);
    const asksCapabilities = wanted.length > 0 && Boolean(options.chatCapabilities);
    if (!asksCapabilities && !needs.open) return;
    const closed = await closureOf(chat);
    if (asksCapabilities) {
      const capabilities = await capabilitiesOf(userId, withClosure(chat, closed), scope);
      const refused = wanted.find((capability) => !capabilities[capability]);
      if (refused) throw new ActionForbiddenError(refused);
    }
    if (needs.open && closed) throw new ChatClosedError(closed);
  }

  /** Хук приложения на новый чат человека: отказ — `ChatCreationRefusedError`, неверный отказ — `TypeError` и журнал. */
  async function assertMayCreateChat(userId: string, origin: ExternalChannel | undefined): Promise<void> {
    if (!options.beforeCreateChat) return;
    const refusal = await options.beforeCreateChat({ userId, ...(origin && { origin }) });
    if (!refusal) return;
    let refused: ChatCreationRefusedError;
    try {
      refused = new ChatCreationRefusedError(refusal);
    } catch (error) {
      logError(`beforeCreateChat вернул неверный отказ (человек ${userId}): ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    throw refused;
  }

  /**
   * Закрытие перечитывается под замком чата: чат могли закрыть между проверкой правил и замком (в `beforeTurn`, другой
   * вкладкой, кодом приложения). Тогда хода нет.
   */
  async function assertStillOpen(chatId: string): Promise<void> {
    const chat = await storage.getChat(chatId);
    const closed = chat && (await closureOf(chat));
    if (closed) throw new ChatClosedError(closed);
  }

  /** Закрытие из кода, ждущее конца хода, иначе запись на ветке; записи нет нигде в чате — копия (чат 0.27). */
  function closureFrom(chat: Pick<Chat, "id" | "closed">, state: Pick<BranchState, "values" | "closureRecorded">): ChatClosure | undefined {
    if (pendingClosures.has(chat.id)) return pendingClosures.get(chat.id) ?? undefined;
    return state.closureRecorded ? closureOfState(state.values) : chat.closed;
  }

  async function closureOf(chat: Pick<Chat, "id" | "closed">): Promise<ChatClosure | undefined> {
    if (pendingClosures.has(chat.id)) return pendingClosures.get(chat.id) ?? undefined;
    return closureFrom(chat, await readBranchState(storage, chat.id));
  }

  /** Чат с закрытием текущей ветки вместо копии: права (`chatCapabilities`) видят то же, что проверки и история. */
  const withClosure = (chat: Chat, closed: ChatClosure | undefined): Chat => {
    const { closed: _copy, ...rest } = chat;
    return closed ? { ...rest, closed } : rest;
  };

  /** Копия закрытия разошлась с веткой (её запись когда-то не прошла) — дописать молча: вкладка о закрытии уже знает. */
  async function repairClosureCopy(chat: Chat, closed: ChatClosure | undefined): Promise<void> {
    if (!storage.setChatClosed || sameClosure(chat.closed, closed)) return;
    await storage.setChatClosed(chat.id, closed ?? null).catch((failure: unknown) =>
      logError(`Копия закрытия чата ${chat.id} не записалась: ${failure instanceof Error ? failure.message : String(failure)}`),
    );
  }

  const sameClosure = (a: ChatClosure | undefined | null, b: ChatClosure | undefined | null): boolean =>
    (a ?? null) === (b ?? null) || (a?.code === b?.code && a?.message === b?.message);

  /**
   * Чат закрыт по 0.27 (копия есть, записи нет нигде в чате): закрытие переносится записью в конец текущей ветки, чтобы
   * правка и смена ветки его не потеряли. Только под замком чата.
   */
  async function carryLegacyClosure(chatId: string): Promise<void> {
    const chat = await storage.getChat(chatId);
    if (!chat?.closed || pendingClosures.has(chatId)) return;
    const state = await readBranchState(storage, chatId);
    if (state.closureRecorded) return;
    await storage.insertMessage(stateMessage({ chatId, parentId: state.atMessageId, record: closureRecord(chat.closed) }));
  }

  const closureRecord = (closed: ChatClosure | null): AppStateRecord => (closed ? { set: { [CLOSED_STATE_KEY]: closed } } : { unset: [CLOSED_STATE_KEY] });

  /** Записать закрытие в конец текущей ветки, если оно другое. Только под замком чата. @returns записано ли. */
  async function appendClosure(chat: Pick<Chat, "id" | "closed">, closed: ChatClosure | null): Promise<boolean> {
    const state = await readBranchState(storage, chat.id);
    const current = state.closureRecorded ? closureOfState(state.values) : chat.closed;
    if (sameClosure(current, closed)) return false;
    await storage.insertMessage(stateMessage({ chatId: chat.id, parentId: state.atMessageId, record: closureRecord(closed) }));
    return true;
  }

  /** Копия закрытия для списка и `chatCapabilities` и событие вкладке. Сбой копии — строка в журнал: закрытие уже записано. */
  async function writeClosureCopy(ownerId: string, chatId: string, closed: ChatClosure | null): Promise<void> {
    if (storage.setChatClosed) {
      await storage.setChatClosed(chatId, closed).catch((failure: unknown) =>
        logError(`Копия закрытия чата ${chatId} не записалась: ${failure instanceof Error ? failure.message : String(failure)}`),
      );
    }
    chatEvents.emit(closed ? { type: "chat-closed", ownerId, chatId, closed } : { type: "chat-reopened", ownerId, chatId });
  }

  /** Ветка сменилась: копия закрытия догоняет закрытие новой ветки. */
  async function syncClosureCopy(ownerId: string, chatId: string, state: BranchState): Promise<void> {
    const chat = await storage.getChat(chatId);
    if (!chat) return;
    const closed = closureFrom(chat, state);
    if (!sameClosure(chat.closed, closed)) await writeClosureCopy(ownerId, chatId, closed ?? null);
  }

  /** Ветка сменилась: копия закрытия, событие и хук смены состояния. Сбой — строка в журнал. */
  async function branchChanged(ownerId: string, chatId: string, reason: StateChangeReason, before: AppStateValues): Promise<void> {
    try {
      const state = await readBranchState(storage, chatId);
      // Чат удалили, пока ход доделывался: пустое состояние удалённого чата — не смена состояния.
      if (deleting.has(chatId) || !(await storage.getChat(chatId))) return;
      stateChanged.notify({ ownerId, chatId, reason, before, after: state.values, atMessageId: state.atMessageId });
      await syncClosureCopy(ownerId, chatId, state);
    } catch (failure) {
      logError(`Смена состояния чата ${chatId} не разослана: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  /** Работа после хода: остановка службы её дождётся. */
  function afterTurnTask(work: () => Promise<void>): void {
    const running = work();
    afterTurnWork.add(running);
    void running.finally(() => afterTurnWork.delete(running));
  }

  /** Чат свободен — ждущее закрытие ложится записью в конец ветки. */
  function writePendingClosure(chatId: string): void {
    if (!pendingClosures.has(chatId) || writingClosures.has(chatId) || starting.has(chatId) || registry.isRunning(chatId)) return;
    writingClosures.add(chatId);
    afterTurnTask(async () => {
      try {
        await holdingChat(chatId, async () => {
          if (!pendingClosures.has(chatId)) return;
          const closed = pendingClosures.get(chatId)!;
          const chat = await storage.getChat(chatId);
          pendingClosures.delete(chatId);
          if (!chat) return;
          if (closed) await denyWaitingIn(chatId);
          // Копия уже ждущая: сравнивается только с записью на ветке.
          await appendClosure({ id: chatId }, closed);
        });
      } catch (failure) {
        logError(`Закрытие чата ${chatId} не записалось после хода: ${failure instanceof Error ? failure.message : String(failure)}`);
      } finally {
        writingClosures.delete(chatId);
      }
    });
  }

  /** Права на то, что несёт сообщение человека: файлы и голос. */
  const messageCapabilities = (files: unknown[], voiceMode: boolean | undefined): Array<ChatCapability | false> => [
    files.length > 0 && "attachments",
    voiceMode === true && "voice",
  ];

  /** Видит ли выбранная модель картинки; модели нет в каталоге — `undefined`. */
  function acceptsImagesOf(choice: Pick<Chat, "modelId" | "providerId">): boolean | undefined {
    const profile = options.catalog.models.find((model) => model.id === choice.modelId);
    return profile && modelAcceptsImages(profile, choice.providerId);
  }

  /** Запись чата с выбором, на котором пойдёт ответ: сохранённым, если он доступен, иначе заменой. */
  function withEffectiveChoice(chat: Chat): Chat {
    const { reasoning: _saved, ...rest } = chat;
    return { ...rest, ...effectiveChoiceOfChat(options.catalog, env, chat, defaultChoice) };
  }

  /**
   * Последний выбор человека, если он есть и ещё доступен (уровень, которого у модели нет, заменяется уровнем по умолчанию).
   * Нет запомненного выбора, хранилище его не умеет или дало сбой — null.
   */
  async function rememberedChoice(userId: string): Promise<ModelChoice | null> {
    if (!storage.getUserModelChoice) return null;
    try {
      const remembered = await storage.getUserModelChoice(userId);
      return remembered ? effectiveChoiceOfChat(options.catalog, env, remembered, defaultChoice) : null;
    } catch (error) {
      logError(`Не удалось прочитать запомненный выбор модели человека ${userId}: ${String(error)}`);
      return null;
    }
  }

  /** Выбор для нового чата: последний выбор человека, иначе выбор по умолчанию. */
  async function choiceForNewChat(userId: string): Promise<ModelChoice> {
    return (await rememberedChoice(userId)) ?? defaultChoice;
  }

  /** История текущей ветки; `write: false` — только чтение, без записей (`peekHistory`). */
  async function historyOf(userId: string, chatId: string, { write, scope }: { write: boolean; scope?: RequestScope }): Promise<ChatHistory> {
    const stored = await ownChat(userId, chatId);
    const runningId = registry.runningMessageId(chatId);
    let { messages, selections, branch } = await loadTree(chatId);
    // Ответ брошен упавшей копией дольше порога — прерывается сразу, не дожидаясь проверки (FR-060).
    if (write && isDetachedAnswer(answerBeforeCorrections(branch), runningId) && storage.listSilentAnswerIds) {
      const recovered = await recoverStaleAnswers({ chatId }).catch((failure: unknown) => {
        logError(`Проверка брошенного ответа чата ${chatId} не удалась: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`);
        return 0;
      });
      if (recovered > 0) ({ messages, selections, branch } = await loadTree(chatId));
    }
    const chat = write ? await adoptRememberedChoiceIfEmpty(userId, stored, messages.length > 0) : stored;
    const closed = closureFrom(stored, branchStateOf(messages, selections));
    // Посреди хода копию ведёт сам ход: закрытие из инструмента ещё может не лечь в сохранённый ответ.
    if (write && runningId === null && !starting.has(chatId)) await repairClosureCopy(stored, closed);
    // Признак читается до записей: закончившееся между чтениями сжатие клиент увидит при следующем опросе, а не потеряет.
    const compacting = compaction.isCompacting(chatId);
    // Поправки после идущего ответа ещё не взяты: в ленте они идут отдельно, с пометкой. Ход уже передан поправкам —
    // прежний ответ записан целиком и дочитывается из реестра: он и поправки — обычная лента.
    const runningAnswerId = handOffs.has(chatId) ? null : runningId;
    const runningAt = runningAnswerId === null ? -1 : branch.findIndex((message) => message.id === runningAnswerId);
    const shown = runningAt < 0 ? branch : branch.slice(0, runningAt + 1);
    const pending = runningAt < 0 ? [] : branch.slice(runningAt + 1);
    const capabilities = await capabilitiesOf(userId, withClosure(stored, closed), scope);
    // Мысли, служебные инструменты и модель — по правам зрителя (`reasoning`, `toolDetails`, `modelDetails`); хранилище их держит.
    const visibility = clientVisibilityOf(capabilities, isScreenTool);
    const visible = (list: AgentChatMessage[]) => (visibility.showsEverything ? list : list.map((message) => visibility.visibleMessage(message)));
    const shownChat = withEffectiveChoice(withClosure(chat, closed));
    const acceptsImages = acceptsImagesOf(shownChat);
    return {
      chat: visibility.visibleChat(withoutSubjectData(shownChat)),
      // Служебные и закрытые ключи состояния и служебные сообщения в браузер не уходят (FR-003).
      messages: visible(
        publicMessages(
          shown
            .filter((message) => message.id !== runningAnswerId || resumeBases.get(chatId)?.id === runningAnswerId)
            .map((message) => (message.id === runningAnswerId ? resumeBases.get(chatId)! : toAgentChatMessage(message))),
          hiddenStateKey,
        ),
      ),
      ...(pending.length > 0 && { pendingMessages: visible(publicMessages(pending.map(toAgentChatMessage), hiddenStateKey)) }),
      // Ход передаётся новому ответу на поправки: он вот-вот пойдёт, поток подождёт его.
      running: runningId !== null || handOffs.has(chatId),
      detachedAnswer: isDetachedAnswer(answerBeforeCorrections(branch), runningId),
      // Сводка пересказывает выходы служебных инструментов: при `modelDetails: false` разделитель без текста.
      compactions: visibility.visibleCompactions(await compaction.markers(chatId, branch)),
      compacting,
      forks: branchForks(messages, branch).filter((fork) => fork.messageId !== runningAnswerId),
      capabilities,
      ...(acceptsImages !== undefined && { modelAcceptsImages: acceptsImages }),
      // Только приложению с живыми демонстрациями: остальные поля не видят.
      ...(input.agent.liveDemos === true && chatHasExternalContent(messages) && { externalContent: true as const }),
    };
  }

  /**
   * Пустой чат (без сообщений) открывается как новый: «Новый чат» в клиенте открывает уже созданный пустой чат, а не
   * плодит новые. Поэтому при открытии он переходит на последний выбор человека и записывает его у себя: ответ пойдёт
   * от той же пары, что показана. Чат с сообщениями хранит свой выбор и не меняется.
   */
  async function adoptRememberedChoiceIfEmpty(userId: string, chat: Chat, hasMessages: boolean): Promise<Chat> {
    if (hasMessages) return chat;
    const remembered = await rememberedChoice(userId);
    if (!remembered) return chat;
    const current = effectiveChoiceOfChat(options.catalog, env, chat, defaultChoice);
    if (current.modelId === remembered.modelId && current.providerId === remembered.providerId && current.reasoning === remembered.reasoning) return chat;
    await storage.updateChatModel(chat.id, remembered);
    return { ...chat, ...remembered };
  }

  /** Хук приложения на выбор человека; сбой — в журнал, выбор уже сохранён. */
  async function reportModelChosen(userId: string, chatId: string, choice: ModelChoice): Promise<void> {
    if (!options.onModelChosen) return;
    try {
      await options.onModelChosen({ userId, chatId, choice: { ...choice } });
    } catch (error) {
      logError(`onModelChosen: сбой хука (чат ${chatId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Запоминает выбор для новых чатов. Сбой выбор в чате не отменяет: он уже сохранён. */
  async function rememberChoice(userId: string, choice: ModelChoice): Promise<void> {
    if (!storage.saveUserModelChoice) return;
    await storage.saveUserModelChoice(userId, choice).catch((error: unknown) => logError(`Не удалось запомнить выбор модели человека ${userId}: ${String(error)}`));
  }

  /** Все сообщения чата без обрывков склейки голосовых фраз (они остаются в базе, но ветками не считаются), выбор человека и текущая ветка из них. */
  async function loadTree(chatId: string) {
    const [stored, selections] = await Promise.all([storage.listMessages(chatId), storage.listBranchSelections(chatId)]);
    const messages = withoutGlueFragments(stored);
    return { messages, selections, branch: selectCurrentBranch(messages, selections) };
  }

  async function currentBranch(chatId: string): Promise<StoredMessage[]> {
    return (await loadTree(chatId)).branch;
  }

  /** Держит чат занятым, пока ход запускается и ещё не попал в реестр. */
  async function whileStarting<T>(chatId: string, start: () => Promise<T>): Promise<T> {
    if (closing || starting.has(chatId) || registry.isRunning(chatId)) throw new ChatBusyError(chatId);
    return holdingChat(chatId, start);
  }

  async function holdingChat<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    starting.add(chatId);
    const running = work();
    startingWork.add(running);
    startingByChat.set(chatId, running);
    try {
      return await running;
    } finally {
      startingWork.delete(running);
      if (startingByChat.get(chatId) === running) startingByChat.delete(chatId);
      starting.delete(chatId);
      startingSlots.get(chatId)?.release();
      startingSlots.delete(chatId);
      forgetStopIfIdle(chatId);
      // Закрытие, пришедшее пока чат был занят, но ход так и не начался.
      writePendingClosure(chatId);
    }
  }

  /** Запуск кончился без хода (или ход уже забрал остановку): «Стоп» не переходит на следующий ход. */
  function forgetStopIfIdle(chatId: string): void {
    if (!admittingTurns.has(chatId) && !starting.has(chatId)) stopsWhileStarting.delete(chatId);
  }

  /** Место хода человека: берётся внутри `whileStarting` до первой записи, без ожидания. @throws TooManyTurnsError */
  function takeTurnSlot(userId: string, chatId: string): void {
    startingSlots.set(chatId, turnSlots.take(userId));
  }

  async function acceptFiles(userId: string, chatId: string, files: IncomingFilePart[]): Promise<StoredFilePart[]> {
    return files.length > 0 ? options.attachments!.acceptUserParts({ userId, chatId, parts: files }) : [];
  }

  /**
   * Человек написал новое сообщение, не ответив на запрос подтверждения или виджет: запрос считается отклонённым,
   * виджет получает пометку `{"ответ":"сообщением"}`, ответ становится законченным (FR-006). `branch` обновляется на месте.
   */
  async function closeUnansweredHumanInput(branch: StoredMessage[]): Promise<void> {
    const last = branch.at(-1);
    if (last?.status !== "awaiting_approval") return;
    try {
      branch[branch.length - 1] = await writeToWaiting(last, (current) => ({
        parts: [...closeWidgetsByMessage(denyPendingApprovals(current.parts, IGNORED_REASON), widgets.waiting)],
        status: "complete",
      }));
    } catch (error) {
      if (!(error instanceof MessageNotAwaitingError)) throw error;
      // Другая вкладка успела ответить, и ответ больше не ждёт: закрывать нечего, ветка идёт с его сохранённой версией.
      const saved = await storage.getMessage(last.id);
      if (saved) branch[branch.length - 1] = saved;
    }
  }

  /**
   * Чат закрыли, пока ответ ждёт подтверждения или виджета: закрытие побеждает паузу, запросы закрываются отказом, как
   * при «Стопе». Идущий или запускаемый ход сделает это сам в конце хода (`isChatClosed`).
   */
  async function denyWaitingIn(chatId: string): Promise<void> {
    const waiting = (await currentBranch(chatId)).at(-1);
    if (waiting?.status !== "awaiting_approval") return;
    await denyingWaitingHumanInput(waiting);
  }

  /** Закрывает ждущий ответ отказом, как «Стоп»; зовётся под замком чата. Другая вкладка успела ответить — ничего не делает. */
  async function denyingWaitingHumanInput(waiting: StoredMessage): Promise<void> {
    await writeToWaiting(waiting, (current) => ({
      parts: closeHangingToolCalls(denyPendingApprovals(current.parts, INTERRUPTED_REASON, RESULT_UNKNOWN_REASON)),
      status: "complete",
    })).catch((error: unknown) => {
      if (!(error instanceof MessageNotAwaitingError)) throw error;
    });
  }

  /**
   * Закрытие и открытие из кода. Чат свободен — запись в конец ветки под замком (закрытие сначала отклоняет ждущие
   * запросы ответа); занят ходом — закрытие ждёт конца хода, а проверки видят его сразу. Копия и событие — сразу.
   */
  async function changeClosure(chat: Chat, closed: ChatClosure | null): Promise<void> {
    const chatId = chat.id;
    if (closing || deleting.has(chatId) || starting.has(chatId) || registry.isRunning(chatId)) {
      if (sameClosure(await closureOf(chat), closed)) return;
      pendingClosures.set(chatId, closed);
      await writeClosureCopy(chat.ownerId, chatId, closed);
      writePendingClosure(chatId);
      return;
    }
    const written = await holdingChat(chatId, async () => {
      if (closed) await denyWaitingIn(chatId);
      return appendClosure((await storage.getChat(chatId)) ?? chat, closed);
    });
    if (written) await writeClosureCopy(chat.ownerId, chatId, closed);
  }

  /**
   * Запись в ждущий ответ проходит, только если его части не менялись с чтения. Другая копия сервера успела записать
   * свой ответ — сообщение перечитывается, и `build` собирает запись заново из свежих частей; ответ другой копии
   * не затирается. `build` бросает, если ответ этой копии на свежих частях уже не нужен.
   * @returns записанное сообщение. @throws MessageNotAwaitingError ответ больше не ждёт.
   */
  async function writeToWaiting(waiting: StoredMessage, build: (current: StoredMessage) => AwaitingMessagePatch): Promise<StoredMessage> {
    let current = waiting;
    for (let attempt = 1; ; attempt++) {
      const patch = build(current);
      try {
        await storage.updateAwaitingMessage(current.id, { ...patch, expectedParts: current.parts });
        return { ...current, parts: patch.parts, ...(patch.status && { status: patch.status }) };
      } catch (error) {
        if (!(error instanceof MessageNotAwaitingError) || attempt >= WAITING_WRITE_ATTEMPTS) throw error;
        const fresh = await storage.getMessage(current.id);
        if (fresh?.status !== "awaiting_approval") throw error;
        current = fresh;
      }
    }
  }

  /** Ответ человека дописан, и больше ничего не ждёт: ход продолжается. Место хода берётся до записи и один раз. */
  function resumingPatch(userId: string, chatId: string, parts: AwaitingMessagePatch["parts"]): AwaitingMessagePatch {
    if (pendingHumanInput(parts, widgets.waiting).length > 0) return { parts };
    if (!startingSlots.has(chatId)) takeTurnSlot(userId, chatId);
    // Ответ ждал сколько угодно: знак жизни — сейчас, иначе проверка брошенных прервёт его (FR-060).
    return { parts, status: "streaming", alive: "now" };
  }

  /** Запускает ход агента в ответ на `question`; `branch` — ветка до вопроса включительно; `action` — чем начат ход. */
  async function startAnswer(
    action: TurnAction,
    userId: string,
    chatId: string,
    branch: StoredMessage[],
    page: TurnRequestContext | undefined,
    createdAt?: string,
    stateBefore?: AppStateValues,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const stream = await launchTurn(userId, chatId, branch, { parentId: branch.at(-1)!.id, createdAt, page, action, ...(stateBefore && { stateBefore }) });
    if (!stream) throw new TurnEndedBeforeSubscribeError(chatId);
    return stream;
  }

  /**
   * Продолжает оборванный ответ `last` после «Повторить»: новый ответ-сосед начинается с выполненных шагов прежнего,
   * модель идёт дальше с них. Нечего продолжать — `null`.
   */
  async function continueAnswer(
    userId: string,
    chatId: string,
    { messages, selections, branch }: Pick<Awaited<ReturnType<typeof loadTree>>, "messages" | "selections" | "branch">,
    page: TurnRequestContext | undefined,
    stateBefore: AppStateValues,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const last = branch.at(-1)!;
    const choice = effectiveChoiceOfChat(options.catalog, env, await ownChat(userId, chatId), defaultChoice);
    const sameModel = last.modelId === choice.modelId && last.providerId === choice.providerId;
    const copied = partsForContinuation(last.parts, { sameModel });
    if (!copied) return null;
    // Скопированные события уже сработали в прежнем ответе: страница не сочтёт их живыми второй раз.
    const parts = markedAsCopiedAppEvents(copied, last.id);
    // Длительности рассуждений идут по их порядковому номеру: остаются только у скопированных рассуждений.
    const copiedReasoning = parts.filter((part) => part.type === "reasoning").length;
    const continuation = newStoredMessage({
      id: crypto.randomUUID(),
      chatId,
      parentId: last.parentId,
      role: "assistant",
      status: "streaming",
      parts,
      modelId: choice.modelId,
      providerId: choice.providerId,
      reasoningDurationsMs: Object.fromEntries(Object.entries(last.reasoningDurationsMs).filter(([index]) => Number(index) < copiedReasoning)),
      // Новый ответ — сосед прежнего и становится текущим, что бы человек ни выбирал до этого.
      createdAt: nextSiblingTime(messages, selections, last.parentId),
    });
    // Записывает соседа сам ход, когда запущен: сорвавшийся запуск не оставляет пустого варианта «‹ 2/2 ›».
    const stream = await launchTurn(userId, chatId, [...branch.slice(0, -1), continuation], {
      parentId: continuation.parentId!,
      createdAt: continuation.createdAt,
      resume: continuation,
      replay: true,
      page,
      action: "retry",
      stateBefore,
    });
    if (!stream) throw new TurnEndedBeforeSubscribeError(chatId);
    return stream;
  }

  /**
   * Запускает ход. Без `resume` — новый ответ на последнее сообщение `branch`; с `resume` — продолжение ответа,
   * который ждал подтверждения (он последний в `branch`, решения в нём уже отмечены). С `replay` продолжается
   * ответ-сосед после «Повторить»: клиент получает его скопированные шаги потоком, поэтому основы для истории не нужно.
   */
  async function launchTurn(
    userId: string,
    chatId: string,
    branch: StoredMessage[],
    launch: {
      parentId: string;
      createdAt?: string;
      resume?: StoredMessage;
      replay?: boolean;
      page?: TurnRequestContext;
      /** Чем начат ход: идёт в итог хода для `afterTurn`; `notice` — ход начал сервер. */
      action: TurnAction;
      /** Ход без подписчика (начал сервер): поток не нужен, возвращается `null`. */
      detached?: boolean;
      /** Состояние до хода, если ход уводит с прежней ветки (правка, «Переделать», «Повторить»). Нет — по `branch`. */
      stateBefore?: AppStateValues;
      /** Части продолжения, что клиент получит сразу после `start` (см. `resume.announced` хода). */
      announced?: StoredMessage["parts"];
    },
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const chat = await ownChat(userId, chatId);
    const stateBefore = launch.stateBefore ?? foldAppState(branch);
    // Канал и группа — по отметке последнего сообщения человека: так же идут и продолжения (подтверждение, «Повторить»).
    const { channel, group } = turnChannelOf(branch);
    const trigger: ChatTurnTrigger = launch.action === "notice" ? "notice" : "human";
    let finalStatus: AnswerStatus = "interrupted";
    // Инструкция чата — до запуска: не удалось взять — ход не начинается, как при сбое чтения чата.
    const instructions = instructionsOfChat && (await instructionsOfChat(chat));
    const staff = options.staffOfChat?.(chat) ?? undefined;
    // Потолки хода — тоже до запуска: не удалось взять — ход не начинается, как при сбое проверки лимита.
    const turnRules = await options.limits?.turnRules?.({ userId: chat.ownerId, chatId });
    // Замена (нет ключа, модель убрана из каталога) в чат не записывается: выбор пользователя вернётся сам.
    // Продолжение идёт на модели, что задала вопрос: за время ожидания человек мог сменить модель чата.
    const chatChoice = effectiveChoiceOfChat(options.catalog, env, chat, defaultChoice);
    const model = effectiveChoiceOfChat(options.catalog, env, choiceForLaunch(chatChoice, launch.resume), defaultChoice);
    const answerId = launch.resume?.id ?? crypto.randomUUID();
    // Место нужно только этому ходу: в хранилище и в сжатие оно не идёт.
    const place: ScreenPlace | null = resolveTurnPlace(launch.page?.place, { maxLength: placeMaxLength, chatId, logError });
    // Объект чата — инструментам и итогу хода; модели не уходит.
    const subject = subjectOfChat(chat);
    // Данные чата — тоже инструментам и итогу хода; модели не уходят.
    const chatData = chatDataOfInput(chat);
    // Дата в запросе — по поясу человека; не пришёл или не настоящий — `agent.timeZone`, без него — пояс сервера.
    const timeZone = resolveTimeZone(launch.page?.timeZone) ?? fallbackTimeZone;
    const resumeMessage = launch.resume && toAgentChatMessage(launch.resume);
    if (resumeMessage && !launch.replay) resumeBases.set(chatId, resumeMessage);
    const toolQueue = chatToolQueues.get(chatId) ?? createToolQueue();
    chatToolQueues.set(chatId, toolQueue);
    const limits = turnLimits.forModel(model.modelId);
    const liveTurn = liveTurns.begin(limits.timeoutMs);
    let started: { finished: Promise<void> };
    // Приём поправок открывается, когда ход уже в реестре: отказ реестра не трогает приём идущего хода.
    let steeringTurn: SteeringTurn<TurnRequestContext> | undefined;
    try {
      started = registry.start(chatId, answerId, (stopSignal) => {
        // «Стоп» человека — через реестр; срок хода и остановка службы — через свой сигнал хода.
        const abortSignal = AbortSignal.any([stopSignal, liveTurn.signal]);
        return runAgentTurn({
          storage,
          liveDemos: input.agent.liveDemos === true,
          hiddenStateKey,
          catalog: options.catalog,
          env,
          chatId,
          ownerId: chat.ownerId,
          messageId: answerId,
          parentId: launch.parentId,
          ...model,
          ...agentSettings,
          ...(instructions !== undefined && { instructions }),
          ...(staff && { staff }),
          toolResultLimit,
          toolTimeout,
          sequentialTools,
          toolQueue,
          stepContextTimeoutMs,
          contextBlocksTimeoutMs,
          modelSilence,
          ...(limits.maxOutputTokens !== undefined && { maxOutputTokens: limits.maxOutputTokens }),
          ...(providerFallback !== undefined && { providerFallback }),
          ...(cacheMissWatch && { cacheMissWatch }),
          ...(options.turnObserver && { turnObserver: options.turnObserver }),
          ...(options.limits && { assertWithinLimit: () => assertWithinSpendingLimit(chat.ownerId, chatId) }),
          modeNotes,
          place,
          // Ответ на паузе без места в странице: место заметки продолжения прежнее (поправка без места тоже его не стирает).
          ...(launch.resume && !launch.replay && launch.page?.place === undefined && { samePlace: true }),
          ...(subject && { subject }),
          ...(chatData && { chatData }),
          // Состояние — по ветке хранилища, а не по сжатой истории; продолжаемый ответ уже последний в ветке.
          appState: foldAppState(branch),
          ...(channel !== "web" && { channel }),
          ...(group && { group }),
          ...(timeZone && { timeZone }),
          ...(turnRules && { turnRules }),
          // Браузерные инструменты — только вебу: у мессенджера нет вкладки.
          ...(browserToolDescriptions && channel === "web" && {
            browserTools: { descriptions: browserToolDescriptions, pending: pendingBrowserCalls, timeoutMs: browserToolTimeoutMs, tabId: launch.page?.tabId },
          }),
          ...(options.attachments && { attachments: options.attachments }),
          ...(options.memory && { memory: options.memory }),
          ...(widgets.waiting.size > 0 && { waitingWidgets: widgets.waiting }),
          ...(widgets.switchable.size > 0 && { switchableTools: widgets.switchable }),
          ...(launch.resume && resumeMessage && { resume: { message: resumeMessage, usage: launch.resume.usage, ...(launch.replay && { replay: true }), ...(launch.announced?.length && { announced: launch.announced }) } }),
          alwaysAllowedTools: alwaysAllowedTools(branch.map(toAgentChatMessage)),
          history: () => compaction.historyForAnswer({ chatId, branch, choice: model, abortSignal, answerId }),
          // Переполнение: сжимается ветка до вопроса — продолжаемый ответ (подтверждение, сосед после «Повторить») в план
          // не входит, ход сам ставит его после сжатой истории.
          compactForOverflow: ({ providerId, abortSignal: signal }) =>
            compaction.compactForOverflow({
              chatId,
              branch: launch.resume ? branch.slice(0, -1) : branch,
              choice: { modelId: model.modelId, providerId },
              abortSignal: signal,
              answerId,
            }),
          compactAnswerSteps: ({ history, steps, providerId, abortSignal: signal }) =>
            compaction.compactAnswerSteps({ chatId, history, steps, choice: { modelId: model.modelId, providerId }, abortSignal: signal, answerId }),
          ...(afterTurn && {
            afterTurn: (finished, stopWaiting) =>
              afterTurn.afterTurn(
                {
                  ...finished,
                  ...(finished.status === "stopped" && { stopReason: turnStopReasonOf(abortSignal) }),
                  ownerId: chat.ownerId,
                  chatId,
                  messageId: answerId,
                  modelId: model.modelId,
                  trigger: launch.action,
                  channel,
                  ...(subject && { subject }),
                  ...(chatData && { chatData }),
                  ...(staff && { staff }),
                },
                // Записанный ответ, не остановленный ходом, срок не обрывает: даже если срок вышел между записью итога и хуком.
                finished.status === "stopped" ? stopWaiting : AbortSignal.any([stopSignal, liveTurn.shutdown]),
              ),
          }),
          onFinished: ({ status, messageId, answeredProviderId }) => {
            resumeBases.delete(chatId);
            finalStatus = status;
            // Поправки человека: ход продолжается новым ответом на них. Перехват другой копией и остановка службы — нет.
            if (steeringTurn && steeringTurn.close() > 0 && status !== "interrupted" && !closing) {
              handOffCorrections(chat, steeringTurn, launch.page, () => started.finished);
            }
            if (options.onTurnFinished) {
              const turn = { userId: chat.ownerId, chatId, messageId, status, modelId: model.modelId, providerId: answeredProviderId };
              notifyTurnFinished(options.onTurnFinished, turn, logError);
            }
            // Расход хода уже в журнале: лимиты сверяют пороги. Ход их не ждёт.
            if (options.limits?.afterSpending) {
              const report = (failure: unknown) => logError(`Лимиты после расхода (чат ${chatId}): ${failure instanceof Error ? failure.message : String(failure)}`);
              try {
                options.limits.afterSpending({ userId: chat.ownerId, chatId }).catch(report);
              } catch (failure) {
                report(failure);
              }
            }
            if (status !== "complete") return;
            // Память — к ответившему провайдеру: основной, с которого ушли на запасной, скорее всего ещё лежит.
            // В группе памяти владельца нет: разговор группы в неё не идёт.
            if (!group) memoryAfterAnswer.run({ ownerId: chat.ownerId, chatId, modelId: model.modelId, providerId: answeredProviderId, answerId: messageId });
            return compaction.afterAnswer({ chatId, answerId: messageId });
          },
          abortSignal,
          onAnswerWritten: liveTurn.answerWritten,
          newAttemptAllowed: liveTurn.newAttemptAllowed,
          correctionsWaiting: () => steeringTurn?.waiting() === true,
          // Закрытие из инструмента — запись `$closed` в ответе; здесь только копия для списка и событие.
          closeChat: (closure: ChatClosure) => writeClosureCopy(chat.ownerId, chatId, closure),
          ...(storage.setChatClosed && { recordChatClosure: (closure: ChatClosure) => storage.setChatClosed!(chatId, closure) }),
          isChatClosed: async () => {
            const current = await storage.getChat(chatId);
            return Boolean(current && (await closureOf(current)));
          },
          createdAt: launch.createdAt,
          logError,
          flushers,
        });
      });
    } catch (error) {
      liveTurn.end();
      throw error;
    }
    const { finished } = started;
    steeringTurn = steering.begin(chatId, answerId);
    if (stopsWhileStarting.delete(chatId)) registry.abort(chatId);
    const turnEvent = { ownerId: chat.ownerId, chatId, messageId: answerId, trigger, channel };
    chatEvents.emit({ type: "turn-started", ...turnEvent });
    // Ход пошёл: его место освобождается, когда ход закончится, а не когда закончится запуск.
    liveAnswerIds.add(answerId);
    const slot = startingSlots.get(chatId);
    startingSlots.delete(chatId);
    void finished.then(() => {
      steeringTurn?.close();
      liveTurn.end();
      // Очередь чата уходит, когда в ней никого: и вызовов хода, не слушающих отмену, и вызовов следующего хода.
      void toolQueue.whenIdle().then(() => {
        if (chatToolQueues.get(chatId) === toolQueue && toolQueue.idle()) chatToolQueues.delete(chatId);
      });
      liveAnswerIds.delete(answerId);
      slot?.release();
      chatEvents.emit({ type: "turn-finished", ...turnEvent, status: finalStatus });
      afterTurnTask(() => branchChanged(chat.ownerId, chatId, STATE_CHANGE_REASON[launch.action] ?? "turn", stateBefore));
      writePendingClosure(chatId);
    });
    return launch.detached ? null : registry.subscribe(chatId);
  }

  /** Приём поправки: записанная раньше (повтор) — тот же итог; ход идёт — в очередь; хода нет — обычное сообщение и ход. */
  async function acceptingSteer(
    userId: string,
    chat: Chat,
    message: IncomingUserMessage,
    text: string,
    files: IncomingFilePart[],
    steerOptions: { page?: TurnRequestContext } | undefined,
  ): Promise<SteerResult> {
    const chatId = chat.id;
    const saved = await storage.getMessage(message.id);
    if (saved?.chatId === chatId && saved.role === "user") {
      if (isCorrection(saved)) return { status: "queued", messageId: saved.id };
      // Начала ход сама: он идёт или уже ответил. Записана, а ход не начался, — приём доводит `sendingTurn`, как у повтора отправки.
      if (registry.isRunning(chatId) || (await currentBranch(chatId)).at(-1)?.id !== saved.id) return { status: "started", messageId: saved.id };
    }
    const input: TurnGateInput = { userId, chat, action: "send", text, messageId: message.id };
    const sendOptions: SendMessageOptions = { ...(steerOptions?.page && { page: steerOptions.page }) };
    return admitting(chatId, () =>
      turnGate.admit(input, async (): Promise<SteerResult> => {
        await assertWithinSpendingLimit(userId, chatId);
        for (let attempt = 0; attempt < STEER_ATTEMPTS; attempt++) {
          if (steering.isOpen(chatId)) {
            const queued = await queueCorrection(userId, chatId, message, text, files, steerOptions?.page);
            if (queued) return { status: "queued", messageId: queued.id };
            continue;
          }
          // Ход запускается, передаётся новому ответу или дописывает конец: поправка ждёт и пробует снова.
          const busy = handOffs.get(chatId) ?? startingByChat.get(chatId) ?? (registry.isRunning(chatId) ? registry.finished(chatId) : undefined);
          if (busy) {
            await busy.catch(() => {});
            continue;
          }
          await assertNoAnswerElsewhere(chatId);
          // Хода нет: поправка — обычное сообщение и новый ход; поток не нужен, вкладка подключится сама.
          const stream = await checkedStart(input, () => sendingTurn(userId, chatId, message, text, files, sendOptions));
          void stream.cancel().catch(() => {});
          return { status: "started", messageId: message.id };
        }
        throw new ChatBusyError(chatId);
      }),
    );
  }

  /** Сообщение человека и ход на него; зовётся под замком чата (`checkedStart`). */
  async function sendingTurn(
    userId: string,
    chatId: string,
    message: IncomingUserMessage,
    text: string,
    files: IncomingFilePart[],
    sendOptions: SendMessageOptions | undefined,
  ): Promise<ReadableStream<UIMessageChunk>> {
    takeTurnSlot(userId, chatId);
    const branch = await currentBranch(chatId);
    // Повтор того же сообщения: в прошлый раз оно сохранилось, а приём оборвался до ответа (сбой базы при закрытии
    // запроса подтверждения). Приём доводится до конца с сохранённым сообщением, второй копии нет.
    const repeated = branch.at(-1);
    if (repeated?.id === message.id && repeated.role === "user") {
      const before = branch.slice(0, -1);
      await closeUnansweredHumanInput(before);
      return startAnswer("send", userId, chatId, [...before, repeated], sendOptions?.page);
    }
    const question = await writingCountedMessage(userId, chatId, async () => {
      // Файлы принимаются, когда чат и место уже за ходом: при отказе по месту или занятости они не остаются ничьими.
      const fileParts = await acceptFiles(userId, chatId, files);
      const question = newStoredMessage({
        id: message.id,
        chatId,
        parentId: branch.at(-1)?.id ?? null,
        role: "user",
        parts: [
          ...fileParts,
          ...(text.trim().length > 0 ? [{ type: "text" as const, text }] : []),
          ...(sendOptions?.voiceMode === true ? [voiceModePart(await currentVoice(userId), undefined, uniqueVoiceSounds(sendOptions.voiceSounds ?? []))] : []),
          ...[channelPart(sendOptions?.channel ?? "web", sendOptions?.group)].filter((part) => part !== undefined),
        ],
      });
      await confirmFiles(question.id, fileParts);
      await storage.insertMessage(question);
      return question;
    });
    // Запрос подтверждения закрывается, только когда новое сообщение принято: при отказе вставки он ждёт дальше.
    await closeUnansweredHumanInput(branch);
    // Название по первому сообщению ставится до ответа; заданное человеком не трогаем.
    const chat = await storage.getChat(chatId);
    const title = chat && chat.title === undefined ? deriveChatTitle(text) : null;
    if (title) await storage.renameChat(chatId, title);
    return startAnswer("send", userId, chatId, [...branch, question], sendOptions?.page);
  }

  /**
   * Поправка к идущему ходу этой копии: место в окне сообщений, файлы, запись сообщения с отметкой поправки. Приём хода
   * закрылся, пока поправка ждала очереди, — `null`: место отдано назад, ничего не записано.
   */
  async function queueCorrection(
    userId: string,
    chatId: string,
    message: IncomingUserMessage,
    text: string,
    files: IncomingFilePart[],
    page: TurnRequestContext | undefined,
  ): Promise<StoredMessage | null> {
    try {
      return await writingCountedMessage(userId, chatId, async () => {
        const queued = await steering.accept(chatId, async (parentId) => {
          const fileParts = await acceptFiles(userId, chatId, files);
          const correction = newStoredMessage({
            id: message.id,
            chatId,
            parentId,
            role: "user",
            parts: [...fileParts, ...(text.trim().length > 0 ? [{ type: "text" as const, text }] : []), steerPart()],
          });
          await confirmFiles(correction.id, fileParts);
          await storage.insertMessage(correction);
          return correction;
        }, page);
        if (!queued) throw new SteeringClosed();
        return queued;
      });
    } catch (error) {
      if (error instanceof SteeringClosed) return null;
      throw error;
    }
  }

  /**
   * Ответ идёт на другой копии сервера (знак жизни свежий) — чат занят: поправка туда не дойдёт. Брошенный упавшей копией
   * ответ прерывается сразу, и поправка идёт обычным сообщением.
   */
  async function assertNoAnswerElsewhere(chatId: string): Promise<void> {
    if (!isDetachedAnswer(answerBeforeCorrections(await currentBranch(chatId)), registry.runningMessageId(chatId))) return;
    if (storage.listSilentAnswerIds && (await recoverStaleAnswers({ chatId })) > 0) return;
    throw new ChatBusyError(chatId);
  }

  /**
   * Ответ кончился, а человек дописал поправки: ход сразу продолжается новым ответом на последнюю из них. Чат занят без
   * окна (`holdingChat` с этого мига), `subscribe` ждёт новый ход. Ждущий подтверждения ответ закрывается отказом, как
   * при новом сообщении, даже если ход не начнётся. Чат закрыт, лимит исчерпан, мест нет — поправки остаются без ответа, приложение узнаёт причину.
   */
  function handOffCorrections(chat: Chat, turn: SteeringTurn<TurnRequestContext>, page: TurnRequestContext | undefined, answerFinished: () => Promise<void>): void {
    const chatId = chat.id;
    const ownerId = chat.ownerId;
    const handOff = holdingChat(chatId, async () => {
      await answerFinished();
      const corrections = await turn.settled();
      const last = corrections.at(-1);
      if (!last || closing) return;
      const notStarted = async (reason: TurnNotStartedReason) => {
        for (const correction of corrections) {
          await turnGate.notStarted({ userId: ownerId, chat, action: "send", messageId: correction.id, text: plainTextOf(correction) }, reason);
        }
      };
      const current = await storage.getChat(chatId);
      if (!current) return notStarted("chat_closed");
      const branch = await currentBranch(chatId);
      const first = branch.findIndex((message) => message.id === corrections[0]!.id);
      if (first < 0 || branch.at(-1)?.id !== last.id) return notStarted("error");
      const before = branch.slice(0, first);
      // Последним в ветке теперь сообщение человека: на ждущий запрос ответить уже нельзя. Закрывается отказом, даже если ход не начнётся.
      await closeUnansweredHumanInput(before);
      if (pendingClosures.get(chatId) || (await closureOf(current))) return notStarted("chat_closed");
      if (!(await withinSpendingLimit(ownerId, chatId))) return notStarted("spending_limit");
      try {
        takeTurnSlot(ownerId, chatId);
      } catch (error) {
        if (error instanceof TooManyTurnsError) return notStarted("too_many_turns");
        throw error;
      }
      // Место и заметки страницы — из запроса последней поправки: они свежее, чем в начале хода. Ложатся в хвост поправки,
      // начало запроса и кэш модели прежние.
      await launchTurn(ownerId, chatId, [...before, ...branch.slice(first)], { parentId: last.id, page: continuationRequestContext(page, turn.correctionPages()), action: "send", detached: true });
    })
      .catch((failure: unknown) => logError(`Ход по поправкам чата ${chatId} не начался: ${failure instanceof Error ? failure.message : String(failure)}`))
      .finally(() => {
        if (handOffs.get(chatId) === handOff) handOffs.delete(chatId);
      });
    handOffs.set(chatId, handOff);
  }

  /** Склеенная фраза стала первым сообщением вместо прежней: название, выведенное из прежней, обновляется; своё название человека не трогаем. */
  async function refreshDerivedTitle(chatId: string, replaced: StoredMessage, newText: string): Promise<void> {
    const chat = await storage.getChat(chatId);
    const previousText = replaced.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    const derived = deriveChatTitle(previousText);
    const next = deriveChatTitle(newText);
    if (chat && next && derived !== null && chat.title === derived) await storage.renameChat(chatId, next);
  }

  const subjectChats = createSubjectChats({
    storage,
    ...(options.attachments && { attachments: options.attachments }),
    choiceForNewChat,
    validateModelChoice: (choice) => {
      const checked = validateModelChoice(options.catalog, env, choice, { allowHidden: true });
      return isHiddenChoice(options.catalog, checked) ? null : checked;
    },
    logError,
    wakeAgent: (ownerId, chatId, instruction) =>
      service.deliverNotices({
        ownerId,
        chatId,
        notices: [{ kind: "conversation_started", title: instruction }],
        wakeAgent: true,
        deliveryKey: `conversation_started:greeting:${chatId}`,
      }),
  });

  const service: ChatService = {
    liveDemos: input.agent.liveDemos === true,
    async createChat(userId, createOptions) {
      if (createOptions?.data !== undefined) {
        assertChatData(createOptions.data);
        // Хранилище без данных чата молча их потеряло бы: отказ до создания чата.
        if (!storage.updateChatData) throw new Error("Данные чата требуют хранилища с updateChatData: хранилище приложения его не умеет.");
      }
      await assertMayCreateChat(userId, createOptions?.origin);
      return subjectChats.createChat(
        {
          id: crypto.randomUUID(),
          ownerId: userId,
          ...(await choiceForNewChat(userId)),
          ...(createOptions?.origin && { origin: createOptions.origin }),
          ...(createOptions?.data !== undefined && { data: createOptions.data }),
        },
        createOptions?.greeting,
      );
    },

    openSubjectChat: subjectChats.openSubjectChat,

    importChat: subjectChats.importChat,

    async deliverNotices(request) {
      const { ownerId, chatId } = request;
      const gone: DeliverNoticesResult = { status: "chat_gone", turnStarted: false };
      const busy: DeliverNoticesResult = { status: "busy", turnStarted: false };
      const chat = await storage.getChat(chatId);
      if (!chat || chat.ownerId !== ownerId || deleting.has(chatId)) return gone;
      // Занятый чат или остановка службы: ничего не пишем, фон повторит доставку по `turn-finished` или после запуска.
      if (closing || starting.has(chatId) || registry.isRunning(chatId)) return busy;
      try {
        return await holdingChat(chatId, async () => {
          let { messages, branch } = await loadTree(chatId);
          // Ход на другой копии сервера (ответ идёт и подаёт знак жизни) — чат тоже занят: фон повторит доставку по
          // таймеру. Ответ, брошенный упавшей копией дольше порога, прерывается сразу, как в `getHistory`.
          if (isDetachedAnswer(answerBeforeCorrections(branch), registry.runningMessageId(chatId)) && storage.listSilentAnswerIds) {
            if ((await recoverStaleAnswers({ chatId })) === 0) return busy;
            ({ messages, branch } = await loadTree(chatId));
          }
          // Ключ проверяется под замком чата: две доставки одного результата не запишут его дважды.
          const earlier = messages.find((message) => deliveryKeyOf(message) === request.deliveryKey);
          // Сообщение записано, а ход не начался (сбой запуска) и после него в ветке пусто: повтор будит агента.
          const unanswered = earlier && request.wakeAgent && branch.at(-1)?.id === earlier.id ? earlier : undefined;
          if (earlier && !unanswered) return { status: "delivered" as const, messageId: earlier.id, turnStarted: false };
          if (unanswered) branch = branch.slice(0, -1);
          const writeNotice = async (wake: boolean): Promise<DeliverNoticesResult> => {
            // Место хода — до записи: нет места — `busy`, ничего не записано.
            if (wake) takeTurnSlot(ownerId, chatId);
            const notice =
              unanswered ??
              newStoredMessage({
                id: crypto.randomUUID(),
                chatId,
                parentId: branch.at(-1)?.id ?? null,
                role: "user",
                parts: noticeMessageParts(request),
              });
            if (!unanswered) {
              await storage.insertMessage(notice);
              await closeUnansweredHumanInput(branch);
            }
            if (!wake) {
              if (!unanswered) chatEvents.emit({ type: "notice-added", ownerId, chatId, messageId: notice.id });
              return { status: "delivered" as const, messageId: notice.id, turnStarted: false };
            }
            await launchTurn(ownerId, chatId, [...branch, notice], { parentId: notice.id, action: "notice", detached: true });
            return { status: "delivered" as const, messageId: notice.id, turnStarted: true };
          };
          const gateInput: TurnGateInput = { userId: ownerId, chat, action: "notice" };
          // Закрытый чат ходов не ведёт: сообщение пишется без хода. Закрытие перечитывается под замком.
          const closedNow = async () => {
            const current = await storage.getChat(chatId);
            return Boolean(current && (await closureOf(current)));
          };
          const wanted = request.wakeAgent && serverTurnsInRow(branch) < MAX_SERVER_TURNS_IN_ROW && !(await closedNow());
          if (!wanted) return writeNotice(false);
          // Отказ `beforeTurn` — сообщение без хода. Пропуск закрывается ходом или `turnNotStarted`: лимит исчерпан или
          // чат закрыли, пока шла проверка, — сообщение пишется без хода.
          let skipped: TurnNotStartedReason | undefined;
          return turnGate.admitOrSkip(
            gateInput,
            async () => {
              if (await closedNow()) skipped = "chat_closed";
              else if (!(await withinSpendingLimit(ownerId, chatId))) skipped = "spending_limit";
              return writeNotice(skipped === undefined);
            },
            () => writeNotice(false),
            () => skipped,
          );
        });
      } catch (error) {
        if (error instanceof TooManyTurnsError) return busy;
        if (error instanceof ChatNotFoundError) return gone;
        throw error;
      }
    },

    subscribeEvents(listener) {
      return chatEvents.subscribe(listener);
    },

    async updateChatData(userId, chatId, patch) {
      assertChatDataPatch(patch);
      if (!storage.updateChatData) throw new Error("Данные чата требуют хранилища с updateChatData: хранилище приложения его не умеет.");
      await ownChat(userId, chatId);
      const updated = await storage.updateChatData(chatId, patch, { maxBytes: CHAT_DATA_MAX_BYTES });
      if (!updated) throw new ChatNotFoundError(chatId);
      chatEvents.emit({ type: "chat-data-changed", ownerId: updated.ownerId, chatId });
      return structuredClone(chatDataOfInput(updated) ?? {});
    },

    async getChatData(userId, chatId) {
      const chat = await ownChat(userId, chatId);
      return structuredClone(chatDataOfInput(chat) ?? {});
    },

    async listChats(userId, listOptions) {
      if (listOptions?.data !== undefined) {
        assertChatDataFilter(listOptions.data);
        if (!storage.updateChatData) throw new Error("Фильтр по данным чата требует хранилища с updateChatData: хранилище приложения его не умеет.");
      }
      const chats = await storage.listChats(userId, {
        ...(listOptions?.subjects && { subjects: listOptions.subjects }),
        ...(listOptions?.data !== undefined && { data: listOptions.data }),
      });
      return chats.map((chat) => ({
        id: chat.id,
        title: chat.title ?? null,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        ...(chat.origin && { origin: chat.origin }),
        ...(chat.subjectKey !== undefined && { subjectKey: chat.subjectKey }),
        ...(chat.closed && { closed: chat.closed }),
      }));
    },

    async renameChat(userId, chatId, title) {
      await assertChatRules(userId, await ownChat(userId, chatId), { capabilities: ["chatList"] });
      const normalized = normalizeChatTitle(title);
      await storage.renameChat(chatId, normalized);
      return normalized;
    },

    async deleteChat(userId, chatId, actionOptions) {
      const chat = await ownChat(userId, chatId);
      if (actionOptions?.by !== "app") await assertChatRules(userId, chat, { capabilities: ["chatList"] });
      if (starting.has(chatId)) throw new ChatBusyError(chatId);
      deleting.add(chatId);
      await holdingChat(chatId, async () => {
        // Идущий ответ останавливаем и ждём, пока он допишется: после удаления в хранилище не должно появиться записей.
        registry.abort(chatId);
        await registry.finished(chatId);
        await compaction.cancel(chatId);
        // Файлы — первыми: не удалились — чат цел, и удаление можно повторить; остаться файлам без чата нельзя.
        await options.attachments?.removeChatFiles?.(chatId);
        await storage.deleteChat(chatId);
      }).finally(() => deleting.delete(chatId));
      // Задачи фона удалённого чата отменяются; сбой фона удаление не отменяет — чата уже нет.
      await options.background?.chatDeleted(userId, chatId).catch((error: unknown) => logError(`Фон: не удалось убрать задачи удалённого чата ${chatId}: ${String(error)}`));
      await options.limits?.chatDeleted?.({ userId, chatId }).catch((error: unknown) => logError(`Лимиты: не удалось стереть окна удалённого чата ${chatId}: ${String(error)}`));
    },

    async getModelMenu(userId) {
      if (userId !== undefined && options.modelMenu && !(await options.modelMenu({ userId }))) throw new ActionForbiddenError("modelDetails");
      return buildModelMenu(options.catalog, env, defaultChoice);
    },

    async setModel(userId, chatId, choice, actionOptions) {
      const chat = await ownChat(userId, chatId);
      const byPerson = actionOptions?.by !== "app";
      if (byPerson) await assertChatRules(userId, chat, { capabilities: ["modelChoice"] });
      const model = validateModelChoice(options.catalog, env, choice);
      await storage.updateChatModel(chatId, model);
      if (!byPerson) return model;
      await rememberChoice(userId, model);
      await reportModelChosen(userId, chatId, model);
      return model;
    },

    async assertOwnChat(userId, chatId) {
      await ownChat(userId, chatId);
      if (deleting.has(chatId)) throw new ChatBusyError(chatId);
    },

    async assertTurnAllowed(userId, chatId, action, text) {
      const chat = await ownChat(userId, chatId);
      await assertChatRules(userId, chat, { capabilities: [TURN_ACTION_CAPABILITY[action] ?? false], open: OPEN_CHAT_ACTIONS.has(action) });
      await turnGate.admit({ userId, chat, action, ...(text !== undefined && { text }) }, async () => undefined, () => "no_turn" as const);
    },

    async getSpendingStatus(userId, chatId) {
      await ownChat(userId, chatId);
      return options.limits ? options.limits.status({ userId, chatId }) : { state: "ok" };
    },

    getHistory: (userId, chatId) => historyOf(userId, chatId, { write: true }),
    peekHistory: (userId, chatId) => historyOf(userId, chatId, { write: false }),

    async getChatState(userId, chatId) {
      await ownChat(userId, chatId);
      // Только связи сообщений и записи состояния: тексты и выводы инструментов не читаются.
      const { values, atMessageId } = await readBranchState(storage, chatId);
      return { values: publicAppState(values), atMessageId };
    },
    async getBranchForks(userId, chatId) {
      await ownChat(userId, chatId);
      const runningId = registry.runningMessageId(chatId);
      const { messages, branch } = await loadTree(chatId);
      return { forks: branchForks(messages, branch).filter((fork) => fork.messageId !== runningId) };
    },

    async selectBranch(userId, chatId, messageId) {
      const scope: RequestScope = {};
      const chat = await ownChat(userId, chatId);
      await assertChatRules(userId, chat, { capabilities: ["branches"] }, scope);
      const before = await whileStarting(chatId, async () => {
        await carryLegacyClosure(chatId);
        const { messages, selections, branch } = await loadTree(chatId);
        const target = messages.find((message) => message.id === messageId);
        if (!target || !branch.some((message) => message.parentId === target.parentId)) {
          throw new InvalidMessageError("Это сообщение не на развилке текущей ветки");
        }
        if (currentChildOf(messages, selections, target.parentId)?.id === target.id) return undefined;
        await storage.insertBranchSelection({
          id: crypto.randomUUID(),
          chatId,
          messageId,
          selectedAt: nextSiblingTime(messages, selections, target.parentId),
        });
        return foldAppState(branch);
      });
      if (before) await branchChanged(chat.ownerId, chatId, "selectBranch", before);
      return historyOf(userId, chatId, { write: true, scope });
    },

    async getCompactions(userId, chatId) {
      const chat = await ownChat(userId, chatId);
      const compacting = compaction.isCompacting(chatId);
      // Только связи сообщений: ветка не требует ни текстов, ни выводов инструментов.
      const branch = await loadCurrentBranchLinks(storage, chatId);
      // Как в истории: при `modelDetails: false` — без текста сводки.
      const visibility = await visibilityFor(userId, chat);
      return { compactions: visibility.visibleCompactions(await compaction.markers(chatId, branch)), compacting };
    },

    async compactNow(userId, chatId) {
      const chat = await ownChat(userId, chatId);
      await assertChatRules(userId, chat, { capabilities: ["compact"] });
      if (deleting.has(chatId)) throw new ChatBusyError(chatId);
      return compaction.compactNow(chatId, effectiveChoiceOfChat(options.catalog, env, chat, defaultChoice));
    },

    async sendMessage(userId, chatId, message, sendOptions) {
      const chat = await ownChat(userId, chatId);
      const { text, files } = validateUserMessage(message, Boolean(options.attachments));
      const scope: RequestScope = {};
      await assertChatRules(userId, chat, { capabilities: messageCapabilities(files, sendOptions?.voiceMode), open: true }, scope);
      return viewerStream(userId, chat, scope, () =>
        startingTurn({ userId, chat, action: "send", text, messageId: message.id }, () => sendingTurn(userId, chatId, message, text, files, sendOptions)),
      );
    },

    async steer(userId, chatId, message, steerOptions) {
      const chat = await ownChat(userId, chatId);
      const { text, files } = validateUserMessage(message, Boolean(options.attachments));
      await assertChatRules(userId, chat, { capabilities: ["steer", ...messageCapabilities(files, false)], open: true });
      // Повтор той же поправки (клиент не дождался ответа): идущий приём отдаёт свой итог, записанная — тот же итог без копии.
      const key = `${chatId}/${message.id}`;
      const inFlight = steersInFlight.get(key);
      if (inFlight) return inFlight;
      const accepting = acceptingSteer(userId, chat, message, text, files, steerOptions).finally(() => steersInFlight.delete(key));
      steersInFlight.set(key, accepting);
      return accepting;
    },

    async regenerate(userId, chatId, messageId, page) {
      const chat = await ownChat(userId, chatId);
      const scope: RequestScope = {};
      await assertChatRules(userId, chat, { capabilities: ["regenerate"] }, scope);
      const abandoned = await abandonedForHooks(chatId, (branch) => abandonedAnswersOf(branch, "regenerate", messageId));
      return viewerStream(userId, chat, scope, () => startingTurn({ userId, chat, action: "regenerate", ...abandoned }, async () => {
        takeTurnSlot(userId, chatId);
        const { messages, selections, branch } = await loadTree(chatId);
        const index = branch.findIndex((message) => message.id === messageId);
        const answer = branch[index];
        if (!answer || answer.role !== "assistant") throw new InvalidMessageError("Переделать можно ответ агента на текущей ветке");
        // Перед ответом нужно сообщение человека: у приветствия (текстом или по указанию) его нет, служебные сообщения
        // и записи состояния — не вопрос.
        if (!branch.slice(0, index).some(isHumanMessage)) {
          throw new InvalidMessageError("Переделать можно только ответ на сообщение человека: у приветствия его нет");
        }
        return startAnswer("regenerate", userId, chatId, branch.slice(0, index), page, nextSiblingTime(messages, selections, answer.parentId), foldAppState(branch));
      }));
    },

    async editMessage(userId, chatId, editedMessageId, message, editOptions) {
      const chat = await ownChat(userId, chatId);
      const { text, files } = validateUserMessage(message, Boolean(options.attachments));
      const scope: RequestScope = {};
      await assertChatRules(userId, chat, { capabilities: ["edit", ...messageCapabilities(files, editOptions?.voiceMode)] }, scope);
      const abandoned = await abandonedForHooks(chatId, (branch) => abandonedAnswersOf(branch, "edit", editedMessageId));
      return viewerStream(userId, chat, scope, () => startingTurn({ userId, chat, action: "edit", text, messageId: message.id, ...abandoned }, async () => {
        takeTurnSlot(userId, chatId);
        const { branch, index, edited, question } = await writingCountedMessage(userId, chatId, async () => {
          // Файлы правленого сообщения приходят вместе с текстом и проходят ту же проверку, что и при отправке.
          const fileParts = await acceptFiles(userId, chatId, files);
          const { messages, selections, branch } = await loadTree(chatId);
          const index = branch.findIndex((candidate) => candidate.id === editedMessageId);
          const edited = branch[index];
          if (!edited || edited.role !== "user" || isStateMessage(edited)) throw new InvalidMessageError("Править можно вопрос собеседника на текущей ветке");
          const question = newStoredMessage({
            id: message.id,
            chatId,
            parentId: edited.parentId,
            role: "user",
            parts: [
              ...fileParts,
              ...(text.trim().length > 0 ? [{ type: "text" as const, text }] : []),
              ...(editOptions?.voiceMode === true
                ? [
                    voiceModePart(
                      await currentVoice(userId),
                      isVoiceMessage(edited) ? edited.id : undefined,
                      // Склейка: звуки прежней фразы остаются, новые дописываются.
                      uniqueVoiceSounds([...soundsOfMessage(edited), ...(editOptions.voiceSounds ?? [])]),
                    ),
                  ]
                : []),
            ],
            createdAt: nextSiblingTime(messages, selections, edited.parentId),
          });
          await confirmFiles(question.id, fileParts);
          await storage.insertMessage(question);
          return { branch, index, edited, question };
        });
        // Правка — тоже сообщение вместо ответа: ждущий ответ ветки закрывается, как при отправке (FR-006).
        await closeUnansweredHumanInput(branch);
        if (editOptions?.voiceMode === true && branch.slice(0, index).every(isStateMessage)) await refreshDerivedTitle(chatId, edited, text);
        return startAnswer("edit", userId, chatId, [...branch.slice(0, index), question], editOptions?.page, notBefore(question.createdAt), foldAppState(branch));
      }));
    },

    async editAnswer(userId, chatId, messageId, edit) {
      let chat: Chat;
      try {
        chat = await ownChat(userId, chatId);
      } catch (error) {
        if (error instanceof ChatNotFoundError) throw new AnswerEditError("chat_not_found");
        throw error;
      }
      await assertChatRules(userId, chat, { capabilities: ["answerEditing"] });
      if (starting.has(chatId) || registry.isRunning(chatId)) throw new AnswerEditError("answer_busy");
      let before: AppStateValues = {};
      const replaced = await holdingChat(chatId, async () => {
        await carryLegacyClosure(chatId);
        const { messages, selections, branch } = await loadTree(chatId);
        const answer = messages.find((message) => message.id === messageId);
        if (!answer) throw new AnswerEditError("message_not_found");
        if (answer.role !== "assistant") throw new AnswerEditError("not_an_answer");
        if (!branch.some((message) => message.id === messageId)) throw new AnswerEditError("not_on_current_branch");
        if (answer.status !== "complete") throw new AnswerEditError("answer_busy");
        before = foldAppState(branch);
        const edited = editAnswerParts(answer.parts, edit, uneditableTools);
        if (!edited.ok) throw new AnswerEditError(edited.kind);
        const createdAt = nextSiblingTime(messages, selections, answer.parentId);
        const replacement = newStoredMessage({
          id: crypto.randomUUID(),
          chatId,
          parentId: answer.parentId,
          role: "assistant",
          parts: edited.parts,
          modelId: answer.modelId,
          providerId: answer.providerId,
          createdAt,
        });
        await storage.insertMessage(replacement);
        await storage.insertBranchSelection({ id: crypto.randomUUID(), chatId, messageId: replacement.id, selectedAt: createdAt });
        return replacement;
      });
      await branchChanged(chat.ownerId, chatId, "editAnswer", before);
      return replaced;
    },

    async retry(userId, chatId, page) {
      const chat = await ownChat(userId, chatId);
      const scope: RequestScope = {};
      await assertChatRules(userId, chat, { capabilities: ["retry"], open: true }, scope);
      const abandoned = await abandonedForHooks(chatId, abandonedOnRetry);
      return viewerStream(userId, chat, scope, () => startingTurn({ userId, chat, action: "retry", ...abandoned }, async () => {
        takeTurnSlot(userId, chatId);
        const tree = await loadTree(chatId);
        const { messages, selections } = tree;
        // Служебные сообщения состояния в конце ветки — не вопрос и не ответ: «Повторить» смотрит на то, что до них.
        let end = tree.branch.length;
        while (end > 0 && isStateMessage(tree.branch[end - 1]!)) end--;
        const branch = tree.branch.slice(0, end);
        const last = branch.at(-1);
        if (last?.role === "user") {
          // Вопрос без ответа: запрос подтверждения перед ним мог остаться незакрытым, если приём вопроса оборвался.
          const before = branch.slice(0, -1);
          await closeUnansweredHumanInput(before);
          return startAnswer("retry", userId, chatId, [...before, ...tree.branch.slice(end - 1)], page);
        }
        if (!last || !isRetryableAnswer(last) || branch.at(-2)?.role !== "user") {
          throw new NothingToRetryError(chatId);
        }
        const stateBefore = foldAppState(tree.branch);
        // Оборванный ход с выполненными вызовами продолжается с них: инструменты не вызываются второй раз.
        if (last.status !== "complete") {
          const continued = await continueAnswer(userId, chatId, { messages, selections, branch }, page, stateBefore);
          if (continued) return continued;
        }
        // Новый ответ — сосед прежнего и становится текущим, что бы человек ни выбирал до этого.
        return startAnswer("retry", userId, chatId, branch.slice(0, -1), page, nextSiblingTime(messages, selections, last.parentId), stateBefore);
      }));
    },

    async answerApproval(userId, chatId, approvalId, answer, page) {
      const chat = await ownChat(userId, chatId);
      await assertChatRules(userId, chat, { open: true });
      return startingTurn({ userId, chat, action: "approval" }, async () => {
        const branch = await currentBranch(chatId);
        const waiting = branch.at(-1);
        if (waiting?.status !== "awaiting_approval") throw new ApprovalNotPendingError(approvalId);
        let resuming: StoredMessage;
        try {
          resuming = await writeToWaiting(waiting, (current) => {
            const asked = pendingPartOf(current.parts, approvalId);
            if (!asked) throw new ApprovalNotPendingError(approvalId);
            // «Всегда» есть только у инструментов с простым флагом; для остальных ответ считается обычным «Разрешить».
            const parts = recordDecision(current.parts, approvalId, decisionOf(answer === "always" && !offersAlways(asked) ? "allow" : answer));
            if (!parts) throw new ApprovalNotPendingError(approvalId);
            return resumingPatch(userId, chatId, parts);
          });
        } catch (error) {
          if (error instanceof MessageNotAwaitingError) throw new ApprovalNotPendingError(approvalId);
          throw error;
        }
        if (resuming.status !== "streaming") return { resumed: false };
        const { parts } = resuming;
        try {
          await launchTurn(userId, chatId, [...branch.slice(0, -1), resuming], {
            parentId: waiting.parentId ?? "",
            resume: resuming,
            page,
            action: "approval",
          });
        } catch (error) {
          resumeBases.delete(chatId);
          // Ход не начался, инструмент не выполнялся; но вызов с решением и без результата сломал бы историю чата.
          await storage.finishMessage(waiting.id, { status: "interrupted", parts: denyPendingApprovals(parts, INTERRUPTED_REASON) });
          throw error;
        }
        return { resumed: true };
      }, unlessResumed);
    },

    async answerWidget({ chatId, ownerId, toolCallId, answer, page }) {
      return loggingWidgetRefusal(chatId, toolCallId, async () => {
        const chat = await ownChat(ownerId, chatId);
        await assertChatRules(ownerId, chat, { open: true });
        return startingTurn({ userId: ownerId, chat, action: "widget" }, async () => {
          const branch = await currentBranch(chatId);
          const waiting = branch.at(-1);
          const call = waiting?.status === "awaiting_approval" ? pendingWidgetCall(waiting.parts, toolCallId, widgets.waiting) : undefined;
          if (!waiting || !call) throw new WidgetNotPendingError(toolCallId);
          const checked = await widgets.checkAnswer(call.toolName, call.input, answer);
          if (!checked.ok) throw new InvalidWidgetAnswerError(toolCallId);
          const byApp = await checkingWidgetAnswerByApp(
            { ownerId, chat, messageId: waiting.id, toolName: call.toolName, toolCallId, input: call.input },
            checked.output,
            branch,
          );
          // Чат могли закрыть, пока шла проверка: закрытие побеждает, ответ не пишется, ждущий виджет закрывается отказом.
          const fresh = await storage.getChat(chatId);
          const closed = fresh && (await closureOf(fresh));
          if (closed) {
            await denyingWaitingHumanInput(waiting);
            throw new ChatClosedError(closed);
          }
          // Ответ через другую копию на этот же виджет успел раньше — эта запись не проходит.
          // Записи состояния и события проверки ложатся после результата вызова.
          const announced = [...byApp.stateRecords.map(appStatePart), ...byApp.appEvents.map((event) => ({ type: APP_EVENT_PART_TYPE, data: event }) as StoredMessage["parts"][number])];
          let resuming: StoredMessage;
          try {
            resuming = await writeToWaiting(waiting, (current) => {
              if (!pendingWidgetCall(current.parts, toolCallId, widgets.waiting)) throw new WidgetNotPendingError(toolCallId);
              return resumingPatch(ownerId, chatId, [...recordWidgetAnswer(current.parts, toolCallId, byApp.output), ...announced]);
            });
          } catch (error) {
            if (error instanceof MessageNotAwaitingError) throw new WidgetNotPendingError(toolCallId);
            throw error;
          }
          if (byApp.stateRecords.length > 0) {
            stateChanged.notify({
              ownerId,
              chatId,
              reason: "widgetAnswer",
              before: foldAppState(branch),
              after: foldAppState([...branch.slice(0, -1), resuming]),
              atMessageId: resuming.id,
            });
          }
          if (resuming.status !== "streaming") {
            // Продолжения нет: события — вкладке через канал наблюдения, она перечитает ответ.
            for (const event of byApp.appEvents) chatEvents.emit({ type: "app-event", ownerId, chatId, messageId: resuming.id, event });
            return { resumed: false };
          }
          const { parts } = resuming;
          try {
            await launchTurn(ownerId, chatId, [...branch.slice(0, -1), resuming], { parentId: waiting.parentId ?? "", resume: resuming, page, action: "widget", announced });
          } catch (error) {
            resumeBases.delete(chatId);
            await storage.finishMessage(waiting.id, { status: "interrupted", parts: denyPendingApprovals(parts, INTERRUPTED_REASON) });
            throw error;
          }
          return { resumed: true };
        }, unlessResumed);
      });
    },

    async answerBrowserCall(userId, chatId, toolCallId, answer) {
      await ownChat(userId, chatId);
      pendingBrowserCalls.answer(chatId, toolCallId, answer);
    },

    async subscribe(userId, chatId) {
      const chat = await ownChat(userId, chatId);
      // Права — того, кто переподключается, и на этот миг: повтор прошлых кусков идёт через тот же фильтр.
      const visibility = await visibilityFor(userId, chat);
      // Ход передаётся новому ответу на поправки: поток — уже нового ответа.
      await handOffs.get(chatId);
      const stream = registry.subscribe(chatId);
      return stream && visibility.visibleChunks(stream);
    },

    async stop(userId, chatId) {
      await ownChat(userId, chatId);
      const check = widgetChecks.get(chatId);
      check?.abort();
      if (registry.abort(chatId) || check !== undefined) return true;
      // Ответ уже кончился, ход переходит к поправкам: «Стоп» был для прежнего ответа, новый ход по поправкам идёт.
      if (handOffs.has(chatId)) return true;
      // Ход ещё запускается (проверки до хода): остановка ждёт его в реестре и срабатывает сразу после старта.
      if (!starting.has(chatId) && !admittingTurns.has(chatId)) return false;
      stopsWhileStarting.add(chatId);
      return true;
    },

    async recoverInterruptedAnswers(recoverOptions) {
      // Хуки итога, ждущие с прошлого запуска, — до прерывания: прерванные сейчас получат свой хук сами.
      await afterTurn?.recoverPending(liveAnswerIds);
      // Задачи фона восстанавливаются вместе с ответами.
      const [count] = await Promise.all([recoverAnswersOnStart(recoverOptions?.soleServer === true), options.background?.recover()]);
      return count;
    },

    async closeChat({ ownerId, chatId, code, message }) {
      const closed = normalizeChatClosure({ code, message });
      await changeClosure(await ownChat(ownerId, chatId), closed);
    },

    async reopenChat({ ownerId, chatId }) {
      await changeClosure(await ownChat(ownerId, chatId), null);
    },

    async assertCapability(userId, chatId, capability) {
      await assertChatRules(userId, await ownChat(userId, chatId), { capabilities: [capability] });
    },

    async publishAppEvent({ ownerId, chatId, event }) {
      const checked = validateAppEvent(event);
      await ownChat(ownerId, chatId);
      chatEvents.emit({ type: "app-event", ownerId, chatId, event: checked });
    },

    async flush(flushOptions) {
      const waitForAnswersMs = resolveWaitForAnswersMs(flushOptions);
      const sweeping = staleSweep?.running;
      if (staleSweep) {
        staleSweep.stopped = true;
        clearTimeout(staleSweep.timer);
        // Следующий `recoverInterruptedAnswers` (сервер поднят снова) запустит проверку заново.
        staleSweep = null;
      }
      // Пока идёт остановка, новые ходы не начинаются — ни от человека, ни от фона.
      closing = true;
      try {
        // Идущая проверка брошенных ответов может закрыть ответ или позвать хук итога: её тоже ждём.
        await sweeping;
        // Запуски, начатые до остановки, доходят до реестра или срываются: их ходы тоже ждём.
        while (startingWork.size > 0) await Promise.allSettled([...startingWork]);
        // Остановленный ход сам пишет итог; не прошла конечная запись — ход помечает ответ брошенным.
        const unfinished = await liveTurns.drain(waitForAnswersMs);
        if (unfinished > 0) {
          // Ход, висящий до конечной записи, помечается брошенным: следующий старт прервёт его сразу. Висящий на самой
          // конечной записи пометит себя сам, когда повторы кончатся, — иначе его прервут по порогу.
          logError(
            `flush: ходы (${unfinished}) не закончили запись за ${STOPPED_TURNS_WAIT_MS / 1000} с после остановки — их ответы прервёт восстановление при следующем старте`,
          );
          await Promise.all([...flushers].map((flushAnswer) => flushAnswer()));
        }
        // Хуки итога, которые остановленный ход не стал ждать, доделываются в своём сроке.
        await afterTurn?.drain();
        // Работа после ходов (закрытие, состояние), затем хуки смены состояния в своём сроке.
        while (afterTurnWork.size > 0) await Promise.allSettled([...afterTurnWork]);
        await stateChanged.drain();
        await Promise.all([
          // Ходы уже записаны; запись, если где-то ещё идёт, дописывает остаток.
          ...[...flushers].map((flushAnswer) => flushAnswer()),
          compaction.drain(),
          memoryAfterAnswer.drain(),
          ...(options.background ? [options.background.flush()] : []),
        ]);
      } finally {
        closing = false;
      }
    },

  };

  /** `soleServer` — копия одна: чужих живых ответов нет, идущие ответы не этого процесса прерываются сразу. */
  async function recoverAnswersOnStart(soleServer: boolean): Promise<number> {
      if (!storage.listSilentAnswerIds) {
        // Хранилище не знает знака жизни: прерываются все идущие ответы, как до FR-060; копия сервера должна быть одна.
        logError(
          "Хранилище без listSilentAnswerIds и знака жизни ответа: при старте прерваны все идущие ответы, проверки брошенных ответов нет. С несколькими копиями сервера на одной базе так нельзя — обновите хранилище (FR-060).",
        );
        return interruptAnswers(await storage.listStreamingMessageIds());
      }
      // Регулярная проверка запускается до первой: если та упала, а встраивающий поймал ошибку и работает дальше,
      // брошенные ответы всё равно закроются.
      if (!staleSweep) {
        const sweep: StaleSweep = { stopped: false };
        staleSweep = sweep;
        const next = () => {
          if (sweep.stopped) return;
          sweep.timer = setTimeout(() => {
            // Ждущие хуки итога — той же проверкой: брошенный упавшей копией доделывается, когда его срок с запасом вышел.
            sweep.running = Promise.all([recoverStaleAnswers(), afterTurn?.recoverPending(liveAnswerIds)])
              .then(() => undefined)
              .catch((failure: unknown) =>
                logError(`Проверка брошенных ответов не удалась: ${failure instanceof Error ? failure.message : "неизвестная ошибка"}`),
              )
              .finally(() => {
                sweep.running = undefined;
                next();
              });
          }, STALE_ANSWERS_SWEEP_EVERY_MS);
          // Проверка не держит процесс: выключение сервера её не ждёт.
          sweep.timer.unref?.();
        };
        next();
      }
      return soleServer ? interruptAnswers(await storage.listStreamingMessageIds()) : recoverStaleAnswers();
  }

  /** Прерывает брошенные ответы (FR-060): без знака жизни дольше порога; можно только ответы одного чата. */
  async function recoverStaleAnswers(filter: { chatId?: string } = {}): Promise<number> {
    return interruptAnswers(await storage.listSilentAnswerIds!({ silentForMs: ANSWER_STALE_AFTER_MS, ...filter }));
  }

  /**
   * Прерывает идущие ответы из списка, кроме тех, что ведёт эта копия, и пишет их незаписанный расход. Ответ, который
   * тем временем закончила его копия или прервала другая, пропускается: расход пишет только тот, чья конечная запись
   * прошла. Сбой на одном ответе (битая запись, обрыв связи) пишется в журнал сервера и не держит остальные.
   * Возвращает число прерванных.
   */
  async function interruptAnswers(ids: readonly string[]): Promise<number> {
    let recovered = 0;
    for (const messageId of ids.filter((id) => !liveAnswerIds.has(id))) {
      try {
        if (await interruptAnswer(messageId)) recovered += 1;
      } catch (failure) {
        logError(`Не удалось прервать брошенный ответ ${messageId}: ${failure instanceof Error ? failure.message : String(failure)}`);
      }
    }
    return recovered;
  }

  /** Прерывает один брошенный ответ и пишет его незаписанный расход; `false` — ответ уже закончен. */
  async function interruptAnswer(messageId: string): Promise<boolean> {
    // Сбой мог прийтись на вызов инструмента или продолжение после «Разрешить»: вызов без результата ломает историю,
    // его закрываем тем же текстом, что и в запросе к модели.
    const message = await storage.getMessage(messageId);
    const parts = message && closeHangingToolCalls(denyPendingApprovals(message.parts, INTERRUPTED_REASON, RESULT_UNKNOWN_REASON));
    const changed = message && parts && parts.some((part, index) => part !== message.parts[index]);
    // Шаги идущего хода нужны только восстановлению: в законченном ответе их нет.
    const { pendingSteps, ...finishedUsage } = message?.usage ?? {};
    // Журнал читается до конечной записи: живой ход, узнав о прерывании, сразу допишет свою долю сверх снимка, и
    // вычесть её отсюда значило бы недосчитать.
    const journaled = message?.usage ? await storage.sumUsage({ chatId: message.chatId, messageId, source: "answer" }) : [];
    try {
      await storage.finishMessage(messageId, {
        status: "interrupted",
        ...(changed && parts && { parts }),
        ...(afterTurn && { afterTurn: "pending" as const }),
        // Расход в закрытом ответе — ровно тот снимок, что пойдёт в журнал: ход, если он жив, допишет только сверх него.
        ...(message?.usage && { usage: finishedUsage as TokenUsage }),
      });
    } catch (failure) {
      if (failure instanceof MessageAlreadyFinishedError) return false;
      throw failure;
    }
    // Расход, записанный в ответ по ходу, в журнал ещё не попал: пишется сейчас (FR-052). В ответе после «Разрешить»
    // лежит и расход до паузы — он уже в журнале, поэтому пишется только разница: сбой в любой миг продолжения
    // не задваивает расход.
    if (message?.usage && message.modelId && message.providerId) {
      const chat = await storage.getChat(message.chatId);
      const unjournaled = usageMinusJournaled(message.usage, journaled);
      if (chat && unjournaled) {
        // Шаги хода с провайдерами совпали с незаписанным: каждому провайдеру своя запись со ступенями по шагам.
        // Не совпали (часть хода уже в журнале) — одной записью на провайдера ответа, как раньше.
        const groups = stepsByProvider(pendingSteps, unjournaled) ?? [{ providerId: message.providerId, spent: unjournaled }];
        for (const group of groups) {
          await recordSpentTokens({
            storage,
            catalog: options.catalog,
            startedAt: message.createdAt,
            ownerId: chat.ownerId,
            chatId: message.chatId,
            messageId,
            source: "answer",
            modelId: message.modelId,
            ...group,
            logError,
          });
        }
      }
    }
    // Хук итога прерванного ответа — в фоне: проверка брошенных ответов его не ждёт.
    afterTurn?.recoverLater(messageId);
    return true;
  }

  if (options.background) options.background.attach(backgroundPort());

  /** Что ядро даёт фону: доставку, события, цикл помощника и его модель, лимит. Только фоновые помощники. */
  function backgroundPort(): BackgroundPort {
    const backgroundHelpers = Object.fromEntries(Object.entries(options.agent.helpers ?? {}).filter(([, helper]) => helper.background === true));
    return {
      deliverNotices: (request) => service.deliverNotices(request),
      events: chatEvents,
      runHelper,
      async helperModel(name, ownerId, chatId) {
        if (!backgroundHelpers[name]) throw new Error(`Фонового помощника «${name}» нет`);
        const chat = await ownChat(ownerId, chatId);
        const choice = effectiveChoiceOfChat(options.catalog, env, chat, defaultChoice);
        const found = findModel(options.catalog, choice.modelId, choice.providerId);
        const subject = subjectOfChat(chat);
        const model: AgentToolsModel = {
          profile: found.profile,
          providerId: found.provider.id,
          chatId,
          ownerId,
          place: null,
          // Вкладки у фоновой задачи нет: сообщать об изменённых данных некому.
          notifyDataChanged: () => {},
          channel: "web",
          audience: "private",
          messageId: "",
          ...(subject && { subject }),
          chat: { ...(chatDataOfInput(chat) && { data: chatDataOfInput(chat)! }) },
        };
        return helperToolsModel(model, {
          storage,
          catalog: options.catalog,
          env,
          chatId,
          ownerId,
          messageId: null,
          usageSource: "background",
          toolResultLimit,
          toolTimeout,
          sequentialTools,
          modelSilence,
          logError,
          ...(providerFallback !== undefined && { providerFallback }),
          ...(options.turnObserver && { turnObserver: options.turnObserver }),
          ...(options.limits && { assertWithinLimit: () => assertWithinSpendingLimit(ownerId, chatId) }),
        });
      },
      assertWithinLimit: (ownerId, chatId) => assertWithinSpendingLimit(ownerId, chatId),
      logError: (error) => logError(`Фон: ${error instanceof Error ? error.message : String(error)}`),
      helpers: backgroundHelpers,
    };
  }

  return service;

  function isDetachedAnswer(last: StoredMessage | undefined, runningId: string | null): boolean {
    return runningId === null && last?.status === "streaming" && !liveAnswerIds.has(last.id);
  }
}

/**
 * Выбор модели для хода: у продолжения — модель продолжаемого ответа (уровень рассуждений чата, только если модель та же).
 * `chatChoice` — фактический выбор чата, с подстановкой: с ним сверяется и продолжение после «Повторить».
 */
function choiceForLaunch(
  chatChoice: ModelChoice,
  resume: StoredMessage | undefined,
): { modelId: string; providerId: string; reasoning?: string | null } {
  if (!resume?.modelId || !resume.providerId) return chatChoice;
  const sameModel = resume.modelId === chatChoice.modelId && resume.providerId === chatChoice.providerId;
  return { modelId: resume.modelId, providerId: resume.providerId, ...(sameModel && { reasoning: chatChoice.reasoning }) };
}

function decisionOf(answer: ApprovalAnswer): ApprovalDecision {
  if (answer === "deny") return { approved: false, reason: DENIED_BY_USER_REASON };
  return answer === "always" ? { approved: true, reason: ALWAYS_IN_CHAT } : { approved: true };
}

/** Исход проверки, который не сбой службы: отказ приложения, «Стоп» человека, вышедший срок. Идёт в журнал отказом, не ошибкой. */
function isWidgetCheckOutcome(error: unknown): boolean {
  return error instanceof WidgetAnswerRefusedError || error instanceof WidgetAnswerCheckAbortedError || error instanceof WidgetAnswerCheckTimeoutError;
}

/** Вид отказа в ответе на виджет, как его назовёт сервер; не отказ (сбой базы) — `null`. */
function widgetRefusalKind(error: unknown): string | null {
  if (error instanceof ChatNotFoundError) return "not_found";
  if (error instanceof WidgetNotPendingError) return "widget_not_pending";
  if (error instanceof InvalidWidgetAnswerError) return "invalid_answer";
  if (error instanceof WidgetAnswerRefusedError) return "answer_refused";
  if (error instanceof WidgetAnswerCheckAbortedError) return "answer_cancelled";
  if (error instanceof WidgetAnswerCheckTimeoutError) return "answer_check_timeout";
  if (error instanceof ChatBusyError) return "busy";
  if (error instanceof SpendingLimitReachedError) return "spending_limit_reached";
  if (error instanceof TooManyTurnsError) return "too_many_turns";
  return null;
}


/** Сейчас, но не раньше `createdAt`: ответ не оказывается старше своего вопроса. */
function notBefore(createdAt: string): string {
  const now = Date.now();
  const earliest = Date.parse(createdAt);
  return new Date(Number.isNaN(earliest) || now > earliest ? now : earliest).toISOString();
}

function validateUserMessage(
  message: IncomingUserMessage,
  attachmentsEnabled: boolean,
): { text: string; files: IncomingFilePart[] } {
  if (typeof message?.id !== "string" || message.id.length === 0 || message.id.length > MAX_MESSAGE_ID_LENGTH) {
    throw new InvalidMessageError("У сообщения нет корректного id");
  }
  if (message.role !== "user" || !Array.isArray(message.parts)) {
    throw new InvalidMessageError("Ожидалось сообщение собеседника");
  }
  const text = message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  const files: IncomingFilePart[] = [];
  for (const part of message.parts) {
    if (part.type !== "file") continue;
    if (!attachmentsEnabled) throw new InvalidMessageError("Вложения здесь не поддерживаются");
    if (typeof part.url !== "string") throw new InvalidMessageError("У вложения нет ссылки");
    files.push({ type: "file", url: part.url, mediaType: part.mediaType, filename: part.filename });
  }
  if (text.trim().length === 0 && files.length === 0) throw new InvalidMessageError("Пустое сообщение");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new InvalidMessageError(`Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов`);
  }
  return { text, files };
}

/**
 * Шаги идущего хода по провайдерам, если вместе они и есть незаписанный в журнал расход; иначе `null`. Пометка
 * «примерно» — у провайдера, у которого хоть один шаг прикинут.
 */
function stepsByProvider(
  steps: readonly PendingStepUsage[] | undefined,
  unjournaled: TokenUsage,
): Array<{ providerId: string; spent: TokenUsage; steps: TokenUsage[] }> | null {
  if (!steps?.length) return null;
  const total = (field: "inputTokens" | "outputTokens") => steps.reduce((sum, step) => sum + step[field], 0);
  if (total("inputTokens") !== unjournaled.inputTokens || total("outputTokens") !== unjournaled.outputTokens) return null;
  const groups = new Map<string, TokenUsage[]>();
  for (const { providerId, ...usage } of steps) groups.set(providerId, [...(groups.get(providerId) ?? []), usage]);
  return [...groups].map(([providerId, providerSteps]) => ({ providerId, spent: sumOfSteps(providerSteps)!, steps: providerSteps }));
}

/** Запасной пояс даты в запросе: `agent.timeZone`, без него — пояс лимитов. Настройка одна: разные пояса — ошибка (разные имена одного пояса — нет). */
function resolveFallbackTimeZone(agentZone: string | undefined, limitsZone: string | undefined): string | undefined {
  const fallback = resolveTimeZone(agentZone);
  if (agentZone !== undefined && fallback === undefined) {
    throw new TypeError("agent.timeZone: ждём часовой пояс IANA, например «Europe/Moscow»");
  }
  if (fallback !== undefined && limitsZone !== undefined && !sameTimeZone(fallback, limitsZone)) {
    throw new TypeError(`agent.timeZone «${fallback}» и пояс лимитов расходов «${limitsZone}» разные: задайте один пояс в одном месте`);
  }
  return fallback ?? resolveTimeZone(limitsZone);
}

/** Ответ перед хвостом поправок: по нему видно, идёт ли ход где-то ещё. */
function answerBeforeCorrections(branch: readonly StoredMessage[]): StoredMessage | undefined {
  let end = branch.length;
  while (end > 0 && isCorrection(branch[end - 1]!)) end--;
  return branch[end - 1];
}

function plainTextOf(message: StoredMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Приём поправок хода закрылся, пока поправка ждала очереди. */
class SteeringClosed extends Error {}
