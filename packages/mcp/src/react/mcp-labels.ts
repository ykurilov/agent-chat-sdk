import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { McpServerStatus, McpToolProblem, McpTransportKind } from "../types";

/** Надписи экрана «Серверы MCP». */
export interface McpLabels {
  title: string;
  intro: string;
  addServer: string;
  empty: string;
  loading: string;
  failed: string;
  retry: string;
  /** Не админ: экрана для него нет. */
  notFound: string;
  /** Поля формы. */
  fieldName: string;
  fieldPrefix: string;
  fieldPrefixHint: string;
  fieldUrl: string;
  fieldUrlHint: string;
  fieldTransport: string;
  transportNames: Record<McpTransportKind, string>;
  fieldHeaders: string;
  fieldHeadersHint: string;
  headerName: string;
  headerValue: string;
  addHeader: string;
  removeHeader: string;
  fieldViaProxy: string;
  fieldViaProxyHint: string;
  fieldTimeout: string;
  fieldStatus: string;
  save: string;
  cancel: string;
  /** Форма правки: секретов не показывает — только «задан». */
  edit: string;
  editServer: string;
  fieldUrlKeepHint: string;
  headerReplace: string;
  headerClear: string;
  saveChanges: string;
  /** Карточка сервера. */
  statusNames: Record<McpServerStatus, string>;
  hiddenParts: string;
  /** «Authorization: задан». */
  headerIsSet: (name: string) => string;
  viaProxy: string;
  check: string;
  refresh: string;
  remove: string;
  confirmRemove: string;
  lastCheckOk: (time: string, toolCount: number) => string;
  lastCheckFailed: (time: string, error: string) => string;
  snapshotDiffers: string;
  toolsUpdated: (time: string) => string;
  tools: string;
  noTools: string;
  toolEnabled: string;
  toolNeedsApproval: string;
  readOnly: string;
  problems: Record<McpToolProblem | "name_too_long", string>;
  /** Журнал. */
  journal: string;
  journalEmpty: string;
  journalTime: string;
  journalChat: string;
  journalTool: string;
  journalDuration: string;
  journalResult: string;
  journalOk: string;
  durationMs: (ms: number) => string;
  /** Время для людей: «15.10, 12:35». */
  time: (iso: string) => string;
}

const shortTime = (locale: string) => (iso: string) =>
  new Date(iso).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const russianMcpLabels: McpLabels = {
  title: "Серверы MCP",
  intro: "Внешние сервисы с инструментами для агента. Адрес и заголовки хранятся зашифрованными и на экран не выводятся.",
  addServer: "Добавить сервер",
  empty: "Серверов пока нет.",
  loading: "Загружаем…",
  failed: "Не получилось. Попробуйте ещё раз",
  retry: "Повторить",
  notFound: "Страница не найдена.",
  fieldName: "Название",
  fieldPrefix: "Префикс",
  fieldPrefixHint: "Латиница, цифры и «_», не на конце. Агент увидит инструменты как префикс__имя.",
  fieldUrl: "Адрес",
  fieldUrlHint: "Только удалённые серверы по https. Ключ в адресе тоже скрывается.",
  fieldTransport: "Способ связи",
  transportNames: { http: "Streamable HTTP", sse: "SSE (старый)" },
  fieldHeaders: "Заголовки",
  fieldHeadersHint: "Например, Authorization: Bearer … Значения потом не показываются.",
  headerName: "Имя заголовка",
  headerValue: "Значение",
  addHeader: "Добавить заголовок",
  removeHeader: "Убрать заголовок",
  fieldViaProxy: "Через прокси приложения",
  fieldViaProxyHint: "Для сервисов, недоступных напрямую.",
  fieldTimeout: "Срок ответа, секунд",
  fieldStatus: "Кому доступен",
  save: "Подключить",
  cancel: "Отмена",
  edit: "Изменить",
  editServer: "Изменить сервер",
  fieldUrlKeepHint: "Пусто — адрес прежний. Новый адрес заменит старый целиком, вместе с ключом, а инструменты выключатся: включите нужные заново.",
  headerReplace: "Заменить",
  headerClear: "Очистить",
  saveChanges: "Сохранить",
  statusNames: { off: "Выключен", admins: "Только админы", everyone: "Все" },
  hiddenParts: "параметры скрыты",
  headerIsSet: (name) => `${name}: задан`,
  viaProxy: "через прокси",
  check: "Проверить связь",
  refresh: "Обновить список",
  remove: "Удалить",
  confirmRemove: "Точно удалить?",
  lastCheckOk: (time, toolCount) => `Связь есть (${time}), инструментов: ${toolCount}`,
  lastCheckFailed: (time, error) => `Нет связи (${time}): ${error}`,
  snapshotDiffers: "Список на сервере изменился — нажмите «Обновить список».",
  toolsUpdated: (time) => `Список снят ${time}`,
  tools: "Инструменты",
  noTools: "Сервер не отдал ни одного инструмента.",
  toolEnabled: "Включён",
  toolNeedsApproval: "Спрашивать подтверждение",
  readOnly: "только чтение",
  problems: {
    schema_too_large: "Схема слишком большая — включить нельзя",
    bad_name: "Недопустимое имя — включить нельзя",
    duplicate_name: "Имя повторяется — включить нельзя",
    bad_field_name: "Недопустимое имя поля — включить нельзя",
    name_too_long: "Имя с префиксом длиннее 64 знаков",
  },
  journal: "Журнал вызовов",
  journalEmpty: "Вызовов пока не было.",
  journalTime: "Время",
  journalChat: "Чат",
  journalTool: "Инструмент",
  journalDuration: "Длительность",
  journalResult: "Итог",
  journalOk: "успешно",
  durationMs: (ms) => (ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`),
  time: shortTime("ru-RU"),
};

export const englishMcpLabels: McpLabels = {
  title: "MCP servers",
  intro: "External services with tools for the agent. The address and headers are stored encrypted and never shown.",
  addServer: "Add server",
  empty: "No servers yet.",
  loading: "Loading…",
  failed: "That did not work. Try again",
  retry: "Retry",
  notFound: "Page not found.",
  fieldName: "Name",
  fieldPrefix: "Prefix",
  fieldPrefixHint: "Latin letters, digits and “_”, not at the end. The agent sees tools as prefix__name.",
  fieldUrl: "Address",
  fieldUrlHint: "Remote https servers only. A key in the address is hidden too.",
  fieldTransport: "Transport",
  transportNames: { http: "Streamable HTTP", sse: "SSE (legacy)" },
  fieldHeaders: "Headers",
  fieldHeadersHint: "For example, Authorization: Bearer … Values are never shown again.",
  headerName: "Header name",
  headerValue: "Value",
  addHeader: "Add header",
  removeHeader: "Remove header",
  fieldViaProxy: "Through the app proxy",
  fieldViaProxyHint: "For services that are not reachable directly.",
  fieldTimeout: "Timeout, seconds",
  fieldStatus: "Available to",
  save: "Connect",
  cancel: "Cancel",
  edit: "Edit",
  editServer: "Edit server",
  fieldUrlKeepHint: "Leave empty to keep the address. A new address replaces the old one entirely, key included, and switches the tools off: enable the ones you need again.",
  headerReplace: "Replace",
  headerClear: "Clear",
  saveChanges: "Save",
  statusNames: { off: "Off", admins: "Admins only", everyone: "Everyone" },
  hiddenParts: "parameters hidden",
  headerIsSet: (name) => `${name}: set`,
  viaProxy: "via proxy",
  check: "Check connection",
  refresh: "Refresh list",
  remove: "Delete",
  confirmRemove: "Really delete?",
  lastCheckOk: (time, toolCount) => `Connected (${time}), tools: ${toolCount}`,
  lastCheckFailed: (time, error) => `No connection (${time}): ${error}`,
  snapshotDiffers: "The server's list has changed — press “Refresh list”.",
  toolsUpdated: (time) => `List taken ${time}`,
  tools: "Tools",
  noTools: "The server returned no tools.",
  toolEnabled: "Enabled",
  toolNeedsApproval: "Ask for approval",
  readOnly: "read-only",
  problems: {
    schema_too_large: "Schema too large — cannot be enabled",
    bad_name: "Invalid name — cannot be enabled",
    duplicate_name: "Duplicate name — cannot be enabled",
    bad_field_name: "Invalid field name — cannot be enabled",
    name_too_long: "Name with prefix is longer than 64 characters",
  },
  journal: "Call journal",
  journalEmpty: "No calls yet.",
  journalTime: "Time",
  journalChat: "Chat",
  journalTool: "Tool",
  journalDuration: "Duration",
  journalResult: "Result",
  journalOk: "ok",
  durationMs: (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`),
  time: shortTime("en-GB"),
};

const McpLabelsContext = createContext<McpLabels>(russianMcpLabels);

/** Свой словарь экрана серверов MCP; без провайдера — русский. */
export function McpLabelsProvider({ labels, children }: { labels: McpLabels; children?: ReactNode }) {
  return createElement(McpLabelsContext.Provider, { value: labels }, children);
}

export function useMcpLabels(): McpLabels {
  return useContext(McpLabelsContext);
}
