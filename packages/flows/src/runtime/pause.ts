import { randomUUID } from "node:crypto";
import type { FlowPauseInput, FlowPauseSettings, FlowPort, FlowStaffReply } from "./flow-types";
import type { FlowRuntime } from "./flow-events";

// Пауза «отвечает живой сотрудник» (→ В4), по plan.md, «Пауза». На паузе `admit` → `paused`, ворота хода → «записать
// без хода», таймеры стоят: `leaseDue` хранилища пропускает чат, пока `pausedUntil` не прошёл. Срок, наступивший на
// паузе, срабатывает после неё — дни идут как шли. Пауза — по часам сервера: сотрудник живёт в настоящем времени.

/** Пауза длится столько часов после последнего ответа сотрудника; каждый его ответ продлевает (→ В4). */
export const DEFAULT_PAUSE_STAFF_SILENCE_HOURS = 2;

const HOUR_MS = 3_600_000;
/** Служебное сообщение с репликой сотрудника: агент увидит его в следующем ходе. */
export const FLOW_STAFF_REPLY_NOTICE = "flow_staff_reply";
/** Паузы повторов, когда чат занят ходом, мс. */
const BUSY_RETRY_MS = [50, 250, 1000, 3000];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FlowPauseControl {
  pause(input: FlowPauseInput): Promise<void>;
  resume(input: { ownerId: string; chatId: string }): Promise<void>;
  /** Ответ сотрудника продлевает паузу на `staffSilenceHours` и попадает в контекст агента. */
  noteStaffReply(input: FlowStaffReply): Promise<void>;
}

/** Текст для модели: реплика сотрудника и как с ней быть, когда агент вернётся. */
export const staffReplyTitle = (text: string) =>
  `Живой сотрудник ответил человеку вместо тебя: «${text}». Это сказано от вашего имени: продолжай разговор с учётом этого и не противоречь сотруднику.`;

export function createFlowPause({
  runtime,
  settings,
  port,
}: {
  runtime: FlowRuntime;
  settings: FlowPauseSettings;
  port: (chat: { ownerId: string; chatId: string }) => Promise<FlowPort>;
}): FlowPauseControl {
  const spanMs = (settings.staffSilenceHours ?? DEFAULT_PAUSE_STAFF_SILENCE_HOURS) * HOUR_MS;

  /** Запись чата этого человека; чужой или неизвестный чат — `null`. */
  async function ownChat(ownerId: string, chatId: string) {
    const record = await runtime.store.getChat(chatId);
    return record && record.ownerId === ownerId ? record : null;
  }

  /** Реплика сотрудника — служебным сообщением без хода: модель прочтёт её в начале следующего хода. */
  async function rememberStaffText(ownerId: string, chatId: string, text: string): Promise<void> {
    const deliveryKey = `flow:${chatId}:staff:${randomUUID()}`;
    for (let attempt = 0; ; attempt += 1) {
      const result = await (await port({ ownerId, chatId })).deliverNotices({
        ownerId,
        chatId,
        notices: [{ kind: "app", name: FLOW_STAFF_REPLY_NOTICE, title: staffReplyTitle(text) }],
        wakeAgent: false,
        deliveryKey,
      });
      if (result.status !== "busy") return;
      if (attempt >= BUSY_RETRY_MS.length) {
        runtime.logError(`[сценарий] чат=${chatId}: реплика сотрудника не записана в контекст агента — чат занят`);
        return;
      }
      await wait(BUSY_RETRY_MS[attempt]!);
    }
  }

  return {
    async pause({ ownerId, chatId, until }) {
      if (!(await ownChat(ownerId, chatId))) return;
      await runtime.store.setPause(chatId, new Date(until ? until.getTime() : runtime.now() + spanMs).toISOString());
    },
    async resume({ ownerId, chatId }) {
      if (!(await ownChat(ownerId, chatId))) return;
      await runtime.store.setPause(chatId, null);
    },
    async noteStaffReply({ ownerId, chatId, text }) {
      const record = await ownChat(ownerId, chatId);
      if (!record) return;
      // Продление не укорачивает паузу, заданную приложением до более позднего момента.
      const current = record.pausedUntil ? Date.parse(record.pausedUntil) : 0;
      await runtime.store.setPause(chatId, new Date(Math.max(current, runtime.now() + spanMs)).toISOString());
      if (text?.trim()) await rememberStaffText(ownerId, chatId, text.trim());
    },
  };
}
