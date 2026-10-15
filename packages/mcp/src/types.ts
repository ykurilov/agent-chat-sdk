/** Кто видит инструменты сервера: никто, только админы приложения, все. */
export type McpServerStatus = "off" | "admins" | "everyone";

/** Как говорить с сервером: Streamable HTTP или старый SSE. */
export type McpTransportKind = "http" | "sse";

/** Инструмент из снимка списка сервера: как его прислал сервер, в пределах размеров. */
export interface McpToolSnapshot {
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema входа. */
  inputSchema: Record<string, unknown>;
  /** Сервер пометил инструмент «только чтение» (`annotations.readOnlyHint`). Пометка влияет только на значение по умолчанию: подтверждение выключено, но инструмент выключен, пока админ его не включит, и подтверждение админ может вернуть. */
  readOnly?: boolean;
  /** Почему инструмент нельзя включить: схема больше предела, имя с недопустимыми знаками, повтор имени. */
  problem?: McpToolProblem;
}

export type McpToolProblem = "schema_too_large" | "bad_name" | "duplicate_name" | "bad_field_name";

/** Настройка инструмента админом. Нет записи — инструмент выключен. */
export interface McpToolSetting {
  enabled: boolean;
  /** Спрашивать человека перед вызовом (`needsApproval` ядра). */
  needsApproval: boolean;
}

/** Итог «Проверить связь». */
export interface McpCheckResult {
  at: string;
  ok: boolean;
  /** Текст ошибки без секретов. */
  error?: string;
  /** Сколько инструментов сейчас отдаёт сервер. */
  toolCount?: number;
  /** Живой список совпал со снимком: нет — стоит нажать «Обновить список». */
  matchesSnapshot?: boolean;
}

/** Запись сервера в хранилище. Адрес и заголовки — только зашифрованными. */
export interface StoredMcpServer {
  id: string;
  name: string;
  /** Префикс имён инструментов: латиница, цифры и `_`, уникален в приложении. */
  prefix: string;
  status: McpServerStatus;
  transport: McpTransportKind;
  /** Ходить через прокси приложения (`proxy` у `createMcpServers`). */
  viaProxy: boolean;
  /** Срок ответа сервера на один запрос, мс. */
  timeoutMs: number;
  /** Адрес целиком, зашифрован: в параметрах бывает ключ. */
  secretUrl: string;
  /** Адрес без параметров запроса и без логина: его видно на экране. */
  displayUrl: string;
  /** У адреса есть скрытые части (параметры запроса, логин). */
  urlHasHiddenParts: boolean;
  /** Заголовки JSON-объектом «имя → значение», зашифрованы; нет заголовков — `null`. */
  secretHeaders: string | null;
  /** Имена заголовков: их видно на экране, значения — нет. */
  headerNames: string[];
  /** Снимок списка инструментов: из него строится запрос к модели. */
  tools: McpToolSnapshot[];
  /** Когда снят снимок; `null` — ещё не снят. */
  toolsUpdatedAt: string | null;
  toolSettings: Record<string, McpToolSetting>;
  lastCheck: McpCheckResult | null;
  createdAt: string;
  updatedAt: string;
}

/** Вызов инструмента в журнале: без входа и результата. */
export interface McpCallRecord {
  id: string;
  serverId: string;
  /** Имя инструмента у сервера (без префикса). */
  toolName: string;
  ownerId: string;
  chatId: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  /** Короткий текст ошибки без секретов. */
  error?: string;
}

/** Хранилище серверов и журнала вызовов: память, SQLite или PostgreSQL. */
export interface McpStore {
  /** Все серверы по времени добавления. */
  listServers(): Promise<StoredMcpServer[]>;
  getServer(id: string): Promise<StoredMcpServer | null>;
  /** Записать сервер целиком: новый или замена прежнего. */
  saveServer(server: StoredMcpServer): Promise<void>;
  /** Удаляет сервер и его журнал. */
  deleteServer(id: string): Promise<void>;
  recordCall(call: McpCallRecord): Promise<void>;
  /** Последние вызовы, новые первыми. */
  listCalls(query: { serverId?: string; limit: number }): Promise<McpCallRecord[]>;
  /**
   * Отметка версии серверов: меняется при каждой записи и удалении сервера. Копии приложения сверяют её раз в
   * `syncIntervalMs` и перечитывают серверы, когда она другая.
   */
  revision(): Promise<number>;
  /** Удаляет вызовы старше `before` (ISO). Возвращает, сколько удалено. */
  deleteCallsBefore(before: string): Promise<number>;
}
