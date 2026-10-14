import { randomUUID } from "node:crypto";
import type { FlowPauseInput, FlowPauseSettings, FlowPort, FlowStaffReply } from "./flow-types";
import type { FlowRuntime } from "./flow-events";

// Пауза «отвечает живой сотрудник» (→ В4), по plan.md, «Пауза». На паузе `admit` → `paused`, ворота хода → «записать
// без хода», таймеры стоят: `leaseDue` хранилища пропускает чат, пока `pausedUntil` не прошёл. Срок, наступивший на
// паузе, срабатывает после неё — дни идут как шли. Пауза — по часам сервера: сотрудник живёт в настоящем времени.

/** Пауза длится столько часов после последнего ответа сотрудника; каждый его ответ продлевает (→ В4). */
export const DEFAULT_PAUSE_STAFF_SILENCE_HOURS = 2;

const HOUR_MS = 3_600_000;
/** Паузы повторов, когда чат занят ходом, мс. */
const BUSY_RETRY_MS = [50, 250, 1000, 3000];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FlowPauseControl {
  pause(input: FlowPauseInput): Promise<void>;
  resume(input: { ownerId: string; chatId: string }): Promise<void>;
  /** Ответ сотрудника продлевает паузу на `staffSilenceHours` и попадает в контекст агента. */
  noteStaffReply(input: FlowStaffReply): Promise<void>;
}

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

  /**
   * Реплика сотрудника — сообщением сотрудника без хода, как `ChatService.appendStaffMessage`: модель прочтёт её в начале
   * следующего хода, проверки ответа и `person_link_view` словами человека её не считают.
   */
  async function rememberStaffText(ownerId: string, chatId: string, text: string, staffName: string | undefined): Promise<void> {
    const deliveryKey = `flow:${chatId}:staff:${randomUUID()}`;
    for (let attempt = 0; ; attempt += 1) {
      const result = await (await port({ ownerId, chatId })).deliverNotices({
        ownerId,
        chatId,
        notices: [{ kind: "staff", title: text, ...(staffName && { staffName }) }],
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
    async noteStaffReply({ ownerId, chatId, text, staffName }) {
      const record = await ownChat(ownerId, chatId);
      if (!record) return;
      // Продление не укорачивает паузу, заданную приложением до более позднего момента.
      const current = record.pausedUntil ? Date.parse(record.pausedUntil) : 0;
      await runtime.store.setPause(chatId, new Date(Math.max(current, runtime.now() + spanMs)).toISOString());
      if (text?.trim()) await rememberStaffText(ownerId, chatId, text.trim(), staffName?.trim() || undefined);
    },
  };
}
