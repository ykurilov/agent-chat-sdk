import type { ComponentType } from "react";
import type { McpCheckResult, McpServerStatus, McpToolProblem, McpTransportKind } from "../types";

/** Что со списком серверов: грузится, готов, не загрузился (тогда `onRetry`), экрана нет (не админ — 404). */
export type McpLoadState = "loading" | "ready" | "failed" | "not_found";

/** Что админ ввёл в форме нового сервера. */
export interface McpServerFormValues {
  name: string;
  prefix: string;
  url: string;
  transport: McpTransportKind;
  headers: Array<{ name: string; value: string }>;
  viaProxy: boolean;
  timeoutSeconds: number;
  status: McpServerStatus;
}

/** Форма «Добавить сервер». Поля держит скин; слой поведения отправляет и показывает ошибку сервера. */
export interface McpAddFormView {
  open: boolean;
  busy: boolean;
  /** Текст ошибки от сервера (уже без секретов) или `null`. */
  error: string | null;
  onOpen(): void;
  onCancel(): void;
  onSubmit(values: McpServerFormValues): void;
}

/**
 * Что админ ввёл в форме правки. Секретов форма не знает: `url` пустой — адрес прежний; заголовок со значением
 * `null` — значение прежнее («задан»); заголовка нет в списке — он удаляется.
 */
export interface McpServerEditValues {
  name: string;
  prefix: string;
  url: string;
  transport: McpTransportKind;
  headers: Array<{ name: string; value: string | null }>;
  viaProxy: boolean;
  timeoutSeconds: number;
}

/** Форма «Изменить сервер» у карточки. Поля держит скин, начальные значения берёт из карточки. */
export interface McpEditFormView {
  open: boolean;
  busy: boolean;
  /** Текст ошибки от сервера (уже без секретов) или `null`. */
  error: string | null;
  onOpen(): void;
  onCancel(): void;
  onSubmit(values: McpServerEditValues): void;
}

/** Инструмент сервера: переключатели «включён» и «спрашивать подтверждение». */
export interface McpToolRowView {
  name: string;
  /** Имя для модели: `префикс__имя`. */
  modelName: string;
  title?: string;
  description?: string;
  readOnly: boolean;
  enabled: boolean;
  needsApproval: boolean;
  /** Почему нельзя включить; надпись — `labels.problems[problem]`. */
  problem?: McpToolProblem | "name_too_long";
  busy: boolean;
  onEnabled(enabled: boolean): void;
  onNeedsApproval(needsApproval: boolean): void;
}

/** Действие с сервером, которое сейчас идёт: кнопку сделать занятой. */
export type McpServerAction = "status" | "check" | "refresh" | "remove";

/** Карточка сервера. Секретов в ней нет: адрес без параметров, имена заголовков. */
export interface McpServerCardView {
  id: string;
  name: string;
  prefix: string;
  status: McpServerStatus;
  transport: McpTransportKind;
  displayUrl: string;
  urlHasHiddenParts: boolean;
  headerNames: string[];
  viaProxy: boolean;
  timeoutMs: number;
  /** ISO; `null` — список ещё не снят. */
  toolsUpdatedAt: string | null;
  lastCheck: McpCheckResult | null;
  tools: McpToolRowView[];
  busy: McpServerAction | null;
  /** Ошибка последнего действия (от сервера, без секретов) или `null`. */
  error: string | null;
  onStatus(status: McpServerStatus): void;
  onCheck(): void;
  onRefresh(): void;
  onRemove(): void;
  edit: McpEditFormView;
}

/** Строка журнала вызовов: без входа и ответа инструмента. */
export interface McpCallRowView {
  id: string;
  /** ISO. */
  startedAt: string;
  chatId: string;
  serverName: string;
  /** Имя для модели: `префикс__имя` (или имя у сервера, если сервер удалён). */
  toolName: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

/** Экран «Серверы MCP». */
export interface McpAdminScreenProps {
  state: McpLoadState;
  onRetry(): void;
  servers: McpServerCardView[];
  addForm: McpAddFormView;
  calls: McpCallRowView[];
}

/**
 * Договор скина экрана серверов MCP, версия 1. Слой поведения (`useMcpAdmin`) собирает экран только из этой части
 * и ничего своего не рисует. Надписи компонент берёт из `useMcpLabels()`.
 */
export interface McpSkin {
  McpAdminScreen: ComponentType<McpAdminScreenProps>;
}
