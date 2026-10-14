import { FLOW_STATE_KEY, type FlowRun } from "../engine/flow-run";
import { flowDay } from "../engine/flow-days";
import { storedRun, type FlowRuntime } from "./flow-events";
import type { FlowPort, FlowTestClockInput, FlowTimers } from "./flow-types";

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

/** Сколько ходов подряд перемотка ждёт (ход таймера и следующий за ним, например прощание). */
const TURN_WAIT_LIMIT = 5;

/** Сдвиг до начала следующего дня сценария по часам чата (этап 4, «Дни и время»). */
async function msToNextDay(runtime: FlowRuntime, port: FlowPort, ownerId: string, chatId: string, offset: number): Promise<number> {
  const pinned = await runtime.chatFlow(ownerId, chatId);
  const schedule = pinned?.flow.schedule;
  if (!schedule) throw new Error("Перемотка до утра: у сценария не настроены «Дни и время» (schedule)");
  const { values } = await port.getChatState(ownerId, chatId);
  const run = storedRun(values[FLOW_STATE_KEY]);
  if (!run) throw new Error("Перемотка до утра: в чате ещё не было хода, дни сценария не начались");
  const timeZone = runtime.timeZones ? await runtime.timeZones.of(ownerId, chatId) : "UTC";
  const chatNow = runtime.now() + offset;
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
}): Promise<{ timeOffset: number }> {
  const { runtime, port, timers, ownerId, chatId, clock } = input;
  const offset = testChatOffset(await port.getChatData(ownerId, chatId));
  if (offset === null) throw new Error(`Чат ${chatId} не тестовый: часы перематываются только у тестовых чатов`);
  const ms = clock.to === "next_day_start" ? await msToNextDay(runtime, port, ownerId, chatId, offset) : clock.ms;
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("Перемотка часов: нужен сдвиг вперёд, мс больше нуля");
  const timeOffset = offset + ms;
  await port.updateChatData(ownerId, chatId, { [FLOW_TEST_CHAT_KEY]: { timeOffset } });

  if (!timers || !(await runtime.chatFlow(ownerId, chatId))) return { timeOffset };
  const { values } = await port.getChatState(ownerId, chatId);
  const run = storedRun(values[FLOW_STATE_KEY]);
  // Хода ещё не было: таймеров нет, сдвиг подхватит первый ход.
  if (!run) return { timeOffset };
  await timers.reschedule({ ownerId, chatId, run: { ...run, timeOffset }, branchHead: run.answerId ?? null });
  await timers.tick();
  await turnFinished(port, ownerId, chatId);
  return { timeOffset };
}
