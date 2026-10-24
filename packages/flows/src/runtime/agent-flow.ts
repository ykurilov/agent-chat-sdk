import { FLOW_SERVICE_BLOCKS } from "./flow-service-blocks";
import { confirmationHash, createConfirmations, type FlowRevokeConfirmationInput, type FlowRevokeConfirmationResult } from "./confirmations";
import { judgeConfirmations } from "./confirmation-judge";
import { previewConfirmedMigration } from "./confirmation-migration";
import { createHash, randomUUID } from "node:crypto";
import {
  ChatNotFoundError,
  flowStateCommitter,
  type AgentWidgetSettings,
  type Chat,
  type ChatInstructionsTurn,
  type ContextBlockEntry,
  type ModelCatalog,
  type PrepareTurnContext,
  type TurnResult,
  type WidgetAnswerContext,
} from "@ykurilov/agent-chat-core";
import type { AgentFlow } from "../format/flow-format";
import { turnToolNames } from "./turn-tool-names";
import { FLOW_APP_NOTICE_VIEWS } from "./notice-screen";
import { parseFlow } from "../format/parse-flow";
import { checkFlow } from "../check/check-flow";
import { FLOW_STATE_KEY, type FlowRun, type Transition } from "../engine/flow-run";
import { isFinal, stateById } from "../engine/flow-graph";
import { migrateRun, type StateMap } from "../engine/migrate-run";
import type { FlowChatRecord, SaveFlowVersionResult } from "../store/flow-store";
import { dayInProgress, deadlineAt, flowDay, withDayAnchor } from "../engine/flow-days";
import { localDay } from "../engine/zoned-time";
import { nextTransition } from "../engine/next-transition";
import { FLOW_RULE_PARTS, flowRules } from "../prompt/flow-rules";
import { clientFactsRules } from "../prompt/rules/client-facts";
import { afterEndRules } from "../prompt/rules/after-end";
import { judgeExits, stateCard, stateGoal } from "../prompt/state-card";
import type {
  AgentFlowHandle,
  AgentFlowOptions,
  ChatMigrator,
  ClientCardTools,
  FirstMessageRules,
  FlowAdoptInput,
  FlowAttachment,
  FlowEndInput,
  FlowReopenInput,
  FlowReopenResult,
  FlowChatOptions,
  FlowJudge,
  FlowJudgeEntry,
  FlowPort,
  FlowRunView,
  FlowTimers,
  JudgeMessage,
  LoadedFlow,
} from "./flow-types";
import { createClientCard } from "./client-card";
import { createChatTimeZones, createFirstMessageRules, createFlowTimeZones, ianaTimeZone, pageTimeZone, UNKNOWN_TIME_ZONE } from "./first-message-rules";
import { createFlowJudge } from "./judge";
import { createFlowTimers, DEFAULT_TIMER_LEASE_MS } from "./flow-timers";
import { createChatMigrator } from "./migrate-chats";
import { sendFlowSignal } from "./flow-signals";
import { withFlowKnownTexts } from "./flow-known-texts";
import { flowPrepareTurn } from "./prepare-turn";
import { withFlowTools } from "./flow-tools";
import { withStepTail } from "./step-tail";
import { createFlowAdmit } from "./admit";
import { flowTurnGate } from "./turn-gate";
import { createFlowPause } from "./pause";
import { createFlowDelivery } from "./flow-delivery";
import { createFlowFinish, endedRun } from "./flow-finish";
import { advanceTestClock, chatTime } from "./test-clock";
import {
  advance,
  chainLimitMessage,
  chatRun,
  currentRun,
  exactFirstText,
  pendingEvent,
  reportTransition,
  runOutsideTurn,
  storedRun,
  withPending,
  withReopen,
  type ChatFlowRun,
  type FlowRuntime,
  type PinnedFlow,
} from "./flow-events";

/** Модули других частей сценария; тесты подменяют их подделками. Нет — создаются по настройкам при первом обращении. */
export interface FlowModules {
  judge?: FlowJudge;
  timers?: FlowTimers;
  firstMessages?: FirstMessageRules | null;
  clientCard?: ClientCardTools;
  migrator?: ChatMigrator;
}

export interface BuiltAgentFlow extends AgentFlowHandle {
  /** Дождаться фоновой работы: судья после хода, доставка точного первого текста, `onTransition`. Для тестов и остановки. */
  settled(): Promise<void>;
}

/** Последних реплик судье. */
const JUDGE_HISTORY = 6;
/** Паузы повторов доставки, когда чат ещё занят концом хода, мс. */
const DELIVERY_RETRY_MS = [50, 250, 1000, 3000];
/** Сколько чатов помнить для сборки инструментов без ожидания: дальше — самые старые забываются. */
const KNOWN_FLOWS_LIMIT = 10_000;
/** Сколько чатов помнить службы и места закрепления: дальше — самые старые забываются. */
const KNOWN_PORTS_LIMIT = 10_000;
/** Проверка, которую сервер сделать не может: имена кнопок и событий приложение объявляет редактору, а не серверу. */
const SERVER_UNKNOWN_CODES = new Set(["unknown_event"]);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** JSON с ключами по порядку: отпечаток версии не зависит от порядка полей. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    return `{${entries
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Текст сообщения истории для судьи: только текстовые части. */
function judgeMessages(messages: ReadonlyArray<{ role: string; parts: readonly unknown[] }>): JudgeMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = message.parts
      .flatMap((part) => ((part as { type?: string }).type === "text" ? [(part as { text: string }).text] : []))
      .join("\n")
      .trim();
    return text ? [{ role: message.role === "user" ? ("human" as const) : ("agent" as const), text }] : [];
  });
}

type HistoryMessage = { id?: string; role: string; parts: readonly unknown[] };

/**
 * Реплики для судьи после хода — по истории ветки, от ответа агента, на котором вошли в текущее состояние (на что
 * человек отвечает), до ответа этого хода. Сказанное раньше уже судили по условиям прошлого состояния: «А адрес обязательно
 * латиницей?» из «Публикации» — не «спросил про свой домен» в «Доработке». Судья идёт в фоне: человек мог уже написать
 * дальше — это судит следующий ход. А пока ход не закрыт, история прячет его ответ — он берётся из итога хода. Отметки
 * входа нет или её ответа нет в ветке (правка, другая ветка) — последние реплики, как раньше.
 */
function turnWindow(messages: readonly HistoryMessage[], run: FlowRun, answer: { id: string; parts: readonly unknown[] }): readonly HistoryMessage[] {
  const answerAt = messages.findIndex((message) => message.id === answer.id);
  const upToAnswer = answerAt >= 0 ? messages.slice(0, answerAt + 1) : [...messages, { role: "assistant", parts: answer.parts }];
  const enteredAt = run.enteredAfterAnswer === undefined ? -1 : upToAnswer.findIndex((message) => message.id === run.enteredAfterAnswer);
  return enteredAt >= 0 ? upToAnswer.slice(enteredAt) : upToAnswer;
}

/** Сборка сценария с подменяемыми модулями. Приложению — `createAgentFlow`. */
export function buildAgentFlow(options: AgentFlowOptions, modules: FlowModules = {}): BuiltAgentFlow {
  const { store } = options;
  // Условия хранилища (аренда, условная замена доставки) — договор, а не пожелание: без признака сценарий не запускается.
  if ((store as { guarded?: unknown } | undefined)?.guarded !== true) {
    throw new TypeError("createAgentFlow: хранилище сценариев без guarded: true — с 0.81 своё FlowStore должно выполнять условия setDue/swapDelivery/leaseDue/endChat (см. обновление 0.81)");
  }
  const clock = options.now ?? (() => new Date());
  const now = () => clock().getTime();
  const iso = () => clock().toISOString();
  const logError = options.logError ?? ((message: string) => console.error(message));
  const confirmations = createConfirmations(options.confirmations, options.exitGuards);
  const defaultTimeZone = options.defaultTimeZone === undefined ? undefined : ianaTimeZone(options.defaultTimeZone);
  if (defaultTimeZone === null) throw new TypeError(`createAgentFlow: defaultTimeZone «${options.defaultTimeZone}» — не пояс IANA`);

  let port: FlowPort | undefined;
  let attachment: FlowAttachment | undefined;
  // Службы чатов, уже названные `portFor`: приложение спрашивается один раз на чат (одновременные обращения ждут один ответ).
  // Перевод чатов на новую версию и новый `attach` забывают их; ответ, начатый до того, не запоминается.
  const ports = new Map<string, FlowPort>();
  const portLoads = new Map<string, Promise<FlowPort>>();
  let portsEpoch = 0;
  const forgetPorts = () => {
    ports.clear();
    portLoads.clear();
    portsEpoch += 1;
  };
  /** Служба чата этого разговора: одна на все чаты (`attach(service)`) или по `portFor`. */
  async function portOf(chat: { ownerId: string; chatId: string }): Promise<FlowPort> {
    if (!attachment) {
      if (!port) throw new Error("Сценарий не подключён к службе чата: вызовите flow.attach(service) после createChatServer");
      return port;
    }
    const known = ports.get(chat.chatId);
    if (known) return known;
    let load = portLoads.get(chat.chatId);
    if (!load) {
      const { portFor } = attachment;
      const epoch = portsEpoch;
      const started: Promise<FlowPort> = Promise.resolve()
        .then(() => portFor({ ownerId: chat.ownerId, chatId: chat.chatId }))
        .then((found) => {
          if (epoch === portsEpoch) {
            ports.set(chat.chatId, found);
            if (ports.size > KNOWN_PORTS_LIMIT) ports.delete(ports.keys().next().value!);
          }
          return found;
        })
        .finally(() => {
          if (portLoads.get(chat.chatId) === started) portLoads.delete(chat.chatId);
        });
      load = started;
      portLoads.set(chat.chatId, load);
    }
    return load;
  }

  /** Модуль создаётся при первом обращении: так части сценария не зависят друг от друга при сборке. */
  function lazy<T>(make: () => T): () => T {
    let made: { value: T } | undefined;
    return () => (made ??= { value: make() }).value;
  }
  /** Необязательный модуль: не собрался — строка в журнал один раз, дальше без него. */
  function optional<T>(name: string, make: () => T): () => T | null {
    return lazy(() => {
      try {
        return make();
      } catch (error) {
        logError(`[сценарий] ${name} недоступен: ${errorText(error)}`);
        return null;
      }
    });
  }

  const logJudge = options.logJudge ?? ((entry: FlowJudgeEntry) => console.info(`[сценарий] судья: ${JSON.stringify(entry)}`));
  const judge = lazy(() => modules.judge ?? createFlowJudge(options.judge, portOf, { logError, logJudge }));
  const firstMessages = lazy(() => (modules.firstMessages !== undefined ? modules.firstMessages : createFirstMessageRules(options.firstMessages, store)));
  // Пояс приложения (`agent.timeZone`, пояс лимитов) свой у каждой службы: его называет `withChat`, а чат относит к
  // службе `portFor`. Пока служба не сделала ни одного хода, берётся пояс последнего `withChat` (как в 0.48).
  let lastAppTimeZone: string | undefined;
  const portZones = new WeakMap<FlowPort, string>();
  const zoneTables = new Map<string, ReturnType<typeof createChatTimeZones>>();
  function zoneTable(appZone: string | undefined) {
    const key = appZone ?? "";
    let table = zoneTables.get(key);
    if (!table) {
      table = createChatTimeZones({ appTimeZone: () => appZone, ...(defaultTimeZone && { defaultTimeZone }), warn: logError });
      zoneTables.set(key, table);
    }
    return table;
  }
  /** Служба, которая ведёт чат, узнала свой пояс приложения. */
  async function noteAppZone(chat: { ownerId: string; chatId: string }, appZone: string | undefined): Promise<void> {
    try {
      portZones.set(await portOf(chat), appZone ?? "");
    } catch {
      // Службы ещё нет — пояс подхватит следующий ход.
    }
  }
  /** Пояс чата: известный со страницы, иначе пояс его службы, иначе сервера. */
  function timeZoneOf(chatId: string, stored: string): string {
    const chatPort = attachment ? ports.get(chatId) : port;
    const appZone = chatPort && portZones.has(chatPort) ? portZones.get(chatPort) || undefined : lastAppTimeZone;
    return zoneTable(appZone).of(chatId, stored);
  }
  // Пояс человека — один на все его разговоры (адаптер `people` или таблица модуля); пока неизвестен — пояс чата.
  const timeZones = createFlowTimeZones({ store, ...(options.people && { people: options.people }), fallback: (chatId) => timeZoneOf(chatId, UNKNOWN_TIME_ZONE), now });
  const timers = lazy(
    () =>
      modules.timers ??
      createFlowTimers({
        store,
        settings: options.timers ?? {},
        firstMessages: firstMessages(),
        port: portOf,
        logError,
        now: clock,
        flowOf: (record) => versionFlow(record.flowId, record.versionId),
        timeZoneOf,
        cardValues: (ownerId) => runtime.cardValues(ownerId),
        onDeadline: deadlineReached,
        onAppliedTransitions: ({ record, flow, run, transitions }) =>
          runtime.afterTransitions({ ownerId: record.ownerId, chatId: record.chatId, pinned: { flowId: record.flowId, versionId: record.versionId, flow }, run, transitions }),
        onGiveUp: async ({ record, flow, run, at }) => {
          await finish().end({ ownerId: record.ownerId, chatId: record.chatId, pinned: { flowId: record.flowId, versionId: record.versionId, flow }, run, reason: "abandoned", at });
        },
        delivery,
      }),
  );
  const optionalTimers = optional("таймеры", timers);
  const clientCard = optional("карточка клиента", () => modules.clientCard ?? createClientCard(store, clock, options.clientCard, logError, { facts: options.clientFacts === true }));
  const migrator = lazy(
    () =>
      modules.migrator ??
      createChatMigrator({
        store,
        now: clock,
        checkedFlow: (loaded) => checkedFlow(loaded.flowId, loaded.versionId, loaded.flow),
        saveVersion: saveChecked,
        rescheduleMigrated,
        chatData,
      }),
  );

  // Фоновая работа: судья после хода, доставка, `onTransition`. `settled` ждёт её.
  const background = new Set<Promise<unknown>>();
  function track(work: Promise<unknown>): void {
    const tracked = work.catch((error) => logError(`[сценарий] фоновая работа упала: ${errorText(error)}`)).finally(() => background.delete(tracked));
    background.add(tracked);
  }

  // ---------- Сценарий чата ----------

  // Сценарий чата, прочитанный в этом ходе: по нему инструменты собираются без ожидания.
  const known = new Map<string, PinnedFlow>();
  // Чаты, которым первый ход положил перенесённое место: после записи места запись переноса снимается.
  const placedNow = new Set<string>();
  function remember(chatId: string, pinned: PinnedFlow | null): PinnedFlow | null {
    known.delete(chatId);
    if (pinned) known.set(chatId, pinned);
    if (known.size > KNOWN_FLOWS_LIMIT) known.delete(known.keys().next().value!);
    return pinned;
  }

  const versions = new Map<string, Promise<AgentFlow | null>>();
  function versionFlow(flowId: string, versionId: string): Promise<AgentFlow | null> {
    const key = `${flowId}\u0000${versionId}`;
    let found = versions.get(key);
    if (!found) {
      found = store.getVersion(flowId, versionId).then((saved) => {
        if (!saved) return null;
        // Сохранённая версия не прошла проверку подтверждений приложения: чат идёт без сценария, а не падает каждым ходом.
        const problem = confirmationProblem(flowId, versionId, saved.flow);
        if (problem) logError(problem);
        return problem ? null : saved.flow;
      });
      versions.set(key, found);
      void found.then((flow) => flow ?? versions.delete(key), () => versions.delete(key));
    }
    return found;
  }

  /** Разобрать и проверить сценарий приложения: сценарий или текст ошибки. */
  function flowOrProblem(flowId: string, versionId: string, value: unknown): { flow: AgentFlow } | { problem: string } {
    const parsed = parseFlow(value);
    if (!parsed.ok) return { problem: `[сценарий] ${flowId}@${versionId} не разобран: ${parsed.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}` };
    // Инструменты состояний сверяются со списком инструментов самого сценария: нет инструмента у приложения — охрана
    // в ходе ответит модели «недоступно», чат не ломается.
    const catalog = { tools: parsed.flow.tools, events: [], widgets: [] };
    const errors = checkFlow(parsed.flow, catalog).filter((issue) => issue.level === "error" && !SERVER_UNKNOWN_CODES.has(issue.code));
    if (errors.length > 0) return { problem: `[сценарий] ${flowId}@${versionId} с ошибками, чат идёт без сценария: ${errors.map((issue) => issue.message).join("; ")}` };
    const problem = confirmationProblem(flowId, versionId, parsed.flow);
    return problem ? { problem } : { flow: parsed.flow };
  }

  /** Сценарий против подтверждений приложения (`exitGuards`): несовпадение — текст ошибки, иначе `null`. */
  function confirmationProblem(flowId: string, versionId: string, flow: AgentFlow): string | null {
    try {
      confirmations.validate(flowId, flow);
      return null;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return `[сценарий] ${flowId}@${versionId} не сходится с подтверждениями приложения, чат идёт без сценария: ${error.message}`;
    }
  }

  /** Разобрать и проверить сценарий приложения; с ошибками — `null` и строка в журнал. */
  function checkedFlow(flowId: string, versionId: string, value: unknown): AgentFlow | null {
    const checked = flowOrProblem(flowId, versionId, value);
    if ("flow" in checked) return checked.flow;
    logError(checked.problem);
    return null;
  }

  /** Сохранить копию версии. Под этим номером уже другой сценарий — остаётся сохранённый, строка в журнал. */
  async function saveChecked(loaded: LoadedFlow, flow: AgentFlow): Promise<SaveFlowVersionResult> {
    const saved = await store.saveVersion({ flowId: loaded.flowId, versionId: loaded.versionId, hash: createHash("sha256").update(stableJson(flow)).digest("hex"), flow, at: iso() });
    if (saved === "conflict") logError(`[сценарий] ${loaded.flowId}@${loaded.versionId}: под этим номером уже сохранён другой сценарий, чат идёт по сохранённому`);
    return saved;
  }

  const pinning = new Map<string, Promise<PinnedFlow | null>>();

  async function pin(ownerId: string, chat: Chat): Promise<PinnedFlow | null> {
    const loaded = await options.loadFlow({ ownerId, chat });
    if (!loaded) return null;
    const pinned = await pinLoaded(ownerId, chat.id, loaded, (problem) => logError(problem));
    return pinned?.pinned ?? null;
  }

  /**
   * Закрепить чат за сценарием из `loadFlow` или `adopt`. Перенос хранится в записи чата: до первого хода он переживает
   * перезапуск сервера. Счёт дня старой системы ложится в счётчики сразу. Ошибка — в `fail`, чат без сценария.
   */
  async function pinLoaded(ownerId: string, chatId: string, loaded: LoadedFlow, fail: (problem: string) => void): Promise<{ pinned: PinnedFlow; record: FlowChatRecord } | null> {
    const checked = flowOrProblem(loaded.flowId, loaded.versionId, loaded.flow);
    if ("problem" in checked) return void fail(checked.problem), null;
    const { flow } = checked;
    if (loaded.stateId !== undefined && !stateById(flow, loaded.stateId)) {
      return void fail(`[сценарий] чат=${chatId}: состояния «${loaded.stateId}» нет в ${loaded.flowId}@${loaded.versionId}, чат идёт без сценария`), null;
    }
    // Под номером уже сохранён другой сценарий — чат пойдёт по сохранённому: его проверка тоже до закрепления.
    if ((await saveChecked(loaded, flow)) === "conflict" && !(await versionFlow(loaded.flowId, loaded.versionId))) {
      return void fail(`[сценарий] чат=${chatId}: сохранённая версия ${loaded.flowId}@${loaded.versionId} не прошла проверку, чат идёт без сценария`), null;
    }
    const at = now();
    const startedAt = loaded.startedAt ?? new Date(at);
    const { lastHumanAt, lastAgentAt, nudgeStep, today } = loaded;
    const humanToday = flow.schedule && today?.humanMessages !== undefined ? { at: iso(), count: today.humanMessages } : undefined;
    const moved =
      loaded.stateId !== undefined ||
      loaded.startedAt !== undefined ||
      loaded.enteredAt !== undefined ||
      lastHumanAt !== undefined ||
      lastAgentAt !== undefined ||
      nudgeStep !== undefined ||
      humanToday !== undefined;
    const record = await store.pinChat({
      chatId,
      ownerId,
      flowId: loaded.flowId,
      versionId: loaded.versionId,
      stateId: loaded.stateId ?? flow.start!,
      // Пояс узнаёт первый ход со страницы; до того — пояс приложения или сервера (→ В10).
      timeZone: loaded.timeZone ?? UNKNOWN_TIME_ZONE,
      ...(moved && {
        placement: {
          startedAt: startedAt.toISOString(),
          enteredAt: (loaded.enteredAt ?? startedAt).toISOString(),
          ...(lastHumanAt && { lastHumanAt: lastHumanAt.toISOString() }),
          ...(lastAgentAt && { lastAgentAt: lastAgentAt.toISOString() }),
          ...(nudgeStep !== undefined && { nudgeStep }),
          ...(humanToday && { humanToday }),
        },
      }),
      at: iso(),
    });
    const pinnedFlow = await versionFlow(record.flowId, record.versionId);
    if (!pinnedFlow) return null;
    if (loaded.timeZone) await timeZones.write(ownerId, chatId, loaded.timeZone);
    await carryToday(ownerId, chatId, pinnedFlow, today, at);
    return { pinned: { flowId: record.flowId, versionId: record.versionId, flow: pinnedFlow }, record };
  }

  /** Что уже было сегодня в старой системе: сообщения первым — в потолок дня (без двойного счёта), закрытый день. */
  async function carryToday(ownerId: string, chatId: string, flow: AgentFlow, today: LoadedFlow["today"], at: number): Promise<void> {
    const closed = Boolean(today?.dayClosed && flow.schedule);
    if (!today?.firstMessages && !closed) return;
    const timeZone = await timeZones.of(ownerId, chatId);
    if (today?.firstMessages) {
      const day = localDay(at, timeZone);
      for (let sent = await store.countFirstMessages(ownerId, day); sent < today.firstMessages; sent += 1) await store.addFirstMessage(ownerId, day);
    }
    if (closed) await store.setDayClosed(chatId, dayInProgress(at, timeZone, flow.schedule!));
  }

  /** `flow.adopt`: закрепить идущий чат сразу и поставить срок касаний. Закрепление и `loadFlow` одного чата — по очереди. */
  async function adopt(input: FlowAdoptInput): Promise<{ adopted: boolean }> {
    const { ownerId, chatId } = input;
    const busy = pinning.get(chatId);
    if (busy) await busy.catch(() => null);
    if (await store.getChat(chatId)) return { adopted: false };
    const work = pinLoaded(ownerId, chatId, input, (problem) => {
      throw new Error(problem);
    });
    const pinned = work.then((result) => result?.pinned ?? null, () => null);
    pinning.set(chatId, pinned);
    let result: Awaited<typeof work>;
    try {
      result = await work;
    } finally {
      if (pinning.get(chatId) === pinned) pinning.delete(chatId);
    }
    if (!result) return { adopted: false };
    remember(chatId, result.pinned);
    await reschedule(ownerId, chatId, await runOutsideTurn(runtime, { ownerId, chatId }, result.pinned.flow, undefined, now(), result.record), null);
    return { adopted: true };
  }

  /**
   * Срок программы вышел, а таймер не сработал (сервер стоял, чат перенесён со сроком в прошлом): разговор закрывается
   * до хода — его инструкция уже «после конца». Без срока, закрытый или без места — как есть.
   */
  async function closeOverdue(ownerId: string, chatId: string, pinned: PinnedFlow): Promise<PinnedFlow> {
    const schedule = pinned.flow.schedule;
    if (pinned.ended || schedule?.lengthDays === undefined) return pinned;
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    let run: ChatFlowRun | null = storedRun(values[FLOW_STATE_KEY]);
    if (!run) {
      const record = await store.getChat(chatId);
      if (!record?.placement) return pinned;
      run = await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, now(), record);
    }
    const timeZone = await timeZones.of(ownerId, chatId);
    run = withDayAnchor(run, timeZone, schedule);
    const deadline = deadlineAt(run, timeZone, schedule);
    if (deadline === null || deadline > chatTime(run, now())) return pinned;
    await finish().deadline({ ownerId, chatId, pinned, run, at: deadline, timeZone });
    return remember(chatId, { ...pinned, ended: true })!;
  }

  /** Таймер «срок вышел»: конец разговора, затем прощание по правилам «писать первым» (→ В5). */
  async function deadlineReached({ record, flow, run, at, timeZone }: { record: FlowChatRecord; flow: AgentFlow; run: ChatFlowRun; at: number; timeZone: string }): Promise<void> {
    const { ownerId, chatId } = record;
    const pinned: PinnedFlow = { flowId: record.flowId, versionId: record.versionId, flow };
    const { ended } = await finish().deadline({ ownerId, chatId, pinned, run, at, timeZone });
    remember(chatId, { ...pinned, ended: true });
    if (ended) await finish().farewell({ ownerId, chatId, pinned, run, at, timeZone, port: await portOf(record), firstMessages: firstMessages(), delivery: delivery() });
  }

  async function chatFlow(ownerId: string, chatId: string, chat?: Chat): Promise<PinnedFlow | null> {
    const record = await store.getChat(chatId);
    if (record) {
      const flow = await versionFlow(record.flowId, record.versionId);
      if (!flow) logError(`[сценарий] чат=${chatId}: версии ${record.flowId}@${record.versionId} нет в хранилище`);
      return remember(chatId, flow ? { flowId: record.flowId, versionId: record.versionId, flow, ...(record.endedAt !== null && { ended: true }) } : null);
    }
    if (!chat) return null;
    let pinned = pinning.get(chatId);
    if (!pinned) {
      pinned = pin(ownerId, chat).finally(() => pinning.delete(chatId));
      pinning.set(chatId, pinned);
    }
    return remember(chatId, await pinned);
  }

  const runtime: FlowRuntime = {
    confirmations,
    store,
    now,
    logError,
    track,
    chatFlow,
    timeZones,
    ...(defaultTimeZone && { defaultTimeZone }),
    async cardValues(ownerId) {
      // Карточка у приложения (`options.clientCard`): читаем её, а не свою таблицу. Сбой его хранилища не рвёт ход.
      const app = options.clientCard ? clientCard() : null;
      try {
        const entries = await (app ? app.read(ownerId) : store.readCard(ownerId));
        return Object.fromEntries(entries.map((entry) => [entry.fieldId, entry.value]));
      } catch (error) {
        if (!app) throw error;
        logError(`[сценарий] карточка клиента не прочитана: ${errorText(error)}`);
        return {};
      }
    },
    async afterTransitions({ ownerId, chatId, pinned, run, transitions }) {
      if (transitions.length === 0) return;
      try {
        await store.updateChat(chatId, { stateId: run.state }, iso());
      } catch (error) {
        logError(`[сценарий] чат=${chatId} состояние не записано в хранилище: ${errorText(error)}`);
      }
      // День сценария в событии — по поясу человека на момент перехода.
      const { schedule } = pinned.flow;
      const timeZone = schedule ? await timeZones.of(ownerId, chatId) : null;
      for (const transition of transitions) {
        const day = schedule && timeZone ? flowDay(run, transition.at, timeZone, schedule) : undefined;
        track(reportTransition(options.onTransition, { ...transition, ownerId, chatId, flowId: pinned.flowId, versionId: pinned.versionId, ...(day && { day }) }, logError));
      }
      await finish().afterTransitions({ ownerId, chatId, pinned, run, transitions });
    },
  };

  // Части этапов «Дни и время», «Пишет первым», «Рамки дня и пауза»: каждая в своём модуле.
  const finish = lazy(() => createFlowFinish({ runtime, ...(options.onFinish && { onFinish: options.onFinish }) }));
  const admit = lazy(() => createFlowAdmit({ runtime, port: portOf }));
  const pauses = lazy(() => createFlowPause({ runtime, settings: options.pause ?? {}, port: portOf }));
  const delivery = lazy(() =>
    createFlowDelivery({
      runtime,
      deliver: () => attachment?.deliver,
      leaseMs: options.timers?.leaseMs ?? DEFAULT_TIMER_LEASE_MS,
      port: portOf,
      finish,
      firstMessages,
      timeZoneOf: (ownerId, chatId) => timeZones.of(ownerId, chatId),
      recount: recountFromState,
    }),
  );

  /** Последние реплики для судьи; `turn` — судья после хода: окно хода (`turnWindow`). */
  async function history(ownerId: string, chatId: string, turn?: { run: FlowRun; answer: { id: string; parts: readonly unknown[] } }): Promise<JudgeMessage[]> {
    const { messages } = await (await portOf({ ownerId, chatId })).peekHistory(ownerId, chatId);
    return judgeMessages(turn ? turnWindow(messages, turn.run, turn.answer) : messages).slice(-JUDGE_HISTORY);
  }

  async function reschedule(ownerId: string, chatId: string, run: FlowRun, branchHead: string | null, failedAt?: number): Promise<void> {
    try {
      await optionalTimers()?.reschedule({ ownerId, chatId, run, branchHead, ...(failedAt !== undefined && { failedAt }) });
    } catch (error) {
      logError(`[сценарий] чат=${chatId} таймер не пересчитан: ${errorText(error)}`);
    }
  }

  /**
   * Сроки по месту из состояния: доставка закончилась. Касание не дошло (FR-309) — не засчитано, сроки не раньше отказа
   * `failedAt`.
   */
  async function recountFromState({ ownerId, chatId, failedAt }: { ownerId: string; chatId: string; failedAt?: number }): Promise<void> {
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    const run = storedRun(values[FLOW_STATE_KEY]);
    if (run) await reschedule(ownerId, chatId, run, run.answerId ?? null, failedAt);
  }

  /** Данные чата для отбора при переводе. Служба не подключена или чата в ней уже нет — пусто. */
  async function chatData(chat: { ownerId: string; chatId: string }): Promise<Record<string, unknown>> {
    if (!port && !attachment) return {};
    try {
      return await (await portOf(chat)).getChatData(chat.ownerId, chat.chatId);
    } catch (error) {
      if (error instanceof ChatNotFoundError) return {};
      throw error;
    }
  }

  /** Таймер переведённого чата считается по новой версии и новому месту: само место чат запишет в начале следующего хода. */
  async function rescheduleMigrated({ record, flow, map }: { record: FlowChatRecord; flow: AgentFlow; map: StateMap }): Promise<void> {
    try {
      const { values } = await (await portOf(record)).getChatState(record.ownerId, record.chatId);
      // Перенесённый чат до первого хода — с места из записи переноса; новый чат — сроков ещё нет.
      const run = storedRun(values[FLOW_STATE_KEY]) ?? (record.placement ? await runOutsideTurn(runtime, record, flow, values, now(), record) : null);
      if (!run) return;
      await reschedule(record.ownerId, record.chatId, migrateRun(run, flow, map, chatTime(run, now())), run.answerId ?? null);
    } catch (error) {
      logError(`[сценарий] чат=${record.chatId} таймер не пересчитан: ${errorText(error)}`);
    }
  }

  // ---------- Судья после хода ----------

  async function deliverFirstText(ownerId: string, chatId: string, messageId: string, condition: string, text: string, guarded = false): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await (await portOf({ ownerId, chatId })).deliverNotices({
        ownerId,
        chatId,
        notices: [{ kind: "app", name: "flow_judge", title: `Проверка разговора: ${condition}` }],
        wakeAgent: true,
        deliveryKey: `flow:${chatId}:judge:${messageId}`,
        // Guarded decision может быть отозван после judge: готовый reply обошёл бы результат prepareTurn.
        ...(!guarded && { reply: { text } }),
      });
      if (result.status !== "busy") return;
      // Чат занят: заканчивается этот же ход или человек уже пишет — тогда переход применит его ход.
      if (attempt >= DELIVERY_RETRY_MS.length) return;
      await pause(DELIVERY_RETRY_MS[attempt]!);
    }
  }

  async function judgeAfterTurn(result: TurnResult): Promise<void> {
    const { ownerId, chatId, messageId } = result;
    const pinned = await chatFlow(ownerId, chatId);
    if (!pinned) return;
    const service = await portOf({ ownerId, chatId });
    const { values, atMessageId } = await service.getChatState(ownerId, chatId);
    const run = storedRun(values[FLOW_STATE_KEY]);
    // Ветку уже сменили или ход не записал место — судить нечего.
    if (!run || run.answerId !== messageId) return;
    await clearPlacement(chatId);
    await reschedule(ownerId, chatId, run, messageId);
    // После конца разговора переходов нет: судить нечего.
    if (pinned.ended || run.endedAt !== undefined) return;

    if (result.status !== "complete" || result.trigger === null || result.trigger === "notice") return;
    // Переход уже был в этом ответе (заявка, данные, кнопка): судья не нужен.
    if (run.chain > 0) return;
    const state = stateById(pinned.flow, run.state);
    if (!state || isFinal(state)) return;
    const conditions = judgeExits(pinned.flow, run.state);
    const withConfirmations = confirmations.forState(pinned.flowId, run.state).length > 0 || conditions.some(({ exitId }) => confirmations.guardFor(pinned.flowId, run.state, exitId));
    if (conditions.length === 0 && !withConfirmations) return;
    if (withConfirmations) {
      const checked = await judgeConfirmations({ confirmations, pinned, run, result, port: service, atMessageId, judge: judge(), threshold: options.judge.threshold ?? 0.7,
        now: chatTime(run, now()), conditions, goal: stateGoal(state.instructions), messages: await history(ownerId, chatId, { run, answer: { id: messageId, parts: result.parts } }) });
      if (!checked.saved || !checked.transition) return;
      const transition = checked.transition;
      if (!confirmations.guardFor(pinned.flowId, run.state, transition.exitId)) await store.addPending(chatId, { kind: "transition", key: `judge:${messageId}`, transition, branchHead: messageId });
      const first = exactFirstText(pinned.flow, transition.to);
      if (first) await deliverFirstText(ownerId, chatId, messageId, conditions.find((item) => item.exitId === transition.exitId)!.text, first, Boolean(confirmations.guardFor(pinned.flowId, run.state, transition.exitId)));
      return;
    }

    const verdicts = await judge().checkAll({
      ownerId,
      chatId,
      goal: stateGoal(state.instructions),
      conditions,
      messages: await history(ownerId, chatId, { run, answer: { id: messageId, parts: result.parts } }),
      // Сдвиг часов есть только у тестового чата редактора.
      ...(run.timeOffset !== undefined && { testChat: true }),
    });
    const met = conditions.map(({ exitId }) => verdicts.find((verdict) => verdict.exitId === exitId && verdict.confirmed)).find(Boolean);
    if (!met) return;
    const transition = nextTransition(pinned.flow, run, { type: "verdict", exitId: met.exitId, probability: met.probability, decidedBy: "judge" }, chatTime(run, now()));
    if (!transition) return;
    await store.addPending(chatId, { kind: "transition", key: `judge:${messageId}`, transition, branchHead: messageId });
    const first = exactFirstText(pinned.flow, transition.to);
    if (first) await deliverFirstText(ownerId, chatId, messageId, conditions.find((item) => item.exitId === met.exitId)!.text, first);
  }

  // ---------- Кнопки виджетов ----------

  async function revokeConfirmation(input: FlowRevokeConfirmationInput): Promise<FlowRevokeConfirmationResult> {
    if (!input.reason?.trim() || input.reason.length > 1000) throw new TypeError("revokeConfirmation: reason — непустая строка до 1000 знаков");
    if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 180) throw new TypeError("revokeConfirmation: idempotencyKey — непустая строка до 180 знаков");
    const pinned = await chatFlow(input.ownerId, input.chatId);
    if (!pinned || pinned.flowId !== input.flowId) return { status: "not_found" };
    const spec = confirmations.specFor(input.flowId, input);
    if (!spec) return { status: "stale" };
    const service = await portOf(input);
    const commit = flowStateCommitter(service);
    if (!commit) throw new Error("confirmations: служба чата не предоставляет внутреннюю flows capability");
    const snapshot = await service.getChatState(input.ownerId, input.chatId);
    const run = storedRun(snapshot.values[FLOW_STATE_KEY]);
    if (!run) return { status: "not_found" };
    const old = run.confirmations?.[spec.key];
    if (old && (old.scope?.ownerId !== input.ownerId || old.scope.chatId !== input.chatId || old.scope.flowId !== input.flowId)) return { status: "stale" };
    if (old?.status === "revoked" && old.operationKey === input.idempotencyKey) {
      if (old.reason !== input.reason || old.revision !== input.revision) throw new TypeError("revokeConfirmation: idempotencyKey уже использован с другим payload");
      return { status: "same", atMessageId: snapshot.atMessageId! };
    }
    if (snapshot.atMessageId !== input.expectedAtMessageId || (old && (old.revision !== spec.revision || old.criterionHash !== confirmationHash(spec)))) return { status: "stale" };
    const scope = { ownerId: input.ownerId, chatId: input.chatId, flowId: input.flowId };
    const { checkedTransition, ...withoutDecision } = run;
    const next: FlowRun = { ...withoutDecision, ...(checkedTransition && checkedTransition.requires.key !== spec.key && { checkedTransition }), confirmations: { ...run.confirmations,
      [spec.key]: { key: spec.key, revision: spec.revision, status: "revoked", versionId: pinned.versionId, scope, criterionHash: confirmationHash(spec), revokedAt: chatTime(run, now()), afterMessageId: run.answerId ?? null, reason: input.reason, operationKey: input.idempotencyKey } } };
    return commit({ ...scope, revision: confirmations.revision(input.flowId), expectedAtMessageId: input.expectedAtMessageId, idempotencyKey: `revoke:${input.idempotencyKey}`, flow: next as unknown as Record<string, unknown> });
  }

  async function buttonPressed(context: WidgetAnswerContext): Promise<void> {
    const pinned = await chatFlow(context.ownerId, context.chatId);
    if (!pinned) return;
    const transitions: Transition[] = [];
    const card = await runtime.cardValues(context.ownerId);
    const run = currentRun(pinned.flow, { [FLOW_STATE_KEY]: context.state.get(FLOW_STATE_KEY) }, now());
    const next = advance(pinned.flow, run, { type: "event", event: "button", name: context.toolName }, {
      now: chatTime(run, now()),
      timeZone: await timeZones.of(context.ownerId, context.chatId),
      card,
      out: transitions,
      onChainLimit: (stopped) => logError(chainLimitMessage(context.chatId, stopped)),
    });
    if (transitions.length === 0) return;
    context.state.set(FLOW_STATE_KEY, next);
    await runtime.afterTransitions({ ownerId: context.ownerId, chatId: context.chatId, pinned, run: next, transitions });
  }

  const refused = (verdict: unknown) => Boolean(verdict && typeof verdict === "object" && "refuse" in verdict);

  function withButtons(widgets: AgentWidgetSettings | undefined): AgentWidgetSettings | undefined {
    if (!widgets) return undefined;
    return {
      ...widgets,
      checkAnswer: async (call, answer, context) => {
        const verdict = await widgets.checkAnswer?.(call, answer, context);
        if (!refused(verdict)) await buttonPressed(context);
        return verdict;
      },
      ...(widgets.custom && {
        custom: widgets.custom.map((widget) => {
          const own = widget.checkAnswer;
          if (!own) return widget;
          return {
            ...widget,
            checkAnswer: async (answer: unknown, context: WidgetAnswerContext) => {
              const verdict = await own.call(widget, answer, context);
              if (!refused(verdict)) await buttonPressed(context);
              return verdict;
            },
          };
        }),
      }),
    };
  }

  // ---------- Конец по решению приложения ----------

  async function end({ ownerId, chatId, reason, outcome }: FlowEndInput): Promise<{ ended: boolean }> {
    if (!reason.trim()) throw new Error("flow.end: reason — непустая строка");
    const pinned = await chatFlow(ownerId, chatId);
    if (!pinned || pinned.ended) return { ended: false };
    const record = await store.getChat(chatId);
    if (!record || record.ownerId !== ownerId) return { ended: false };
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    const run = await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, now(), record);
    // Ждущий повтор доставки после конца не нужен.
    await store.setDelivery(chatId, null);
    const at = chatTime(run, now());
    const result = await finish().end({ ownerId, chatId, pinned, run, reason, ...(outcome !== undefined && { outcome }), at });
    // Открыт заново, пока дочищали, — в памяти уже открытый: «закончен» поверх не пишем.
    if (result.ended && (await dropDeliveryAfterEnd(chatId, new Date(at).toISOString()))) remember(chatId, { ...pinned, ended: true });
    return result;
  }

  /**
   * Отправка, записанная, пока разговор ещё не закончился, снимается вместе со сроком — одной заменой и только пока конец
   * тот же: открытый заново разговор (`flow.reopen`) не трогается. Замена не прошла — запись сменила другая операция:
   * читаем снова. После конца новая отправка не запишется (`endedAt` в `swapDelivery`), так что повторов немного.
   * `false` — конец уже не этот.
   */
  async function dropDeliveryAfterEnd(chatId: string, endedAt: string): Promise<boolean> {
    const sameEnd = (record: FlowChatRecord | null): record is FlowChatRecord => record !== null && record.endedAt !== null && Date.parse(record.endedAt) === Date.parse(endedAt);
    for (let record = await store.getChat(chatId); sameEnd(record); record = await store.getChat(chatId)) {
      if (await store.swapDelivery(chatId, { expected: record.delivery, next: null, due: null, endedAt })) return true;
    }
    return false;
  }

  // ---------- Открыть заново ----------

  /** Концы, после которых разговор не открывается: дошёл до конца, срок вышел, канал заблокирован. */
  const CLOSED_FOR_GOOD = new Set(["final", "deadline", "blocked"]);

  async function reopen({ ownerId, chatId, reason, endedAfter }: FlowReopenInput): Promise<FlowReopenResult> {
    const pinned = await chatFlow(ownerId, chatId);
    const record = await store.getChat(chatId);
    if (!pinned || !record || record.ownerId !== ownerId) return { reopened: false, reason: "not_flow" };
    if (record.endedAt === null) return { reopened: false, reason: "not_ended" };
    const endReason = record.endReason ?? "final";
    if (CLOSED_FOR_GOOD.has(endReason)) return { reopened: false, reason: endReason as "final" | "deadline" | "blocked" };
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    const run = await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, now(), record);
    const at = chatTime(run, now());
    // Конец записан по часам чата; `endedAfter` — по часам сервера.
    if (endedAfter && Date.parse(record.endedAt) - (run.timeOffset ?? 0) < endedAfter.getTime()) return { reopened: false, reason: "ended_too_long_ago" };
    const timeZone = await timeZones.of(ownerId, chatId);
    const schedule = pinned.flow.schedule;
    // Срок программы уже вышел: открытый разговор тут же закончился бы сроком — не открываем.
    const deadline = schedule ? deadlineAt(withDayAnchor(run, timeZone, schedule), timeZone, schedule) : null;
    if (deadline !== null && deadline <= at) return { reopened: false, reason: "deadline_passed" };
    const reopened = await store.reopenChat(chatId, { endedAt: record.endedAt, at: new Date(at).toISOString() });
    if (!reopened) return { reopened: false, reason: "not_ended" };
    const { ended: _ended, ...live } = pinned;
    remember(chatId, live);
    const next = withReopen(pinned.flow, run, reopened);
    await reschedule(ownerId, chatId, next, next.answerId ?? null);
    const { answerId: _answerId, firstReasons: _firstReasons, ...plain } = next;
    const day = schedule ? flowDay(withDayAnchor(plain, timeZone, schedule), at, timeZone, schedule).day : null;
    const { onReopen } = options;
    if (onReopen) {
      const event = {
        ownerId,
        chatId,
        flowId: pinned.flowId,
        versionId: pinned.versionId,
        endReason,
        endedAt: new Date(Date.parse(record.endedAt)),
        ...(reason !== undefined && { reason }),
        day,
        state: next.state,
        tags: stateById(pinned.flow, next.state)?.tags ?? [],
        run: plain,
        at: new Date(at),
      };
      track(
        Promise.resolve()
          .then(() => onReopen(event))
          .catch((error) => logError(`[сценарий] чат=${chatId} onReopen упал: ${errorText(error)}`)),
      );
    }
    return { reopened: true };
  }

  // ---------- Перенос чата ----------

  /** Контекст первого хода перенесённого чата: в его состоянии уже заданное место, а не старт сценария. */
  async function placedContext(context: PrepareTurnContext, appZone: string | undefined): Promise<PrepareTurnContext> {
    if (context.audience === "group" || storedRun(context.state[FLOW_STATE_KEY])) return context;
    const pinned = await chatFlow(context.ownerId, context.chatId, context.chat);
    const record = await store.getChat(context.chatId);
    if (!pinned || !record?.placement) return context;
    // Счёт дня — по поясу, по которому его продолжит ход: страница, иначе известный, иначе пояс хода.
    const timeZone = pageTimeZone(context.timeZone, appZone, context.pageTimeZone) ?? (await timeZones.known(context.ownerId, context.chatId)) ?? defaultTimeZone ?? context.timeZone;
    placedNow.add(context.chatId);
    return { ...context, state: { ...context.state, [FLOW_STATE_KEY]: chatRun(pinned.flow, context.state, record, now(), timeZone) } };
  }

  /** Место чата записано ходом: запись переноса больше не нужна, правда — в состоянии чата. */
  async function clearPlacement(chatId: string): Promise<void> {
    if (!placedNow.delete(chatId)) return;
    try {
      await store.updateChat(chatId, { placement: null }, iso());
    } catch (error) {
      placedNow.add(chatId);
      logError(`[сценарий] чат=${chatId} запись переноса не снята: ${errorText(error)}`);
    }
  }

  // ---------- Чтение места ----------

  async function readRun(ownerId: string, chatId: string): Promise<FlowRunView | null> {
    const pinned = await chatFlow(ownerId, chatId);
    if (!pinned) return null;
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    const record = await store.getChat(chatId);
    let run: ChatFlowRun = await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, now(), record);
    const at = chatTime(run, now());
    // Ожидающее ещё не применено ходом — показать, каким место станет; само ожидание не трогается.
    // Один пояс человека на всё чтение: ожидающие таймеры, цепочка при входе, номер дня.
    const timeZone = await timeZones.of(ownerId, chatId);
    const transitions: Transition[] = [];
    const input = { now: at, card: await runtime.cardValues(ownerId), out: transitions, onChainLimit: () => {}, timeZone };
    const decision = run.checkedTransition;
    if (decision && decision.versionId === pinned.versionId && decision.answerId === run.answerId && decision.transition.from === run.state && confirmations.allows({ ownerId, chatId, flowId: pinned.flowId }, run, decision.transition.exitId)) {
      const { checkedTransition, ...withoutDecision } = run;
      run = advance(pinned.flow, withoutDecision, pendingEvent(decision.transition, timeZone), input);
    }
    const pending = (record?.pending ?? []).filter((change) => change.kind !== "transition" || !confirmations.guardFor(pinned.flowId, change.transition.from, change.transition.exitId));
    run = withPending(pinned.flow, run, pending, input);
    const schedule = pinned.flow.schedule;
    if (record?.endedAt) run = endedRun(pinned.flow, run, { endedAt: Date.parse(record.endedAt), endReason: record.endReason ?? "final" });
    const { answerId: _answerId, firstReasons: _firstReasons, ...plain } = run;
    if (!schedule) return plain;
    // День сценария — по поясу человека; после конца — последний день программы.
    const anchored = withDayAnchor(plain, timeZone, schedule);
    return { ...anchored, day: flowDay(anchored, anchored.endedAt ?? at, timeZone, schedule) };
  }

  return {
    withChat<T extends FlowChatOptions>(chat: T): T {
      const ownZone = chat.agent.timeZone ?? (chat as { limits?: { timeZone?: string } }).limits?.timeZone;
      // Своего пояса у службы нет — дата в запросе к модели тоже по `defaultTimeZone`, как дни и касания сценария.
      const agent = ownZone === undefined && defaultTimeZone ? { ...chat.agent, timeZone: defaultTimeZone } : chat.agent;
      const appZone = agent.timeZone ?? ownZone;
      lastAppTimeZone = appZone;
      const flowPrepare = flowPrepareTurn(runtime, () => appZone, finish);
      const gate = flowTurnGate((input) => admit()(input));
      return {
        ...chat,
        // Место в сценарии — служебное: посетитель его не видит, редактор и тестовый чат читают `readRun`.
        privateStateKeys: [...new Set([...(chat.privateStateKeys ?? []), FLOW_STATE_KEY])],
        // Строки «Агент написал первым» на экране (право `appNotices`): только проекция, сырые данные пометок не уходят.
        appNoticeViews: { ...chat.appNoticeViews, ...FLOW_APP_NOTICE_VIEWS },
        beforeTurn: async (input) => {
          const own = await chat.beforeTurn?.(input);
          return own ?? gate(input);
        },
        agent: {
          ...agent,
          tools: withFlowTools(agent.tools, {
            runtime,
            judge,
            history,
            cardTools: () => clientCard()?.tools ?? {},
            knownFlow: (chatId) => known.get(chatId),
          }),
          stepContext: withStepTail(agent.stepContext, runtime),
          serviceBlocks: [...(agent.serviceBlocks ?? []), ...FLOW_SERVICE_BLOCKS],
          ...(agent.widgets && { widgets: withButtons(agent.widgets) }),
          prepareTurn: async (context) => {
            const own = await agent.prepareTurn?.(context);
            await noteAppZone(context, appZone);
            const flow = await flowPrepare(await placedContext(context, appZone));
            if (!own) return flow;
            if (!flow) return own;
            const unset = [...(own.unset ?? []), ...(flow.unset ?? [])];
            return {
              set: { ...own.set, ...flow.set },
              ...(unset.length > 0 && { unset }),
              notices: [...(own.notices ?? []), ...(flow.notices ?? [])],
            };
          },
          contextBlocks: async (input) => {
            const own = ((await agent.contextBlocks?.(input)) ?? []) as ContextBlockEntry[];
            if (input.audience === "group") return own;
            const pinned = await chatFlow(input.ownerId, input.chatId);
            if (!pinned) return own;
            const run = currentRun(pinned.flow, input.state, now());
            // Инструменты сценария вне набора модели хода карточка не называет: модель их не вызовет впустую.
            const present = turnToolNames(agent.tools, (chat as { catalog?: ModelCatalog }).catalog, input);
            const blocks: ContextBlockEntry[] = [...own, { key: "flow:state", text: stateCard(pinned.flow, run, present) }];
            const client = await clientCard()?.block({ ownerId: input.ownerId, flow: pinned.flow, run });
            if (client?.trim()) blocks.push({ key: "flow:client", text: client, private: true });
            return blocks;
          },
        },
        chatInstructions: async (target: Chat, turn?: ChatInstructionsTurn) => {
          const own = chat.chatInstructions ? await chat.chatInstructions(target, turn) : null;
          // Группа сценарий не закрепляет; без хода (сжатие) — только уже закреплённый.
          if (turn?.audience === "group") return own;
          const found = await chatFlow(target.ownerId, target.id, turn ? target : undefined);
          if (!found) return own;
          const pinned = turn ? await closeOverdue(target.ownerId, target.id, found) : found;
          const rules = pinned.ended ? afterEndRules(pinned.flow) : flowRules(pinned.flow.common, pinned.flow, options.clientFacts ? [...FLOW_RULE_PARTS, clientFactsRules] : FLOW_RULE_PARTS);
          return `${own ?? agent.instructions}\n\n${rules}`;
        },
        afterTurn: async (result: TurnResult) => {
          const own = await chat.afterTurn?.(result);
          await noteAppZone(result, appZone);
          track(judgeAfterTurn(result));
          return own;
        },
        ...(chat.replyChecks && { replyChecks: withFlowKnownTexts(chat.replyChecks, (ownerId, chatId) => chatFlow(ownerId, chatId), logError) }),
        onStateChanged: async (input) => {
          if (input.reason !== "turn") {
            const run = storedRun(input.state[FLOW_STATE_KEY]);
            if (run) {
              // Служба зовёт это вне хода и может не ждать: `settled()` ждёт пересчёт сроков.
              const moved = (async () => {
                try {
                  await store.updateChat(input.chatId, { stateId: run.state }, iso());
                } catch (error) {
                  logError(`[сценарий] чат=${input.chatId} состояние не записано в хранилище: ${errorText(error)}`);
                }
                await reschedule(input.ownerId, input.chatId, run, input.reason === "flowCommit" ? run.answerId ?? null : input.atMessageId);
              })();
              track(moved);
              await moved;
            }
          }
          await chat.onStateChanged?.(input);
        },
      };
    },
    attach(target) {
      if ("portFor" in target && target.deliver && typeof store.swapDelivery !== "function") {
        throw new TypeError("flow.attach({ deliver }): хранилищу сценариев нужен swapDelivery (с 0.81) — без него доставка не защищена от второй копии");
      }
      if ("portFor" in target) {
        attachment = target;
        port = undefined;
      } else {
        port = target;
        attachment = undefined;
      }
      forgetPorts();
    },
    async signal(signal) {
      if (signal.wakeAgent) return sendFlowSignal({ runtime, port: await portOf(signal), signal });
      await store.addPending(signal.chatId, {
        kind: "event",
        key: `signal:${randomUUID()}`,
        name: signal.name,
        ...(signal.data !== undefined && { data: signal.data }),
        at: iso(),
      });
    },
    adopt,
    end,
    reopen,
    admit: (input) => admit()(input),
    pause: (input) => pauses().pause(input),
    resume: (input) => pauses().resume(input),
    noteStaffReply: (input) => pauses().noteStaffReply(input),
    reportDelivery: (input) => delivery().report(input),
    resumeDelivery: (input) => delivery().resume(input),
    readRun,
    revokeConfirmation,
    previewMigration: (input) => previewConfirmedMigration(input, { store, confirmations, portFor: portOf }),
    chatsByState: (flowId, options) => migrator().chatsByState(flowId, options),
    async migrateChats(input) {
      try {
        if (!input.requiresConfirmation) return await migrator().migrateChats(input);
        const preview = await previewConfirmedMigration({ ...input, requiresConfirmation: input.requiresConfirmation }, { store, confirmations, portFor: portOf });
        return await migrator().migrateChats({ ...input, chatIds: preview.eligible, filter: undefined });
      } finally {
        forgetPorts();
      }
    },
    readClientCard: (ownerId) => {
      const card = clientCard();
      return card ? card.read(ownerId) : Promise.resolve([]);
    },
    forgetClientCard: async (ownerId, fieldId) => {
      await clientCard()?.forget(ownerId, fieldId);
    },
    advanceTestClock: async (clock) => advanceTestClock({ runtime, port: await portOf(clock), timers: optionalTimers(), ownerId: clock.ownerId, chatId: clock.chatId, clock }),
    tick: () => timers().tick(),
    start: () => timers().start(),
    async stop() {
      await timers().stop();
      while (background.size > 0) await Promise.all(background);
    },
    async settled() {
      while (background.size > 0) await Promise.all(background);
    },
  };
}

/**
 * Сценарий поведения агента для службы чата. Подключение:
 * `const { service } = createChatServer(flow.withChat({ agent, chatInstructions, afterTurn, … }))`, затем `flow.attach(service)`.
 */
export function createAgentFlow(options: AgentFlowOptions): AgentFlowHandle {
  return buildAgentFlow(options);
}
