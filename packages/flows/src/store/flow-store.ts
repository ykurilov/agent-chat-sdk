import type { AgentFlow } from "../format/flow-format";
import type { FlowEndReason, Transition, FlowTransitionMode, FlowJudgeAdvice } from "../engine/flow-run";
import type { StateMap } from "../engine/migrate-run";

// Договор хранилища сценариев: память (тесты), SQLite и PostgreSQL ведут себя одинаково.
// Времена — строки ISO 8601, как у хранилища чатов и фона.

/** Что случилось с чатом вне хода; применит `prepareTurn` следующего хода. Повтор с тем же `key` ничего не добавляет. */
export type PendingFlowChange =
  | {
      kind: "transition";
      key: string;
      transition: Transition;
      /** Последнее сообщение ветки, на которой решён переход; `null` — пустой чат. Ветку сменили — ожидание снимается. */
      branchHead: string | null;
      /**
       * Переход по таймеру уже применён в срок без хода (писать первым нельзя): запись чата и `onTransition` сделаны,
       * таймеры идут от новой ноды. Ход только переносит его в состояние чата, не сообщая заново.
       */
      appliedAt?: string;
    }
  | { kind: "advice"; key: string; versionId: string; from: string; branchHead: string; verdicts: FlowJudgeAdvice[] }
  | { kind: "event"; key: string; name: string; data?: unknown; at: string }
  | { kind: "migrate"; key: string; versionId: string; map: StateMap; at: string };

/** Чат, который идёт по сценарию: версия закреплена, состояние и ближайший таймер — для выборок и тика. */
export interface FlowChatRecord {
  /** Нет у старого собственного store — rails. */
  transitionMode?: FlowTransitionMode;
  chatId: string;
  ownerId: string;
  flowId: string;
  versionId: string;
  /** Копия состояния из `FlowRun` для счёта чатов по состояниям. Правда — в состоянии чата. */
  stateId: string;
  pending: PendingFlowChange[];
  /** Ближайший таймер: когда, какое условие и на какой ветке он посчитан. */
  dueAt: string | null;
  dueExitId: string | null;
  dueBranchHead: string | null;
  /** Пояс человека (IANA): от него «время суток» и тихие часы. Запасной: сначала — пояс человека (`readTimeZone`). */
  timeZone: string;
  updatedAt: string;
  /** Разговор закончился: таймеров и касаний больше нет. */
  endedAt: string | null;
  endReason: FlowEndReason | null;
  /** Разговор открыт заново (`flow.reopen`) в этот момент, по часам чата; место догоняет отметку на ближайшем чтении. С 0.68. */
  reopenedAt: string | null;
  /** Пауза «отвечает живой сотрудник» до этого момента; таймеры не берутся. */
  pausedUntil: string | null;
  /** Канал приложения закрыл окно: первым не писать до сообщения человека. */
  windowClosed: boolean;
  /** День сценария («ГГГГ-ММ-ДД»), который агент закрыл (`flow_close_day`): сегодня первым не пишет. */
  dayClosedOn: string | null;
  /** Недоставленный ответ, который ждёт повтора. */
  delivery: FlowPendingDelivery | null;
  /** Куда приложение перенесло чат при закреплении; первый ход кладёт это место в состояние чата и снимает запись. */
  placement: FlowChatPlacement | null;
}

/** Моменты, от которых считаются дни и сроки перенесённого чата (ISO). */
export interface FlowChatPlacement {
  startedAt: string;
  enteredAt: string;
  // Перенос идущего чата целиком (0.50). Записи 0.49 этих полей не имеют.
  /** Последнее сообщение человека. */
  lastHumanAt?: string;
  /** Последнее сообщение агента: ответ или касание. */
  lastAgentAt?: string;
  /** Следующий шаг ряда касаний. */
  nudgeStep?: number;
  /** Сколько сообщений человек написал за день сценария к моменту `at`: день считается по поясу человека, когда он известен. */
  humanToday?: { at: string; count: number };
}

/** Срок записи о повторе доставки в таблице сроков. Законченный разговор берётся таймером только с этим сроком. */
export const FLOW_DELIVERY_EXIT = "@delivery";

/** Повтор доставки того же текста по ключу `messageId`, без нового хода модели. */
export interface FlowPendingDelivery {
  messageId: string;
  /** Номер следующей попытки, с 1. */
  attempt: number;
  retryAt: string;
  /** Причины хода «пишет первым» — для `FlowOutgoing.reasons`. */
  reasons: string[];
  /**
   * Версия записи: своя у каждой отправки и каждого возобновления, даже при том же `attempt`. По ней `swapDelivery`
   * отличает устаревшего писателя. С 0.81; записи до 0.81 её не имеют.
   */
  token?: string;
  /** Канал ждёт починки снаружи (`await_repair`): срока нет, попытка не потрачена, отправит `resumeDelivery`. С 0.81. */
  pausedAt?: string;
  /** Возобновлено после починки (`resumeDelivery`): перед отправкой ответ проверяется на устаревание. С 0.81. */
  resumedAt?: string;
}

/**
 * Условная замена записи доставки (`swapDelivery`): одной операцией, только если запись — та, что прочитал вызывающий
 * (`messageId`, `attempt`, `token`; `null` — записи нет).
 */
export interface SwapDeliveryInput {
  expected: FlowPendingDelivery | null;
  next: FlowPendingDelivery | null;
  /** Срок чата вместе с записью: `null` — снять; нет поля — не трогать. Аренду не снимает. */
  due?: FlowDueInput | null;
  /**
   * Взять аренду таймера на `owner` до `now + leaseMs`: только если она свободна (нет или кончилась к `now`), уже у
   * `owner` или у `from` (аренда срабатывания, которое передаёт её отправке).
   */
  claim?: { owner: string; now: string; leaseMs: number; from?: string };
  /** Писать, только если к этому моменту ни у кого нет живой аренды: идёт отправка — не мешать ей. */
  freeAt?: string;
  /** Писать, только если конец разговора всё ещё этот: `null` — не закончен. Нет поля — не сверять. */
  endedAt?: string | null;
}

export interface PinFlowChatInput {
  transitionMode?: FlowTransitionMode;
  chatId: string;
  ownerId: string;
  flowId: string;
  versionId: string;
  stateId: string;
  timeZone: string;
  /** Чат перенесён в заданное место: до первого хода хранится здесь, переживая перезапуск сервера. */
  placement?: FlowChatPlacement;
  at: string;
}

export type FlowChatPatch = Partial<Pick<FlowChatRecord, "versionId" | "stateId" | "timeZone" | "placement">>;

export interface FlowDueInput {
  at: string;
  exitId: string;
  branchHead: string | null;
}

export interface RenewLeaseInput {
  chatId: string;
  owner: string;
  now: string;
  leaseMs: number;
}

export interface SetDueOptions {
  /** Не писать, если чат ждёт повтора доставки: у повтора свой срок, его не затереть. */
  unlessDelivery?: boolean;
  /**
   * Писать, только если таймер ещё в аренде у этой копии: копия, у которой аренду забрали (зависла дольше срока), чужой
   * срок не переписывает. Хранилище приложения без этого условия такой гарантии не даёт.
   */
  leaseOwner?: string;
}

export interface LeaseDueInput {
  now: string;
  /** Копия сервера, которая берёт таймеры. */
  owner: string;
  leaseMs: number;
  limit: number;
}

export interface SavedFlowVersion {
  flowId: string;
  versionId: string;
  /** Отпечаток сценария: одна версия — один отпечаток. */
  hash: string;
  flow: AgentFlow;
  createdAt: string;
}

/** `same` — эта версия уже сохранена с тем же отпечатком; `conflict` — под тем же номером другой сценарий. */
export type SaveFlowVersionResult = "new" | "same" | "conflict";

export interface ChatsInState {
  versionId: string;
  stateId: string;
  chats: number;
}

/** Чат сценария для отбора при переводе на новую версию. */
export type FlowChatSummary = Pick<FlowChatRecord, "chatId" | "ownerId" | "flowId" | "versionId" | "stateId" | "endedAt" | "endReason">;

export interface ListFlowChatsInput {
  flowId: string;
  /** Без чатов, которые уже на этой версии. */
  exceptVersionId?: string;
  /** Только эти чаты. */
  chatIds?: string[];
}

export interface MigrateBatchInput {
  flowId: string;
  toVersionId: string;
  /** Куда перевести чаты из удалённых состояний. */
  map: StateMap;
  /** Только эти чаты; нет — любые чаты сценария не на `toVersionId`. */
  chatIds?: string[];
  limit: number;
  at: string;
}

/** Поле карточки клиента: долгая память о человеке по всем его чатам. */
export interface ClientCardEntry {
  fieldId: string;
  value: unknown;
  updatedAt: string;
  /** Где узнали. */
  chatId: string;
  flowId: string;
}

/** Свободный факт о человеке («ведёт блог»): не поле сценария, а короткая фраза, которую агент записал сам. */
export interface ClientFact {
  /** Стабильный по тексту (`factId`): тот же факт — тот же id. */
  id: string;
  text: string;
  updatedAt: string;
  /** Где узнали. */
  chatId: string;
  flowId: string;
}

export interface WriteCardFieldInput {
  ownerId: string;
  fieldId: string;
  value: unknown;
  chatId: string;
  flowId: string;
  at: string;
}

/** Попытки попутной задачи: на человека (`chatId: null`) или на разговор. */
export interface SideTaskRecord {
  taskId: string;
  chatId: string | null;
  /** Сколько раз агент предложил. */
  asks: number;
  doneAt: string | null;
}

export interface NoteSideTaskInput {
  ownerId: string;
  taskId: string;
  /** `null` — попытки на человека; id чата — у задач «заново в каждом разговоре». */
  chatId: string | null;
  status: "asked" | "done";
  at: string;
}

export interface FlowStore {
  /**
   * Хранилище исполняет условия ограды (с 0.81): `setDue(…, { leaseOwner })` пишет, только пока аренда у этой копии;
   * `swapDelivery` — с `expected`, `claim`, `freeAt` и `endedAt` одной атомарной операцией; `leaseDue` не берёт живую аренду;
   * `endChat` не снимает срок и аренду ждущей доставки. Без этого признака `createAgentFlow` не запускается.
   */
  readonly guarded: true;
  /** Закрепить версию за чатом. Чат уже закреплён — вернуть как есть, ничего не менять. */
  pinChat(input: PinFlowChatInput): Promise<FlowChatRecord>;
  getChat(chatId: string): Promise<FlowChatRecord | null>;
  updateChat(chatId: string, patch: FlowChatPatch, at: string): Promise<FlowChatRecord | null>;
  deleteChat(chatId: string): Promise<void>;

  /** Новый ключ — в конец; тот же ключ — не дублируется, но `appliedAt` дописывается к ожидающему без него. */
  addPending(chatId: string, change: PendingFlowChange): Promise<void>;
  /** Забрать всё ожидающее, в порядке добавления, и очистить; переходы, применённые в срок (`appliedAt`), остаются. */
  takePending(chatId: string): Promise<PendingFlowChange[]>;

  /** `null` — таймеров нет. Снимает аренду. */
  setDue(chatId: string, due: FlowDueInput | null, options?: SetDueOptions): Promise<void>;
  /**
   * Взять в аренду наступившие таймеры, которые никто не держит; ранние — первыми. Стоящие на паузе — пропустить;
   * законченные — тоже, кроме срока повтора доставки (`FLOW_DELIVERY_EXIT`).
   */
  leaseDue(input: LeaseDueInput): Promise<FlowChatRecord[]>;
  releaseLease(chatId: string, owner: string): Promise<void>;
  /** Продлить свою аренду до `now + leaseMs`. `false` — строка уже не наша: взяла другая копия или срок переписан. */
  renewLease(input: RenewLeaseInput): Promise<boolean>;

  saveVersion(input: Omit<SavedFlowVersion, "createdAt"> & { at: string }): Promise<SaveFlowVersionResult>;
  getVersion(flowId: string, versionId: string): Promise<SavedFlowVersion | null>;

  countChatsByState(input: { flowId: string }): Promise<ChatsInState[]>;
  /** Чаты сценария по порядку id: для отбора перед подсчётом и переводом. */
  listFlowChats(input: ListFlowChatsInput): Promise<FlowChatSummary[]>;
  /** Перевести до `limit` чатов на версию `toVersionId`: версия меняется сразу, перевод состояния — ожидающим `migrate`. */
  migrateBatch(input: MigrateBatchInput): Promise<{ moved: string[] }>;

  readCard(ownerId: string): Promise<ClientCardEntry[]>;
  writeCardField(input: WriteCardFieldInput): Promise<void>;
  forgetCard(ownerId: string, fieldId: string | "all"): Promise<void>;

  /** Сколько сообщений агент написал первым за сутки человека (`day` — «ГГГГ-ММ-ДД» в его поясе). */
  countFirstMessages(ownerId: string, day: string): Promise<number>;
  /** Записать ещё одно; вернуть новый счёт. */
  addFirstMessage(ownerId: string, day: string): Promise<number>;

  /**
   * Разговор закончен: ставит время и причину, снимает таймер и аренду. Ждёт доставка — её срок и аренда остаются: идущую
   * отправку не перебить, повтор после конца дойдёт. Уже закончен — ничего не меняет.
   */
  endChat(chatId: string, input: { reason: FlowEndReason; at: string }): Promise<FlowChatRecord | null>;
  /**
   * Открыть законченный разговор заново: только если он всё ещё закончен в `endedAt` (что прочитал вызывающий). Снимает
   * конец, ставит `reopenedAt`. Не тот конец, не закончен или чата нет — `null`: из двух копий открывает одна. С 0.68.
   */
  reopenChat(chatId: string, input: { endedAt: string; at: string }): Promise<FlowChatRecord | null>;
  /** `null` — снять паузу. */
  setPause(chatId: string, until: string | null): Promise<FlowChatRecord | null>;
  setWindowClosed(chatId: string, closed: boolean): Promise<void>;
  setDayClosed(chatId: string, day: string | null): Promise<void>;
  setDelivery(chatId: string, delivery: FlowPendingDelivery | null): Promise<void>;
  /** Заменить запись доставки, если она та, что ждали (`SwapDeliveryInput`). `true` — заменил этот вызов. С 0.81. */
  swapDelivery(chatId: string, input: SwapDeliveryInput): Promise<boolean>;

  /** Пояс человека (IANA); `null` — неизвестен. Общий для всех его чатов. */
  readTimeZone(ownerId: string): Promise<string | null>;
  writeTimeZone(ownerId: string, timeZone: string, at: string): Promise<void>;

  /** Попытки попутных задач человека: на человека и в этом разговоре. По `taskId`. */
  readSideTasks(ownerId: string, chatId: string): Promise<SideTaskRecord[]>;
  /** `asked` — ещё одна попытка, `done` — задача решена. Вернуть запись после изменения. */
  noteSideTask(input: NoteSideTaskInput): Promise<SideTaskRecord>;
  /** «Забудь обо мне»: стереть все попытки попутных задач человека — и на него, и на его разговоры. */
  forgetSideTasks(ownerId: string): Promise<void>;

  /** Остановка сервера: SQLite закрывает файл, PostgreSQL дожидается миграции (пул приложения не закрывает). */
  close?(): Promise<void>;
}
