import type { LivenessOptions } from "@ykurilov/agent-chat-react";
export const demoUsers = [
  { id: "anna", name: "Анна" },
  { id: "boris", name: "Борис" },
] as const;

/** Имитация сбоя провайдера; `none` — без сбоев. Значения cookie совпадают с сервером демо. */
export const demoFailures = [
  { id: "none", name: "Без сбоев" },
  { id: "overloaded", name: "Перегрузка модели" },
  { id: "overloaded-first", name: "Перегрузка у первого провайдера" },
  { id: "invalid-key", name: "Неверный ключ" },
  { id: "conversation-closed", name: "Разговор завершён (409)" },
  { id: "lesson-closed", name: "Урок закрыт (проверка перед ходом)" },
] as const;

export type DemoUserId = (typeof demoUsers)[number]["id"];
export type DemoFailureId = (typeof demoFailures)[number]["id"];
export type DemoTheme = "light" | "dark";

export function readCookie(name: string): string | undefined {
  for (const pair of document.cookie.split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function currentTheme(): DemoTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: DemoTheme): void {
  localStorage.setItem("demo-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}

const customToolRowKey = "demo-custom-tool-row";

/** Включена ли своя строка вызова вместо строки скина Тандема (US5-3). */
export function readCustomToolRow(): boolean {
  return localStorage.getItem(customToolRowKey) === "on";
}

export function writeCustomToolRow(on: boolean): void {
  localStorage.setItem(customToolRowKey, on ? "on" : "off");
}

const simpleWorkViewKey = "demo-simple-work-view";

/** Включён ли простой вид работы агента: живая строка и свёрнутые шаги вместо мыслей и строк вызовов. */
export function readSimpleWorkView(): boolean {
  return localStorage.getItem(simpleWorkViewKey) === "on";
}

export function writeSimpleWorkView(on: boolean): void {
  localStorage.setItem(simpleWorkViewKey, on ? "on" : "off");
}

const livenessKey = "demo-liveness";

/**
 * Короткие сроки связи для проверок вида на экране: не ждать десятки секунд, чтобы увидеть строку.
 * Включается записью `short` в `localStorage`; обычная работа стенда идёт со сроками по умолчанию.
 * Тишина в 3 с действует, когда сервер стенда шлёт признак жизни раз в секунду (`DEMO_HEARTBEAT_MS`, только e2e):
 * модуль не терпит тишину короче трёх признаков жизни.
 */
export function readLiveness(): LivenessOptions | undefined {
  if (localStorage.getItem(livenessKey) !== "short") return undefined;
  return { silenceTimeoutMs: 3000, requestTimeoutMs: 2000, reconnectDelaysMs: [0, 500, 500] };
}
