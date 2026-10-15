import type { Tool, ToolSet } from "ai";
import type { HostResolver } from "@ykurilov/agent-chat-web-tools";
import { dnsHostResolver } from "@ykurilov/agent-chat-web-tools";
import { createPinnedFetch, guardedFetch } from "./connection/guarded-fetch";
import { secretScrubber } from "./connection/secret-scrub";
import { createServerConnection } from "./connection/server-connection";
import type { ServerConnection, ServerEndpoint } from "./connection/server-connection";
import { McpError } from "./mcp-error";
import { modelTool, modelToolName, prepareModelTools, sortedToolSet, toolProblem } from "./model-tools";
import type { PreparedModelTool } from "./model-tools";
import { createSecretBox } from "./secret-box";
import {
  checkedBoolean,
  checkedHeaders,
  checkedName,
  checkedPrefix,
  checkedStatus,
  checkedTimeout,
  checkedTransport,
  checkedUrl,
  DEFAULT_TIMEOUT_MS,
} from "./server-input";
import type { McpServerInput, McpServerPatch } from "./server-input";
import { serverView } from "./server-view";
import type { McpServerView } from "./server-view";
import { snapshotTools } from "./snapshot/tool-snapshot";
import { createToolCaller } from "./tool-calls";
import type { McpCallLimits, McpSpending } from "./tool-calls";
import type { McpCallRecord, McpCheckResult, McpStore, McpToolSetting, McpToolSnapshot, StoredMcpServer } from "./types";

/** Прокси приложения: серверы с отметкой «через прокси» ходят через него. */
export interface McpProxy {
  /** Свой `fetch` (например, через прокси-агент со своим входом). Нет — встроенный `fetch` пакета. */
  fetch?: typeof globalThis.fetch;
  /**
   * Адрес прокси-переадресатора (`https://proxy.example.com`): заголовки `headers` уходят только на него. Админ
   * вводит адрес сервера на этом хосте; сервер на другом хосте токена прокси не получит. Обязателен с `headers`.
   */
  origin?: string;
  /** Заголовки к запросам на `origin` (токен прокси-переадресатора). Админ их не видит. */
  headers?: Readonly<Record<string, string>>;
}

export interface McpServersOptions {
  store: McpStore;
  /** Ключ шифрования адресов и заголовков серверов, не короче 32 знаков. Сменили — серверы придётся ввести заново. */
  secretKey: string;
  /**
   * Админ ли человек — для экрана управления и его адресов (может ходить в базу). В ходе права берутся не отсюда, а из
   * `model.viewer.isAdmin` (`agent.viewer` ядра): серверы «только админы» видны, когда он `true`.
   */
  isAdmin: (userId: string) => boolean | Promise<boolean>;
  proxy?: McpProxy;
  /** Разрешить серверы во внутренней сети (localhost, частные адреса). По умолчанию нельзя. */
  allowPrivateNetwork?: boolean;
  /** Предел тела одного ответа сервера, байт; по умолчанию 4 МБ. */
  maxResponseBytes?: number;
  /** Сколько знаков ответа инструмента отдаётся модели; по умолчанию 20 000. */
  resultMaxChars?: number;
  limits?: McpCallLimits;
  /** Расход `mcp_tool`: стоимость вызова, если инструмент её сообщил. Без него расход не пишется. */
  spending?: McpSpending;
  /** Строка журнала сервера на каждый вызов (без содержимого и секретов). По умолчанию `console.info`. */
  log?: (line: string) => void;
  /** Сколько дней хранить журнал вызовов; по умолчанию 30. */
  journalDays?: number;
  /**
   * Как часто сверять отметку версии в хранилище, мс: правка админа на другой копии приложения доходит сюда не позже
   * этого срока. По умолчанию 15 000; 0 — не сверять (одна копия).
   */
  syncIntervalMs?: number;
  /** Для тестов: `fetch`, DNS и часы. */
  fetch?: typeof globalThis.fetch;
  resolveHost?: HostResolver;
  now?: () => number;
}

/** Модель хода: то, что ядро передаёт функции-набору инструментов (`AgentToolsModel`). */
export interface McpToolsModel {
  ownerId: string;
  chatId: string;
  turnId?: string;
  audience?: "private" | "group";
  /** Права человека на ход (`agent.viewer` ядра): «только админы» — при `isAdmin: true`. */
  viewer?: { isAdmin?: boolean };
}

/** Управление серверами: то же делает экран админа через API. */
export interface McpAdmin {
  listServers(): McpServerView[];
  getServer(id: string): McpServerView | null;
  /** Подключается, снимает список инструментов и сохраняет. Нет связи — ошибка, ничего не сохранено. */
  addServer(input: McpServerInput): Promise<McpServerView>;
  /** Смена адреса, способа или заголовков снимает список заново (нет связи — ошибка, ничего не меняется). */
  updateServer(id: string, patch: McpServerPatch): Promise<McpServerView>;
  deleteServer(id: string): Promise<void>;
  /** «Проверить связь»: живой список сравнивается со снимком, снимок не меняется. */
  checkServer(id: string): Promise<McpCheckResult>;
  /** «Обновить список»: новый снимок; настройки знакомых инструментов сохраняются, новые выключены. */
  refreshTools(id: string): Promise<McpServerView>;
  setTool(id: string, toolName: string, setting: Partial<McpToolSetting>): Promise<McpServerView>;
  listCalls(query?: { serverId?: string; limit?: number }): Promise<McpCallRecord[]>;
}

export interface McpServers {
  /**
   * Набор для `agent.tools`: `tools: (model) => ({ ...mcp.tools(model, appTools), ...appTools })`. Из снимков, без сети.
   * `appTools` — инструменты приложения: инструмента MCP с тем же именем в наборе нет, в журнал — одно предупреждение.
   */
  tools(model: McpToolsModel, appTools?: ToolSet): ToolSet;
  admin: McpAdmin;
  /** Админ ли человек (та же функция приложения): нужна адресам экрана. */
  isAdmin(userId: string): Promise<boolean>;
  /** Перечитать серверы из хранилища (правка с другой копии приложения). */
  reload(): Promise<void>;
  /** Сверить отметку версии сейчас и перечитать серверы, если она другая. Адреса экрана зовут перед каждым запросом. */
  sync(): Promise<void>;
  /** Закрыть связи с серверами. */
  close(): Promise<void>;
}

interface CatalogEntry {
  server: StoredMcpServer;
  prepared: PreparedModelTool[];
}

const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_JOURNAL_DAYS = 30;
const CALLS_LIST_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SYNC_INTERVAL_MS = 15_000;

const notFound = () => new McpError("not_found", "Сервер не найден.");
const prefixTaken = (prefix: string) => new McpError("bad_input", `Префикс «${prefix}» уже занят другим сервером.`);

/** Серверы MCP приложения: каталог в памяти (из хранилища), набор инструментов для модели и управление. */
export async function createMcpServers(options: McpServersOptions): Promise<McpServers> {
  const box = createSecretBox(options.secretKey);
  const store = options.store;
  const now = options.now ?? (() => Date.now());
  const nowIso = () => new Date(now()).toISOString();
  const allowPrivateNetwork = options.allowPrivateNetwork === true;
  const proxyHeaders = proxyHeadersOf(options.proxy);
  // Встроенный `fetch` проверяет DNS в момент соединения; свой `fetch` (тесты) — проверка перед запросом.
  const pinned = options.fetch ? null : createPinnedFetch({ resolveHost: options.resolveHost ?? dnsHostResolver, allowPrivateNetwork: options.allowPrivateNetwork === true });
  const baseFetch = options.fetch ?? pinned!.fetch;
  const resolveHost = options.resolveHost ?? dnsHostResolver;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const journalMs = (options.journalDays ?? DEFAULT_JOURNAL_DAYS) * DAY_MS;

  const catalog = new Map<string, CatalogEntry>();
  const connections = new Map<string, ServerConnection>();
  let adminQueue: Promise<unknown> = Promise.resolve();

  /** Правки админа идут по одной: две вкладки не перетрут друг другу снимок. */
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = adminQueue.then(work, work);
    adminQueue = run.catch(() => {});
    return run;
  }

  function endpointOf(fields: { name: string; url: string; transport: StoredMcpServer["transport"]; headers: Record<string, string>; timeoutMs: number; viaProxy: boolean; displayUrl: string }): ServerEndpoint {
    const viaProxy = fields.viaProxy ? proxyHeaders : undefined;
    const proxyFetch = fields.viaProxy ? options.proxy?.fetch : undefined;
    return {
      name: fields.name,
      url: fields.url,
      transport: fields.transport,
      headers: fields.headers,
      timeoutMs: fields.timeoutMs,
      fetch: guardedFetch({
        fetch: proxyFetch ?? baseFetch,
        pinned: !proxyFetch && pinned !== null,
        resolveHost,
        allowPrivateNetwork,
        maxResponseBytes,
        ...(viaProxy && { proxyHeaders: viaProxy }),
      }),
      scrub: secretScrubber({ url: new URL(fields.url), displayUrl: fields.displayUrl, headerValues: [...Object.values(fields.headers), ...Object.values(proxyHeaders?.headers ?? {})] }),
    };
  }

  function storedHeaders(server: StoredMcpServer): Record<string, string> {
    return server.secretHeaders === null ? {} : (JSON.parse(box.open(server.secretHeaders)) as Record<string, string>);
  }

  function storedEndpoint(server: StoredMcpServer): ServerEndpoint {
    return endpointOf({ ...server, url: box.open(server.secretUrl), headers: storedHeaders(server) });
  }

  function connectionOf(server: StoredMcpServer): ServerConnection {
    let connection = connections.get(server.id);
    if (!connection) {
      connection = createServerConnection(storedEndpoint(server));
      connections.set(server.id, connection);
    }
    return connection;
  }

  async function dropConnection(id: string) {
    const connection = connections.get(id);
    connections.delete(id);
    await connection?.close();
  }

  /** Снимок через временную связь: нужен при добавлении и смене адреса, пока сервер не сохранён. */
  async function listOnce(endpoint: ServerEndpoint): Promise<McpToolSnapshot[]> {
    const connection = createServerConnection(endpoint);
    try {
      return snapshotTools(await connection.listTools());
    } finally {
      await connection.close();
    }
  }

  function settingsFor(tools: McpToolSnapshot[], previous: Readonly<Record<string, McpToolSetting>> = {}): Record<string, McpToolSetting> {
    return Object.fromEntries(tools.map((tool) => [tool.name, previous[tool.name] ?? { enabled: false, needsApproval: tool.readOnly !== true }]));
  }

  /** Запись — в хранилище, каталог — из прочитанного обратно: запрос к модели строится из тех же байт, что после перезапуска. */
  async function persist(server: StoredMcpServer): Promise<StoredMcpServer> {
    try {
      await store.saveServer(server);
    } catch (error) {
      // Тот же префикс заняла другая копия приложения: её запись есть в хранилище, а в нашем каталоге ещё нет.
      const clash = (await store.listServers()).find((other) => other.prefix === server.prefix && other.id !== server.id);
      if (clash) throw prefixTaken(server.prefix);
      throw error;
    }
    const saved = await store.getServer(server.id);
    if (!saved) throw notFound();
    catalog.set(saved.id, { server: saved, prepared: prepareModelTools(saved) });
    return saved;
  }

  function entryOf(id: string): CatalogEntry {
    const entry = catalog.get(id);
    if (!entry) throw notFound();
    return entry;
  }

  function assertPrefixFree(prefix: string, exceptId?: string) {
    for (const { server } of catalog.values()) {
      if (server.prefix === prefix && server.id !== exceptId) throw prefixTaken(prefix);
    }
  }

  /** Полное имя инструмента для модели уникально между серверами: совпадение — ошибка админу, а не тихая подмена. */
  function assertToolNamesFree(server: Pick<StoredMcpServer, "id" | "prefix" | "tools">) {
    const own = new Set(server.tools.map((tool) => modelToolName(server.prefix, tool.name)));
    for (const { server: other } of catalog.values()) {
      if (other.id === server.id) continue;
      const taken = other.tools.map((tool) => modelToolName(other.prefix, tool.name)).find((name) => own.has(name));
      if (taken) throw new McpError("bad_input", `Имя инструмента «${taken}» уже есть у сервера «${other.name}»: выберите другой префикс.`);
    }
  }

  const log = options.log ?? ((line: string) => console.info(line));
  let viewerHintShown = false;
  const appToolClashesShown = new Set<string>();

  function warnAppToolClash(modelName: string) {
    if (appToolClashesShown.has(modelName)) return;
    appToolClashesShown.add(modelName);
    log(`MCP: инструмент «${modelName}» есть и у приложения — агент получит инструмент приложения; смените префикс сервера`);
  }

  /** Виден ли сервер человеку в этом чате. «Только админы» — по правам хода (`viewer`), не в группе. */
  function visibleTo(server: StoredMcpServer, model: McpToolsModel): boolean {
    if (server.status === "everyone") return true;
    if (server.status !== "admins" || model.audience === "group") return false;
    if (model.viewer === undefined && !viewerHintShown) {
      viewerHintShown = true;
      log("MCP: серверы «только админы» не видны: задайте agent.viewer, который возвращает { isAdmin }");
    }
    return model.viewer?.isAdmin === true;
  }

  const caller = createToolCaller({
    store,
    now,
    log,
    resultMaxChars: options.resultMaxChars,
    limits: options.limits,
    spending: options.spending,
    /** Повторная проверка при вызове: статус и настройки могли смениться посреди хода. */
    current(serverId, toolName, model) {
      const entry = catalog.get(serverId);
      if (!entry || !visibleTo(entry.server, model)) throw new McpError("not_allowed", "Этот инструмент сейчас недоступен: админ его выключил.");
      if (!entry.prepared.some((prepared) => prepared.toolName === toolName)) throw new McpError("not_allowed", "Этот инструмент сейчас выключен админом.");
      return { server: entry.server, connection: connectionOf(entry.server) };
    },
  });

  /** Отметка версии, которой соответствует каталог. Своя запись тоже её меняет: следующая сверка перечитает один раз. */
  let knownRevision: number | undefined;

  /** `seen` — отметка, уже прочитанная сверкой. Отметка — до списка: запись между ними даст лишнее перечитывание, а не пропуск. */
  async function loadCatalog(seen?: number) {
    const revision = seen ?? (await store.revision());
    const servers = await store.listServers();
    const fresh = new Set(servers.map((server) => server.id));
    for (const id of [...catalog.keys()]) {
      if (!fresh.has(id)) {
        catalog.delete(id);
        await dropConnection(id);
      }
    }
    for (const server of servers) {
      const known = catalog.get(server.id);
      if (known && JSON.stringify(known.server) === JSON.stringify(server)) continue;
      // Связь рвётся, только если сменилось, куда и как ходить: итог «Проверить связь» её не трогает.
      if (known && connectionChanged(known.server, server)) await dropConnection(server.id);
      catalog.set(server.id, { server, prepared: prepareModelTools(server) });
    }
    knownRevision = revision;
    await store.deleteCallsBefore(new Date(now() - journalMs).toISOString()).catch(() => 0);
  }

  async function syncCatalog() {
    const revision = await store.revision();
    if (revision !== knownRevision) await loadCatalog(revision);
  }

  await loadCatalog();

  const sync = () => exclusive(syncCatalog);
  const syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  // Правка админа на другой копии: дешёвая сверка отметки по таймеру; таймер не держит процесс.
  const syncTimer =
    syncIntervalMs > 0
      ? setInterval(() => {
          sync().catch((error: unknown) => log(`MCP: сверка серверов не удалась: ${error instanceof Error ? error.message : String(error)}`));
        }, syncIntervalMs)
      : undefined;
  (syncTimer as { unref?: () => void } | undefined)?.unref?.();

  const admin: McpAdmin = {
    listServers: () => [...catalog.values()].map(({ server }) => serverView(server)),
    getServer: (id) => {
      const entry = catalog.get(id);
      return entry ? serverView(entry.server) : null;
    },

    addServer: (input) =>
      exclusive(async () => {
        const name = checkedName(input.name);
        const prefix = checkedPrefix(input.prefix);
        assertPrefixFree(prefix);
        const url = checkedUrl(input.url, allowPrivateNetwork);
        const transport = checkedTransport(input.transport ?? "http");
        const headers = checkedHeaders(input.headers);
        const viaProxy = checkedBoolean(input.viaProxy ?? false, "Через прокси");
        const timeoutMs = checkedTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const status = checkedStatus(input.status ?? "off");

        const tools = await listOnce(endpointOf({ name, url: url.href, transport, headers, timeoutMs, viaProxy, displayUrl: url.displayUrl }));
        const id = crypto.randomUUID();
        assertToolNamesFree({ id, prefix, tools });
        const at = nowIso();
        const saved = await persist({
          id,
          name,
          prefix,
          status,
          transport,
          viaProxy,
          timeoutMs,
          secretUrl: box.seal(url.href),
          displayUrl: url.displayUrl,
          urlHasHiddenParts: url.hasHiddenParts,
          secretHeaders: Object.keys(headers).length > 0 ? box.seal(JSON.stringify(headers)) : null,
          headerNames: Object.keys(headers),
          tools,
          toolsUpdatedAt: at,
          toolSettings: settingsFor(tools),
          lastCheck: { at, ok: true, toolCount: tools.length, matchesSnapshot: true },
          createdAt: at,
          updatedAt: at,
        });
        return serverView(saved);
      }),

    updateServer: (id, patch) =>
      exclusive(async () => {
        const { server } = entryOf(id);
        const next: StoredMcpServer = { ...server };
        if (patch.name !== undefined) next.name = checkedName(patch.name);
        if (patch.prefix !== undefined) {
          next.prefix = checkedPrefix(patch.prefix);
          assertPrefixFree(next.prefix, id);
        }
        if (patch.status !== undefined) next.status = checkedStatus(patch.status);
        if (patch.viaProxy !== undefined) next.viaProxy = checkedBoolean(patch.viaProxy, "Через прокси");
        if (patch.timeoutMs !== undefined) next.timeoutMs = checkedTimeout(patch.timeoutMs);
        if (patch.transport !== undefined) next.transport = checkedTransport(patch.transport);

        let url = box.open(server.secretUrl);
        let headers = storedHeaders(server);
        let urlChanged = false;
        if (patch.url !== undefined) {
          const checked = checkedUrl(patch.url, allowPrivateNetwork);
          urlChanged = checked.href !== url;
          url = checked.href;
          next.secretUrl = box.seal(checked.href);
          next.displayUrl = checked.displayUrl;
          next.urlHasHiddenParts = checked.hasHiddenParts;
        }
        if (patch.headers !== undefined) {
          headers = checkedHeaders(patch.headers, headers);
          next.secretHeaders = Object.keys(headers).length > 0 ? box.seal(JSON.stringify(headers)) : null;
          next.headerNames = Object.keys(headers);
        }

        // Сменился адрес, способ или заголовки — это может быть другой сервер: снимаем список заново.
        const endpointChanged = patch.url !== undefined || patch.headers !== undefined || (patch.transport !== undefined && patch.transport !== server.transport);
        if (endpointChanged) {
          const at = nowIso();
          next.tools = await listOnce(endpointOf({ ...next, url, headers }));
          // Новый адрес — возможно, другой сервис: включение и подтверждение админ задаёт заново.
          next.toolSettings = settingsFor(next.tools, urlChanged ? {} : server.toolSettings);
          next.toolsUpdatedAt = at;
          next.lastCheck = { at, ok: true, toolCount: next.tools.length, matchesSnapshot: true };
        }
        assertToolNamesFree(next);
        next.updatedAt = nowIso();
        const saved = await persist(next);
        await dropConnection(id);
        return serverView(saved);
      }),

    deleteServer: (id) =>
      exclusive(async () => {
        await store.deleteServer(id);
        catalog.delete(id);
        await dropConnection(id);
      }),

    checkServer: (id) =>
      exclusive(async () => {
        const { server } = entryOf(id);
        let check: McpCheckResult;
        try {
          const live = snapshotTools(await connectionOf(server).listTools());
          check = { at: nowIso(), ok: true, toolCount: live.length, matchesSnapshot: JSON.stringify(live) === JSON.stringify(server.tools) };
        } catch (error) {
          check = { at: nowIso(), ok: false, error: error instanceof McpError ? error.message : "Сервер недоступен." };
        }
        // Итог проверки на запрос к модели не влияет: `updatedAt` не трогаем, связь не рвём.
        await persist({ ...server, lastCheck: check });
        return check;
      }),

    refreshTools: (id) =>
      exclusive(async () => {
        const { server } = entryOf(id);
        const tools = snapshotTools(await connectionOf(server).listTools());
        assertToolNamesFree({ ...server, tools });
        const at = nowIso();
        const saved = await persist({
          ...server,
          tools,
          toolSettings: settingsFor(tools, server.toolSettings),
          toolsUpdatedAt: at,
          lastCheck: { at, ok: true, toolCount: tools.length, matchesSnapshot: true },
          updatedAt: at,
        });
        return serverView(saved);
      }),

    setTool: (id, toolName, setting) =>
      exclusive(async () => {
        const { server } = entryOf(id);
        const snapshot = server.tools.find((tool) => tool.name === toolName);
        if (!snapshot) throw new McpError("not_found", "Инструмент не найден: обновите список.");
        const previous = server.toolSettings[toolName] ?? { enabled: false, needsApproval: snapshot.readOnly !== true };
        const next: McpToolSetting = {
          enabled: setting.enabled === undefined ? previous.enabled : checkedBoolean(setting.enabled, "Включён"),
          needsApproval: setting.needsApproval === undefined ? previous.needsApproval : checkedBoolean(setting.needsApproval, "Спрашивать подтверждение"),
        };
        const problem = toolProblem(server.prefix, snapshot);
        if (next.enabled && problem !== undefined) throw new McpError("bad_input", problemText[problem]);
        const saved = await persist({ ...server, toolSettings: { ...server.toolSettings, [toolName]: next }, updatedAt: nowIso() });
        return serverView(saved);
      }),

    listCalls: (query = {}) => store.listCalls({ ...(query.serverId !== undefined && { serverId: query.serverId }), limit: Math.min(Math.max(query.limit ?? 50, 1), CALLS_LIST_MAX) }),
  };

  return {
    tools(model, appTools) {
      const entries: [string, Tool][] = [];
      for (const { server, prepared } of catalog.values()) {
        if (!visibleTo(server, model)) continue;
        for (const item of prepared) {
          if (appTools && Object.hasOwn(appTools, item.modelName)) {
            warnAppToolClash(item.modelName);
            continue;
          }
          entries.push([item.modelName, modelTool(item, (input, call) => caller.call({ serverId: server.id, toolName: item.toolName, input, model, ...call }))]);
        }
      }
      return sortedToolSet(entries);
    },
    admin,
    isAdmin: async (userId) => options.isAdmin(userId),
    reload: () => exclusive(() => loadCatalog()),
    sync,
    async close() {
      clearInterval(syncTimer);
      await Promise.all([...connections.keys()].map(dropConnection));
      await pinned?.close();
    },
  };
}

/** Сменилось, куда и как ходить к серверу: старая связь больше не годится. */
function connectionChanged(before: StoredMcpServer, after: StoredMcpServer): boolean {
  return (
    before.secretUrl !== after.secretUrl ||
    before.secretHeaders !== after.secretHeaders ||
    before.transport !== after.transport ||
    before.viaProxy !== after.viaProxy ||
    before.timeoutMs !== after.timeoutMs ||
    before.updatedAt !== after.updatedAt
  );
}

const problemText: Record<NonNullable<ReturnType<typeof toolProblem>>, string> = {
  schema_too_large: "Схема входа инструмента слишком большая: включить нельзя.",
  bad_name: "Имя инструмента с недопустимыми знаками: включить нельзя.",
  duplicate_name: "Сервер прислал два инструмента с одним именем: включить нельзя.",
  bad_field_name: "В схеме входа есть поле с недопустимым именем: включить нельзя.",
  name_too_long: "Имя инструмента с префиксом длиннее 64 знаков: укоротите префикс.",
};

/** Заголовки прокси и его адрес: без адреса заголовки не уходят никуда — ошибка настройки при запуске. */
function proxyHeadersOf(proxy: McpProxy | undefined): { origin: string; headers: Readonly<Record<string, string>> } | undefined {
  if (!proxy?.headers || Object.keys(proxy.headers).length === 0) return undefined;
  if (!proxy.origin) throw new Error("createMcpServers: proxy.headers задан без proxy.origin — заголовки прокси уходят только на адрес прокси.");
  let origin: string;
  try {
    origin = new URL(proxy.origin).origin;
  } catch {
    throw new Error("createMcpServers: proxy.origin — полный адрес прокси, например https://proxy.example.com.");
  }
  return { origin, headers: proxy.headers };
}
