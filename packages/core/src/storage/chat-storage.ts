import { CURRENT_FORMAT_VERSION } from "../conversation/types";
import type { ChatClosure } from "../access/chat-closure";
import type { ModelChoice } from "../models/model-choice";
import type { ChatDataFilter } from "./chat-data";
import type { TurnRequestContext } from "../page-context/page-context";
import type { MemoryError, MemoryNote, MemoryNoteInput, MemoryRevertGuard, MemoryWriteGuard } from "../memory/long-term-memory";
import type { ExternalChannel } from "../conversation/types";
import type {
  MemoryMergeApplyResult,
  MemoryMergeInput,
  MemoryMergeRevertResult,
  MemoryOptimizationOutcome,
  MemoryOptimizationRules,
  MemoryOptimizationRun,
  MemoryOptimizationStatus,
  MergedMemoryNote,
} from "../memory/memory-optimization";
import type {
  AfterTurnState,
  AnswerAliveMark,
  Chat,
  FinalAnswerStatus,
  StoredBranchSelection,
  StoredCompaction,
  StoredMessage,
  UsageByChatFilter,
  UsageChatSum,
  UsageFilter,
  UsageRecord,
  UsageSum,
  VoiceCut,
} from "../conversation/types";

/** Запись состояния лимитов расходов: строка лимитов и её версия (от 1, растёт на 1 при каждой записи). */
export interface SpendingLimitStateRecord {
  value: string;
  version: number;
}

/** Условие записи ответа: тот же неповторяющийся держатель и ещё живая аренда чата, атомарно с записью. Не данные сообщения. */
export interface ChatTurnWriteGuard { expectedTurnHolder?: string; }

export type StreamingMessagePatch = Pick<StoredMessage, "parts"> &
  Partial<Pick<StoredMessage, "usage" | "reasoningDurationsMs" | "alive">> & ChatTurnWriteGuard;

/**
 * `providerId` — только если ответил запасной провайдер, а не выбранный при вставке. `afterTurn` — состояние хука итога
 * (обычно `pending`), ставится той же записью; хранилище без состояния хука его пропускает.
 */
export type FinishedMessagePatch = { status: FinalAnswerStatus } & Partial<
  Pick<StoredMessage, "parts" | "usage" | "reasoningDurationsMs" | "error" | "providerId">
> & { afterTurn?: AfterTurnState } & ChatTurnWriteGuard;

/** Новый чат. `createdAt` задан — и создание, и обновление чата получают эту дату; нет — время записи. */
export interface NewChatInput {
  id: string;
  ownerId: string;
  modelId: string;
  providerId: string;
  reasoning?: string;
  origin?: ExternalChannel;
  title?: string;
  /** Ключ объекта, см. `Chat.subjectKey`. Хранилище без `findChatBySubject` ключ не обязано хранить. */
  subjectKey?: string;
  /** Данные чата, см. `Chat.data`. Прежнее имя — `subjectData`: то же значение; заданы оба — берётся `data`. */
  data?: Record<string, unknown>;
  subjectData?: Record<string, unknown>;
  createdAt?: string;
}

/** Какие чаты отдаёт `listChats`: `exclude` (по умолчанию) — без ключа объекта, `include` — все, `only` — только с ключом. */
export type ChatSubjectFilter = "exclude" | "include" | "only";

/** Условия `listChats`. */
export interface ChatListOptions {
  /** Какие чаты по ключу объекта, см. `ChatSubjectFilter`. */
  subjects?: ChatSubjectFilter;
  /**
   * Только чаты, у которых данные (`Chat.data`) содержат все эти верхние ключи с такими же значениями (равенство, тип
   * важен: `1` не равно `"1"`). Значение — строка, число, булево или `null`, иначе `TypeError`. Нужен `updateChatData`:
   * хранилище без него фильтр не обязано понимать.
   */
  data?: ChatDataFilter;
}

/** Чат для переноса целиком: даты как есть. */
export type ImportedChat = Pick<Chat, "id" | "ownerId" | "modelId" | "providerId" | "createdAt" | "updatedAt"> &
  Partial<Pick<Chat, "reasoning" | "title" | "subjectKey" | "data" | "subjectData">>;

/** Правка ответа, который ждёт подтверждения: новые части и, если ожидание кончилось, новый статус. */
export interface AwaitingMessagePatch extends ChatTurnWriteGuard {
  parts: StoredMessage["parts"];
  /** Не указан — ответ остаётся ждущим. `streaming` — ход продолжается, `complete` — ожидание закрыто без продолжения. */
  status?: "streaming" | "complete";
  /** Знак жизни вернувшегося в работу ответа (`status: "streaming"`), см. `StoredMessage.alive`. */
  alive?: "now";
  /**
   * Части, с которыми ответ прочитан. Указаны — запись проходит, только если в базе те же части (`sameMessageParts`):
   * иначе ответ успела изменить другая копия сервера, и запись отклоняется `MessageNotAwaitingError`. Чтение, сравнение и
   * запись — одна операция. Не указаны — запись без сравнения.
   */
  expectedParts?: StoredMessage["parts"];
}

/** Место сообщения в дереве переписки. */
export interface MessageLink {
  id: string;
  parentId: string | null;
  createdAt: string;
}

/** Связь сообщения и его части нужных типов (`listMessagePartsOfTypes`). */
export interface MessagePartsLink extends MessageLink {
  parts: StoredMessage["parts"];
}

/** Хранилище чатов. Владельца не проверяет — это делает ядро до вызова. */
export interface ChatStorage {
  /** Адаптер атомарно исполняет ChatTurnWriteGuard у всех записей ответа; обязателен при наличии аренд. */
  readonly guardedTurnWrites?: true;
  /** Повтор `subjectKey` у того же владельца — `DuplicateChatSubjectError`, чат не записан. */
  createChat(input: NewChatInput): Promise<Chat>;
  getChat(chatId: string): Promise<Chat | null>;
  /** Выбор чата целиком: модель, провайдер и уровень рассуждений. Без `reasoning` сохранённый уровень стирается. */
  updateChatModel(chatId: string, model: { modelId: string; providerId: string; reasoning?: string }): Promise<void>;
  /**
   * Чаты владельца: самые недавние по `updatedAt` первыми, при равенстве — по `createdAt`, затем по id (новее и больше
   * первыми). `subjects` — какие чаты по ключу объекта (см. `ChatSubjectFilter`); по умолчанию без чатов с ключом.
   * `data` — фильтр по данным чата (см. `ChatListOptions.data`).
   */
  listChats(ownerId: string, options?: ChatListOptions): Promise<Chat[]>;
  /**
   * Слияние верхних ключей в данные чата одной атомарной операцией: ключ патча заменяет старый целиком, ключ со
   * значением `undefined` удаляется, прочие остаются. Итог больше `maxBytes` в JSON — `ChatDataTooLargeError`, данные
   * не изменены. Не осталось ключей — у чата нет данных. Дата обновления чата не меняется. Возвращает чат после
   * записи; нет такого чата — `null`. Необязательный: его наличие означает, что хранилище знает данные чата
   * (`createChat` с `data`, `listChats` с `data`).
   */
  updateChatData?(chatId: string, patch: Record<string, unknown>, options: { maxBytes: number }): Promise<Chat | null>;
  /**
   * Чат владельца с ключом объекта; нет — `null`. Необязательный: его наличие означает, что хранилище знает ключи
   * объектов (`createChat` с ключом, данными, названием и датой, `listChats` с `subjects`). Без него ядро не включает
   * чаты объектов и говорит об этом при старте.
   */
  findChatBySubject?(ownerId: string, subjectKey: string): Promise<Chat | null>;
  /**
   * Перенос чата целиком одной транзакцией: чат и сообщения с датами как есть (`updatedAt` чата по сообщениям не
   * пересчитывается). Повтор id чата — `ChatAlreadyExistsError`, повтор ключа объекта — `DuplicateChatSubjectError`,
   * повтор id сообщения — `DuplicateMessageError`; при любой ошибке ничего не записано. Необязательный.
   */
  importChat?(chat: ImportedChat, messages: StoredMessage[]): Promise<void>;
  /**
   * Состояние хука итога у сообщения (см. `StoredMessage.afterTurn`). `pending` пишется всегда; `done` и `failed` —
   * только если сейчас `pending` (чтение, сравнение и запись — одна операция): хук, который закончили две копии
   * сервера, закрывается один раз. `appendParts` дописываются в конец частей той же записью (события приложения хука).
   * `true` — записано; неизвестное сообщение или не `pending` — `false`, ничего не записано. Необязательный, идёт
   * вместе с `listPendingAfterTurn`; без них ядро не зовёт хук итога.
   */
  setAfterTurnState?(messageId: string, state: AfterTurnState, options?: { appendParts?: StoredMessage["parts"] }): Promise<boolean>;
  /**
   * Id сообщений, у которых хук итога ждёт (`pending`): их доделывают после перезапуска. С `pendingForMs` — только те,
   * что ждут дольше: отметка ставится при переходе в `pending` (`finishMessage`, `setAfterTurnState`) по тем же часам,
   * что знак жизни ответа (без отметки — `createdAt`). Свежий ждущий хук может вести другая копия сервера.
   */
  listPendingAfterTurn?(filter?: { pendingForMs?: number }): Promise<string[]>;
  /** Название чата; `null` стирает его. `updatedAt` не меняется: переименование порядок списка не двигает. Неизвестный чат — тихо. */
  renameChat(chatId: string, title: string | null): Promise<void>;
  /**
   * Закрыть чат (`closed` у чата) или снова открыть (`null`). Повторное закрытие заменяет код и текст. `updatedAt` не
   * меняется. Неизвестный чат — тихо. Необязательный: без него `closeChat` и `model.closeChat` недоступны.
   */
  setChatClosed?(chatId: string, closed: ChatClosure | null): Promise<void>;
  /**
   * Удаляет чат вместе со всем, что к нему относится: сообщения всех веток и записи сжатия, одной операцией.
   * Неизвестный чат — тихо. Владельца не проверяет. Файлы вложений лежат не здесь: их убирает служба чата через
   * `attachments.removeChatFiles` до этого вызова.
   */
  deleteChat(chatId: string): Promise<void>;
  /** Сообщение по id; неизвестного нет — `null`. */
  getMessage(messageId: string): Promise<StoredMessage | null>;
  /** Все сообщения чата по времени создания; ветку выбирает ядро. */
  listMessages(chatId: string): Promise<StoredMessage[]>;
  /**
   * Связи сообщений чата без содержимого, в том же порядке, что у `listMessages`: id, родитель, время создания.
   * Лёгкий путь для тех, кому нужна только ветка (например, записи сжатия для экрана).
   */
  listMessageLinks(chatId: string): Promise<MessageLink[]>;
  /**
   * Связи сообщений чата, как у `listMessageLinks`, и у каждого — только части этих типов (по порядку; нет — пустой
   * список). Выборка внутри базы: тексты и выводы инструментов не читаются. Лёгкий путь для состояния ветки
   * (`getChatState`, закрытие, `onStateChanged`). Необязательный: без него ядро читает `listMessages`.
   */
  listMessagePartsOfTypes?(chatId: string, types: readonly string[]): Promise<MessagePartsLink[]>;
  /** Новое сообщение; в той же операции обновляет `updatedAt` чата. */
  insertMessage(message: StoredMessage, guard?: ChatTurnWriteGuard): Promise<void>;
  /** Дописать идущий ответ. Только пока status = 'streaming'. */
  updateStreamingMessage(messageId: string, patch: StreamingMessagePatch): Promise<void>;
  /**
   * Лёгкая запись знака жизни «сейчас» (см. `StoredMessage.alive`): только знак, без частей и расхода. Только пока
   * status = 'streaming', иначе `MessageAlreadyFinishedError`. Необязательный: без него ход пишет знак полной записью
   * ответа (`updateStreamingMessage`).
   */
  markAnswerAlive?(messageId: string, guard?: ChatTurnWriteGuard): Promise<void>;
  /** Перевести ответ в конечное состояние. Только из 'streaming'. */
  finishMessage(messageId: string, final: FinishedMessagePatch): Promise<void>;
  /**
   * Изменить ответ, который ждёт подтверждения. Только из 'awaiting_approval' и, если указаны `expectedParts`, только с
   * теми же частями; иначе `MessageNotAwaitingError`.
   */
  updateAwaitingMessage(messageId: string, patch: AwaitingMessagePatch): Promise<void>;
  /** Все ответы в состоянии 'streaming'. */
  listStreamingMessageIds(): Promise<string[]>;
  /**
   * Молчащие идущие ответы: последний знак жизни (без него — `createdAt`) старше `silentForMs` по тем же часам, что
   * ставят знак «сейчас». Это ответы упавших копий сервера, а не живые ответы других копий на той же базе. С `chatId` —
   * только ответы этого чата.
   *
   * Необязательный: без него служба прерывает идущие ответы только при старте и все разом, как до этапа 8в, и пишет в
   * журнал, что держать несколько копий сервера на таком хранилище нельзя.
   */
  listSilentAnswerIds?(filter: { silentForMs: number; chatId?: string }): Promise<string[]>;
  /**
   * Аренда хода чата между копиями сервера: один ход за раз на чат, даже когда копий несколько. Атомарно берёт аренду
   * для `holder` на `leaseMs` по часам хранилища: чат свободен, аренда своя (продление) или чужая просрочена — `true`;
   * чужая живая — `false`. Удаление чата снимает аренду.
   *
   * Необязательный (вместе с `releaseChatTurn`): без него служба держит один ход за раз только внутри своей копии, а
   * между копиями — по знаку жизни ответа, с узким окном гонки.
   */
  claimChatTurn?(chatId: string, holder: string, leaseMs: number): Promise<boolean>;
  /** Снять свою аренду хода; чужую или снятую — тихо ничего. */
  releaseChatTurn?(chatId: string, holder: string): Promise<void>;
  /**
   * Снять все аренды хода всех чатов. Зовёт только старт единственной копии сервера
   * (`recoverInterruptedAnswers({ soleServer: true })`): других копий нет, все аренды — от упавшего прошлого запуска.
   * Необязательный: без него такие чаты свободны через срок аренды.
   */
  clearChatTurnLeases?(): Promise<void>;
  /**
   * Пачка сообщений человека ждёт хода (`sendBurstMessage`): запись на чат, новая заменяет прежнюю. Нужна, чтобы пачку,
   * чьё окно тишины ждала упавшая или перезапущенная копия сервера, ответила другая копия или следующий запуск.
   *
   * Необязательный (вместе с `takeAbandonedBursts`, `renewPendingBurst` и `removePendingBurst`): без него окно тишины живёт только в памяти
   * копии — после перезапуска пачка ответит, только когда приложение повторит вызов.
   */
  savePendingBurst?(burst: StoredPendingBurst): Promise<void>;
  /**
   * Брошенные пачки — `heldUntil` не позже `abandonedBefore` — атомарно переходят к `holder` до `heldUntil` и
   * возвращаются, не больше `limit`, ранние `dueAt` первыми. Две копии разом одну пачку не получат. `exceptHolder` —
   * записи этого держателя не берутся, каким бы ни был их срок.
   */
  takeAbandonedBursts?(take: { abandonedBefore: string; holder: string; heldUntil: string; limit: number; exceptHolder?: string }): Promise<StoredPendingBurst[]>;
  /**
   * Продлить удержание до `heldUntil`, если запись чата всё ещё о сообщении `messageId` и держит её `holder`. Продлено —
   * `true`; запись другая, взята другой копией или снята — `false`, ничего не меняется.
   */
  renewPendingBurst?(renew: { chatId: string; messageId: string; holder: string; heldUntil: string }): Promise<boolean>;
  /** Снять запись пачки чата, если она всё ещё о сообщении `messageId`; о другом сообщении или нет — тихо ничего. */
  removePendingBurst?(chatId: string, messageId: string): Promise<void>;
  /** Новая запись сжатия. Записи только добавляются; сообщения не меняются. Повтор id — ошибка. */
  insertCompaction(record: StoredCompaction): Promise<void>;
  /** Записи сжатия чата в порядке добавления. */
  listCompactions(chatId: string): Promise<StoredCompaction[]>;
  /** Новая отметка выбора ветки. Записи только добавляются; сообщения и чат не меняются. Повтор id — ошибка. */
  insertBranchSelection(record: StoredBranchSelection): Promise<void>;
  /** Отметки выбора ветки чата в порядке добавления. */
  listBranchSelections(chatId: string): Promise<StoredBranchSelection[]>;
  /** Новая запись расхода. Записи только добавляются, чата не требуют и не удаляются вместе с ним. Повтор id — ошибка. */
  insertUsageRecord(record: UsageRecord): Promise<void>;
  /**
   * Есть ли запись расхода с таким id. Нужен, чтобы после сбоя вставки отличить «уже записано» от «не записалось».
   * Необязательный: без него такие сбои распознаются по коду ошибки базы.
   */
  hasUsageRecord?(id: string): Promise<boolean>;
  /** Сумма расхода по парам «модель × провайдер», без пар с нулевым числом записей. Без фильтра — весь расход. */
  sumUsage(filter: UsageFilter): Promise<UsageSum[]>;
  /**
   * Сумма расхода по списку чатов одним запросом (с 0.53): по чату и паре «модель × провайдер», без пар с нулевым числом
   * записей. Чатов без записей в ответе нет; пустой список — пустой ответ. Необязательный: без него — `sumUsage` по чату.
   */
  sumUsageByChat?(filter: UsageByChatFilter): Promise<UsageChatSum[]>;
  /**
   * Состояние лимитов расходов (`@ykurilov/agent-chat-limits`) по ключу: строка, которую лимиты пишут и читают сами
   * (начала скользящих окон, перенос перерасхода, ручные сбросы, личные лимиты, отправленные пороги). `null` — записи нет.
   * Необязательный: без него (и без `saveSpendingLimitState`) лимиты работают только с календарными окнами и без
   * личных настроек людей.
   */
  getSpendingLimitState?(key: string): Promise<SpendingLimitStateRecord | null>;
  /**
   * Записывает состояние лимитов, только если запись не менялась с прочтения: `expectedVersion` — версия прочитанной
   * записи, `null` — записи ещё нет. Удалось — `true`, версия записи выросла на 1 (новая запись — версия 1); запись
   * успели изменить или создать — `false`, ничего не записано. Необязательный, см. `getSpendingLimitState`.
   */
  saveSpendingLimitState?(key: string, value: string, expectedVersion: number | null): Promise<boolean>;
  /**
   * Стирает состояния лимитов с этими ключами; ключей нет в хранилище — ничего. Лимиты зовут его при удалении чата,
   * чтобы не хранить окна удалённого чата. Необязательный: без него эти записи остаются.
   */
  deleteSpendingLimitStates?(keys: string[]): Promise<void>;
  /**
   * Последний выбор модели человека: провайдер, модель и уровень рассуждений; `null` — человек ещё не выбирал.
   * Необязательный: без него (и без `saveUserModelChoice`) новые чаты открываются на выборе по умолчанию, как раньше.
   * Владельцев не проверяет и с чатами не связан: удаление чата выбор не стирает.
   */
  getUserModelChoice?(ownerId: string): Promise<ModelChoice | null>;
  /** Запоминает выбор человека вместо прежнего. Без `reasoning` сохранённый уровень стирается. Необязательный, см. `getUserModelChoice`. */
  saveUserModelChoice?(ownerId: string, choice: ModelChoice): Promise<void>;
  /**
   * Голосовой режим: отметка обрыва озвучки у сообщения агента. Хранилище проверяет владельца: чужой чат, чужое
   * сообщение (не из этого чата) и неизвестное сообщение — тихо ничего. Заменяет прежнюю отметку. Необязательный:
   * без него отметка живёт только на экране до перезагрузки.
   */
  setVoiceCut?(input: { ownerId: string; chatId: string; messageId: string; voiceCut: VoiceCut }): Promise<void>;
  /** Выбранный человеком голос озвучки; `null` — не выбирал. Необязательный: без него выбор живёт до перезагрузки. С чатами и выбором модели не связан. */
  getVoiceChoice?(ownerId: string): Promise<string | null>;
  /** Запоминает голос человека вместо прежнего. Необязательный, см. `getVoiceChoice`. */
  setVoiceChoice?(ownerId: string, voiceId: string): Promise<void>;
  /**
   * Долгая память (все пять методов необязательные и идут вместе; без них приложение не подключает пакет памяти).
   * Записи принадлежат человеку (`ownerId`) и с чатами не связаны: удаление чата память не трогает.
   * Пределы и дубли проверяет пакет памяти; хранилище отвечает за атомарность, владельца и версию.
   *
   * Записи человека: новейшие по `updatedAt` первыми, при равенстве — по `createdAt`, затем по `id` (новее и больше первыми).
   */
  listMemoryNotes?(ownerId: string): Promise<MemoryNote[]>;
  /** Добавляет записи пакетом: все или ни одной. Версия новых записей — 1. Пустой пакет — пустой ответ. */
  insertMemoryNotes?(ownerId: string, notes: MemoryNoteInput[]): Promise<MemoryNote[]>;
  /** Заменяет разделы и текст записи, если её версия равна `expectedVersion`; версия растёт на 1. Чужая или отсутствующая запись — `not_found`. */
  updateMemoryNote?(
    ownerId: string,
    id: string,
    expectedVersion: number,
    note: MemoryNoteInput,
  ): Promise<MemoryNote | "not_found" | "stale_version">;
  /**
   * Необязательно: как `insertMemoryNotes`, но с проверкой внутри той же операции. Хранилище читает записи человека и
   * зовёт `guard` под замком, который не даёт другому запросу вставить между чтением и записью (транзакция; в
   * PostgreSQL — ещё и замок по человеку). Ошибка от `guard` — ничего не записано, хранилище отдаёт её как есть.
   * Так предел и дубли держатся и при нескольких серверах на одной базе. Без метода пакет памяти проверяет под своим
   * замком в одном процессе.
   */
  insertMemoryNotesChecked?(ownerId: string, notes: MemoryNoteInput[], guard: MemoryWriteGuard): Promise<MemoryNote[] | MemoryError>;
  /**
   * Необязательно: как `updateMemoryNote`, но `guard` зовётся внутри операции, до проверки записи и версии, и получает
   * все записи человека (в том числе заменяемую). Ошибка от `guard` — ничего не изменено.
   */
  updateMemoryNoteChecked?(
    ownerId: string,
    id: string,
    expectedVersion: number,
    note: MemoryNoteInput,
    guard: MemoryWriteGuard,
  ): Promise<MemoryNote | "not_found" | "stale_version" | MemoryError>;
  /** Удаляет запись, если её версия равна `expectedVersion`. Чужая или отсутствующая запись — `not_found`. */
  deleteMemoryNote?(ownerId: string, id: string, expectedVersion: number): Promise<"ok" | "not_found" | "stale_version">;
  /**
   * Стирает всю память человека вместе со скрытыми оригиналами слияний и запусками оптимизации; возвращает число
   * удалённых записей, которые человек видел (скрытые не считаются). Чужих не трогает.
   */
  clearMemoryNotes?(ownerId: string): Promise<number>;
  /**
   * Оптимизация дублей (необязательная группа из шести методов; идёт поверх методов долгой памяти).
   * Скрытые оригиналы слияния лежат рядом с обычными записями, но `listMemoryNotes`, `updateMemoryNote` и
   * `deleteMemoryNote` их не видят (для них они — `not_found`). Удаление результата слияния удаляет и его оригиналы.
   *
   * Берёт запуск, если правила позволяют: нет живого запуска `running`, после законченного прошло `minIntervalMs`,
   * после неудачного — `retryAfterFailureMs`. Иначе `null`. Просроченный `running` (старше `leaseMs`) становится
   * `failed` с ошибкой `lease_expired` и временем конца `startedAt + leaseMs`. `now` — время в формате ISO 8601.
   * Проверка и взятие — одна операция: два процесса не получат запуск оба.
   */
  claimMemoryOptimizationRun?(ownerId: string, rules: MemoryOptimizationRules, now: string): Promise<MemoryOptimizationRun | null>;
  /** Закрывает идущий запуск без слияния. Чужой, отсутствующий или уже закрытый запуск — `not_found`. */
  finishMemoryOptimizationRun?(ownerId: string, runId: string, outcome: MemoryOptimizationOutcome): Promise<"ok" | "not_found">;
  /**
   * Сливает записи одной операцией: вставляет результаты, прячет оригиналы за ними и закрывает запуск как `applied`.
   * Любой оригинал, которого нет, что уже скрыт или чья версия не равна названной, — `stale_version`, и ничего не
   * меняется. Запуск, которого нет или который не `running`, — `run_not_active`. Пустой список, пустая группа и
   * оригинал в двух группах — ошибка вызова (исключение). Версия результата — 1.
   */
  applyMemoryMerge?(ownerId: string, merge: MemoryMergeInput): Promise<MemoryMergeApplyResult>;
  /**
   * Возвращает слияние: удаляет результаты, показывает оригиналы, запуск становится `reverted`. Работает, только пока
   * каждый результат цел и не менялся (версия та же, оригиналы на месте); иначе `conflict`. Запуск, которого нет или
   * который не `applied`, — `not_found`. `guard` (если задан) зовётся внутри операции после этих проверок: ошибка
   * `limit_reached` или `duplicate` — ничего не изменено, хранилище отвечает её видом. Пока записи вернутся, за это
   * время могли добавиться другие: без проверки возврат вышел бы за пределы памяти.
   */
  revertMemoryMerge?(ownerId: string, runId: string, guard?: MemoryRevertGuard): Promise<MemoryMergeRevertResult>;
  /** Запуски человека, новейшие по `startedAt` первыми. `status` — только с этими состояниями, `limit` — не больше стольких. */
  listMemoryOptimizationRuns?(ownerId: string, filter?: { status?: MemoryOptimizationStatus[]; limit?: number }): Promise<MemoryOptimizationRun[]>;
  /** Скрытые оригиналы слияний человека в том же порядке, что и обычный список. */
  listMergedMemoryNotes?(ownerId: string): Promise<MergedMemoryNote[]>;
}

/** Знак «брошен» в хранилище: начало эпохи, раньше любой границы молчания. */
export const RELEASED_ANSWER_ALIVE_AT = new Date(0).toISOString();

/** Время знака жизни для хранилища на одной машине с сервером (память, SQLite): по часам этой машины. */
export function aliveAtByLocalClock(mark: AnswerAliveMark): string {
  return mark === "released" ? RELEASED_ANSWER_ALIVE_AT : new Date().toISOString();
}

/** Граница молчания по часам этой машины: знак раньше неё — ответ молчит дольше `silentForMs`. */
export function silenceBoundaryByLocalClock(silentForMs: number): string {
  return new Date(Date.now() - silentForMs).toISOString();
}

export class DuplicateMessageError extends Error {
  constructor(messageId: string) {
    super(`Сообщение ${messageId} уже есть`);
    this.name = "DuplicateMessageError";
  }
}

export class ChatAlreadyExistsError extends Error {
  constructor(chatId: string) {
    super(`Чат ${chatId} уже есть`);
    this.name = "ChatAlreadyExistsError";
  }
}

/** У владельца уже есть чат с этим ключом объекта. */
export class DuplicateChatSubjectError extends Error {
  constructor(
    readonly ownerId: string,
    readonly subjectKey: string,
  ) {
    super(`У владельца ${ownerId} уже есть чат с ключом ${subjectKey}`);
    this.name = "DuplicateChatSubjectError";
  }
}

/** Запись ответа отклонена: поколение аренды сменилось или её срок истёк. */
export class ChatTurnLeaseLostError extends Error {
  constructor(readonly messageId: string) {
    super(`Запись ответа ${messageId} отклонена: аренда хода утрачена`);
    this.name = "ChatTurnLeaseLostError";
  }
}

export class MessageAlreadyFinishedError extends Error {
  constructor(messageId: string) {
    super(`Сообщение ${messageId} уже в конечном состоянии и не меняется`);
    this.name = "MessageAlreadyFinishedError";
  }
}

/** Части сообщения одинаковы как JSON: порядок ключей и ключи со значением `undefined` не важны. */
export function sameMessageParts(left: StoredMessage["parts"], right: StoredMessage["parts"]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export class MessageNotAwaitingError extends Error {
  constructor(messageId: string) {
    super(`Сообщение ${messageId} не ждёт подтверждения`);
    this.name = "MessageNotAwaitingError";
  }
}

export class UnsupportedFormatVersionError extends Error {
  constructor(messageId: string, formatVersion: number) {
    super(`Сообщение ${messageId} записано в формате ${formatVersion}, ядро знает только до ${CURRENT_FORMAT_VERSION}`);
    this.name = "UnsupportedFormatVersionError";
  }
}

/** Для адаптеров: сообщение из будущей версии формата прочитать нельзя. */
export function assertKnownFormatVersion(message: Pick<StoredMessage, "id" | "formatVersion">): void {
  if (message.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new UnsupportedFormatVersionError(message.id, message.formatVersion);
  }
}

/** Пачка, ждущая хода (`ChatStorage.savePendingBurst`). Время — ISO 8601 по часам службы. */
export interface StoredPendingBurst {
  chatId: string;
  ownerId: string;
  /** Последнее сообщение пачки: на него ход. */
  messageId: string;
  /** Конец окна тишины: раньше ход не начинается. */
  dueAt: string;
  /** Копия сервера, которая ждёт окно, и до какого времени её ожидание считается живым. Прошло — пачка брошена. */
  holder: string;
  heldUntil: string;
  /** Страница хода (`SendMessageOptions.page`): ход после перезапуска идёт с ней. */
  page?: TurnRequestContext;
}
