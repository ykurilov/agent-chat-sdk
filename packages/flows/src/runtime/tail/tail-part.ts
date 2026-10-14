import type { AgentFlow } from "../../format/flow-format";
import type { FlowRun } from "../../engine/flow-run";
import type { FlowRuntime } from "../flow-events";

/** Что видит строка хвоста шага: сценарий чата и место. Моменты — по часам чата. */
export interface FlowTailInput {
  ownerId: string;
  chatId: string;
  flow: AgentFlow;
  run: FlowRun;
  now: number;
  /** Пояс человека: известный, иначе приложения или сервера. Нет — UTC (строки без «Дней и времени» его не читают). */
  timeZone?: string;
  /** Хранилище и карточка клиента: строке, которой нужны данные человека (попутные задачи). Нет — такая строка молчит. */
  runtime?: FlowRuntime;
  /** Ход ведёт сотрудник, а не человек: личное ему не предлагаем. */
  staff?: boolean;
  /** Пояс человека неизвестен, а сегодня его первый день до первой ночи (В1): тогда агент узнаёт город. Считает этап 4. */
  askTimeZone?: boolean;
}

/** Одна строка хвоста шага; нечего сказать — `null`. */
export type FlowTailPart = (input: FlowTailInput) => string | null | Promise<string | null>;
