import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

/*
 * Инструменты-примеры демо-стенда. Описания постоянные: они идут в начало запроса
 * и попадают в кэш провайдера (FR-023).
 */

/** Время в зоне в виде ISO 8601 со смещением, например `2026-09-29T15:04:05+09:00`. */
export function isoTimeInZone(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const offsetMinutes = Math.round((Date.parse(`${local}Z`) - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${local}${sign}${hours}:${minutes}`;
}

/** Сколько идёт `slow_check`: хватает, чтобы набрать поправку и обновить страницу. */
export const SLOW_CHECK_MS = 5000;

export function createDemoTools(now: () => Date = () => new Date()): ToolSet {
  return {
    current_time: tool({
      description: "Текущие дата и время в часовом поясе. Отдаёт время в формате ISO 8601 со смещением от UTC.",
      inputSchema: z.object({
        timeZone: z.string().describe("Часовой пояс IANA, например Europe/Moscow или Asia/Tokyo"),
      }),
      execute: async ({ timeZone }) => {
        try {
          return isoTimeInZone(now(), timeZone);
        } catch {
          throw new Error(`Неизвестный часовой пояс: ${timeZone}`);
        }
      },
    }),
    // Опасное действие: без подтверждения человека не выполняется (needsApproval), в ленте у него читаемое название.
    clear_notes: tool({
      title: "Очистить заметки",
      description: "Безвозвратно очищает заметки в папке. Перед выполнением человек подтверждает действие.",
      inputSchema: z.object({ folder: z.string().describe("Название папки с заметками") }),
      needsApproval: true,
      execute: async ({ folder }) => `Заметки в папке «${folder}» очищены.`,
    }),
    // Долгий инструмент: пока он идёт, человек успевает послать поправку (фича 034).
    slow_check: tool({
      description: "Долгая проверка макета: идёт несколько секунд и докладывает, что нашла.",
      inputSchema: z.object({ subject: z.string().describe("Что проверить") }),
      execute: async ({ subject }, { abortSignal }) => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SLOW_CHECK_MS);
          abortSignal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return `Проверка «${subject}» прошла.`;
      },
    }),
    broken_lookup: tool({
      description: "Справочная служба: ищет справку по запросу во внешнем сервисе.",
      inputSchema: z.object({ query: z.string().describe("Что найти") }),
      execute: async (): Promise<string> => {
        throw new Error("сервис недоступен");
      },
    }),
  };
}
