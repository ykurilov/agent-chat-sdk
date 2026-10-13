import type { StoredCompaction, StoredMessage } from "../conversation/types";
import { effectiveThreshold } from "./compaction-settings";
import type { ResolvedCompactionSettings } from "./compaction-settings";

/** Размер контекста после ответа: число от провайдера; у сообщений прежних версий — вход плюс выход. */
export function contextSizeOf(message: StoredMessage): number | null {
  const { usage } = message;
  if (!usage) return null;
  const size = usage.contextTokens ?? usage.inputTokens + usage.outputTokens;
  return size > 0 ? size : null;
}

export interface ActiveCompaction {
  record: StoredCompaction;
  /** Место последнего сообщения диапазона на ветке. */
  throughIndex: number;
}

/**
 * Запись, по которой ветка сейчас идёт к модели: последняя из добавленных, чей диапазон кончается на этой ветке
 * и после которого что-то есть. Остальные записи — история.
 */
export function activeCompaction(branch: readonly StoredMessage[], compactions: readonly StoredCompaction[]): ActiveCompaction | null {
  for (let position = compactions.length - 1; position >= 0; position--) {
    const record = compactions[position]!;
    const throughIndex = branch.findIndex((message) => message.id === record.throughMessageId);
    if (throughIndex >= 0 && throughIndex + 1 < branch.length) return { record, throughIndex };
  }
  return null;
}

function isMeasuredAnswer(message: StoredMessage | undefined): message is StoredMessage {
  return message?.role === "assistant" && message.status === "complete" && contextSizeOf(message) !== null;
}

/** Ответ дан уже со сводкой этой записи (создан позже неё); без записи годится любой. */
function isAfterRecord(message: StoredMessage, active: ActiveCompaction | null): boolean {
  return !active || message.createdAt > active.record.createdAt;
}

function lastAnswer(branch: readonly StoredMessage[]): StoredMessage | undefined {
  return branch.findLast((message) => message.role === "assistant");
}

/** Пора ли сжимать после ответа: последний ответ штатный, дан со свежей сводкой и контекст выше порога. */
export function isCompactionDue(input: {
  branch: readonly StoredMessage[];
  compactions: readonly StoredCompaction[];
  contextWindowTokens: number;
  settings: ResolvedCompactionSettings;
}): boolean {
  const last = lastAnswer(input.branch);
  if (!isMeasuredAnswer(last)) return false;
  if (!isAfterRecord(last, activeCompaction(input.branch, input.compactions))) return false;
  return contextSizeOf(last)! > effectiveThreshold(input.settings, input.contextWindowTokens);
}

export interface CompactionPlan {
  /** Начало диапазона: с начала чата или с начала диапазона прежней записи. */
  fromMessageId: string;
  /** Конец диапазона: последнее сообщение перед хвостом. */
  throughMessageId: string;
  throughIndex: number;
}

/**
 * Где резать. Размер хвоста считается разностью чисел провайдера: контекст последнего ответа минус контекст
 * ответа-кандидата. Граница — самый поздний кандидат, после которого набралось не меньше `tailTokens`;
 * хвост начинается с ближайшего вопроса человека, поэтому вызов инструмента не отрывается от результата.
 * Нет подходящего кандидата — `null`: сжимать нечего.
 */
export function planCompaction(input: {
  branch: readonly StoredMessage[];
  compactions: readonly StoredCompaction[];
  tailTokens: number;
}): CompactionPlan | null {
  const { branch } = input;
  const last = lastAnswer(branch);
  if (!isMeasuredAnswer(last)) return null;
  const active = activeCompaction(branch, input.compactions);
  if (!isAfterRecord(last, active)) return null;
  const lastSize = contextSizeOf(last)!;
  const lastIndex = branch.indexOf(last);

  for (let index = lastIndex - 1; index >= 0; index--) {
    const candidate = branch[index];
    if (!isMeasuredAnswer(candidate) || !isAfterRecord(candidate, active)) continue;
    if (lastSize - contextSizeOf(candidate)! < input.tailTokens) continue;
    const tailStart = branch.findIndex((message, position) => position > index && message.role === "user");
    if (tailStart < 0) return null;
    return {
      fromMessageId: active?.record.fromMessageId ?? branch[0]!.id,
      throughMessageId: branch[tailStart - 1]!.id,
      throughIndex: tailStart - 1,
    };
  }
  return null;
}

/**
 * Где резать, когда ход упёрся в окно модели (FR-012): `branch` — ветка до вопроса включительно. Сначала обычный план;
 * пуст — граница перед вопросом, если там есть что-то ещё не сжатое. Хвост тогда — один вопрос.
 */
export function planOverflowCompaction(input: {
  branch: readonly StoredMessage[];
  compactions: readonly StoredCompaction[];
  tailTokens: number;
}): CompactionPlan | null {
  const plan = planCompaction(input);
  if (plan) return plan;
  const { branch } = input;
  const throughIndex = branch.length - 2;
  if (throughIndex < 0) return null;
  const active = activeCompaction(branch, input.compactions);
  if (active && active.throughIndex >= throughIndex) return null;
  return {
    fromMessageId: active?.record.fromMessageId ?? branch[0]!.id,
    throughMessageId: branch[throughIndex]!.id,
    throughIndex,
  };
}
