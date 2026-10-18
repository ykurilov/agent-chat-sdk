import { FLOW_STATE_KEY, type FlowRun } from "../engine/flow-run";
import { flowDay } from "../engine/flow-days";
import { FLOW_FIRST_EXIT } from "../engine/timers";
import { runOutsideTurn, storedRun, type FlowRuntime } from "./flow-events";
import type { AgentFlow } from "../format/flow-format";
import type { FlowPort, FlowTestClockInput, FlowTestClockReason, FlowTestClockResult, FlowTimers } from "./flow-types";

// Часы тестового чата редактора: автор перематывает их вперёд и видит напоминания без ожидания. Сдвиг хранится в данных
// чата (`Chat.data`) — их можно писать вне хода, и их видят все копии сервера. Ход копирует сдвиг в место
// (`FlowRun.timeOffset`), а часы чата везде — часы сервера плюс сдвиг. У рабочих чатов пометки нет: сдвига тоже нет.

/** Ключ данных чата (`Chat.data`) с пометкой тестового чата и сдвигом его часов. */
export const FLOW_TEST_CHAT_KEY = "flowTestChat";

/** Данные нового тестового чата: `service.createChat(userId, { data: flowTestChatData() })`. */
export function flowTestChatData(): Record<string, unknown> {
  return { [FLOW_TEST_CHAT_KEY]: { timeOffset: 0 } };
}

/** Сдвиг часов из данных чата, мс; `null` — чат не тестовый. */
export function testChatOffset(data: Record<string, unknown> | undefined): number | null {
  const mark = data?.[FLOW_TEST_CHAT_KEY];
  if (!mark || typeof mark !== "object") return null;
  const offset = (mark as { timeOffset?: unknown }).timeOffset;
  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
}

/** Часы чата, мс: часы сервера плюс сдвиг тестового чата. */
export const chatTime = (run: Pick<FlowRun, "timeOffset"> | null | undefined, serverNow: number): number => serverNow + (run?.timeOffset ?? 0);

/** Перемотка не удалась по понятной причине: `nothing_scheduled` — впереди сценарий сам ничего не напишет. */
export class FlowTestClockError extends Error {
  constructor(
    readonly code: "nothing_scheduled" | "not_reached",
    message: string,
  ) {
    super(message);
    this.name = "FlowTestClockError";
  }
}

/** Сколько раз подряд срок может отложиться (ночь, потолок дня, правила приложения), пока перемотка ищет отправку. */
const NEXT_FIRST_MESSAGE_STEPS = 50;

/** Сколько ходов подряд перемотка ждёт (ход таймера и следующий за ним, например прощание). */
const TURN_WAIT_LIMIT = 5;

/**
 * Место чата: из состояния после хода, а у чата, закреплённого без хода (`adopt`), — из записи переноса. Не закреплён и
 * хода не было — `null`.
 */
async function placeRun(runtime: FlowRuntime, port: FlowPort, chat: { ownerId: string; chatId: string }, flow: AgentFlow, now: number) {
  const { values } = await port.getChatState(chat.ownerId, chat.chatId);
  const stored = storedRun(values[FLOW_STATE_KEY]);
  if (stored) return stored;
  const record = await runtime.store.getChat(chat.chatId);
  return record ? runOutsideTurn(runtime, chat, flow, values, now, record) : null;
}

/** Сдвиг до начала следующего дня сценария по часам чата (этап 4, «Дни и время»). */
async function msToNextDay(runtime: FlowRuntime, port: FlowPort, ownerId: string, chatId: string, offset: number): Promise<number> {
  const pinned = await runtime.chatFlow(ownerId, chatId);
  const schedule = pinned?.flow.schedule;
  if (!pinned || !schedule) throw new Error("Перемотка до утра: у сценария не настроены «Дни и время» (schedule)");
  const chatNow = runtime.now() + offset;
  const run = await placeRun(runtime, port, { ownerId, chatId }, pinned.flow, chatNow);
  if (!run) throw new Error("Перемотка до утра: в чате ещё не было хода, дни сценария не начались");
  const timeZone = runtime.timeZones ? await runtime.timeZones.of(ownerId, chatId) : "UTC";
  return flowDay(run, chatNow, timeZone, schedule).nextDayStartAt - chatNow;
}

/** Дождаться конца хода, который начала перемотка: тестовый чат сразу показывает ответ. Служба без `subscribe` — не ждать. */
async function turnFinished(port: FlowPort, ownerId: string, chatId: string): Promise<void> {
  for (let turn = 0; turn < TURN_WAIT_LIMIT; turn += 1) {
    const stream = await port.subscribe?.(ownerId, chatId);
    if (!stream) return;
    for await (const _chunk of stream);
  }
}

/**
 * Промотать часы тестового чата вперёд: на `ms` или до начала следующего дня сценария (`to: "next_day_start"`). Сдвиг
 * в данные чата, ближайший таймер пересчитан по новым часам и, если наступил, срабатывает сразу (агент пишет первым по
 * обычным правилам); возврат — после конца этого хода. Чат не тестовый — ошибка.
 */
export async function advanceTestClock(input: {
  runtime: FlowRuntime;
  port: FlowPort;
  timers: FlowTimers | null;
  ownerId: string;
  chatId: string;
  clock: FlowTestClockInput;
}): Promise<FlowTestClockResult> {
  const { runtime, port, timers, ownerId, chatId, clock } = input;
  const offset = testChatOffset(await port.getChatData(ownerId, chatId));
  if (offset === null) throw new Error(`Чат ${chatId} не тестовый: часы перематываются только у тестовых чатов`);
  if (clock.to === "next_first_message") return advanceToNextFirstMessage({ runtime, port, timers, ownerId, chatId, offset });
  const ms = clock.to === "next_day_start" ? await msToNextDay(runtime, port, ownerId, chatId, offset) : (clock.ms ?? Number.NaN);
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("Перемотка часов: нужен сдвиг вперёд, мс больше нуля");
  const timeOffset = offset + ms;
  await port.updateChatData(ownerId, chatId, { [FLOW_TEST_CHAT_KEY]: { timeOffset } });

  const pinned = timers && (await runtime.chatFlow(ownerId, chatId));
  if (!timers || !pinned) return { timeOffset };
  const run = await placeRun(runtime, port, { ownerId, chatId }, pinned.flow, runtime.now() + timeOffset);
  // Хода ещё не было и чат не закреплён: таймеров нет, сдвиг подхватит первый ход.
  if (!run) return { timeOffset };
  await timers.reschedule({ ownerId, chatId, run: { ...run, timeOffset }, branchHead: run.answerId ?? null });
  await timers.tick();
  await turnFinished(port, ownerId, chatId);
  return { timeOffset };
}

const nothingScheduled = (chatId: string) =>
  new FlowTestClockError("nothing_scheduled", `Чат ${chatId}: впереди сценарий сам ничего не напишет — перематывать не к чему`);

/**
 * Перемотка к моменту, когда сценарий напишет первым. Сдвиг — ровно до срока таймера; срабатывание проверяет те же
 * правила, что и без перемотки. Срок отложился (ночь, потолок дня, три часа после сообщения человека) — следующий шаг до
 * нового срока, пока не уйдёт сообщение, не выйдет срок разговора или «не завершил».
 */
async function advanceToNextFirstMessage(input: {
  runtime: FlowRuntime;
  port: FlowPort;
  timers: FlowTimers | null;
  ownerId: string;
  chatId: string;
  offset: number;
}): Promise<FlowTestClockResult> {
  const { runtime, port, timers, ownerId, chatId } = input;
  const pinned = timers && (await runtime.chatFlow(ownerId, chatId));
  if (!timers?.watch || !pinned) throw nothingScheduled(chatId);
  let timeOffset = input.offset;
  for (let step = 0; step < NEXT_FIRST_MESSAGE_STEPS; step += 1) {
    const run = await placeRun(runtime, port, { ownerId, chatId }, pinned.flow, runtime.now() + timeOffset);
    if (!run) throw nothingScheduled(chatId);
    // Первый шаг пересчитывает срок по текущему сдвигу; дальше срок в хранилище — уже отложенный таймером (ночь, правила).
    if (step === 0) await timers.reschedule({ ownerId, chatId, run: { ...run, timeOffset }, branchHead: run.answerId ?? null });
    const record = await runtime.store.getChat(chatId);
    if (!record || record.endedAt !== null || record.dueAt === null) throw nothingScheduled(chatId);
    const serverNow = runtime.now();
    const shift = Math.max(0, Date.parse(record.dueAt) - serverNow);
    if (shift > 0) {
      timeOffset += shift;
      await port.updateChatData(ownerId, chatId, { [FLOW_TEST_CHAT_KEY]: { timeOffset } });
      // Срок в хранилище — по часам сервера: с новым сдвигом он наступает сейчас. Выход ноды и ветка остаются его.
      await runtime.store.setDue(chatId, { at: new Date(serverNow).toISOString(), exitId: record.dueExitId ?? FLOW_FIRST_EXIT, branchHead: record.dueBranchHead });
    }
    let reason: FlowTestClockReason | null = null;
    const unwatch = timers.watch(chatId, (fired) => (reason ??= fired));
    try {
      await timers.tick();
      await turnFinished(port, ownerId, chatId);
    } finally {
      unwatch();
    }
    if (reason) return { timeOffset, reason };
  }
  throw new FlowTestClockError("not_reached", `Чат ${chatId}: срок сообщения откладывался ${NEXT_FIRST_MESSAGE_STEPS} раз подряд — перемотка остановлена`);
}
