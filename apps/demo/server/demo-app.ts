import { createAttachments, createDiskAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { AppEvent, ChatStorage, ModelCatalog, SpendingLimits, TurnResult } from "@ykurilov/agent-chat-core";
import { createChatServer } from "@ykurilov/agent-chat-server";
import type { ChatHandlerOptions } from "@ykurilov/agent-chat-server";
import { mountChat } from "@ykurilov/agent-chat-server/hono";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { createNodeWebSocket } from "@hono/node-ws";
import { createVoiceRelay } from "@ykurilov/agent-chat-voice/server";
import { mountVoiceRelay } from "@ykurilov/agent-chat-voice/hono";
import { mountDialogRelay } from "@ykurilov/agent-chat-voice-dialog/hono";
import { createVoiceCatalog } from "@ykurilov/agent-chat-voice-dialog/server";
import type { VoiceCatalog } from "@ykurilov/agent-chat-voice-dialog/server";
import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { createBackgroundTasks } from "@ykurilov/agent-chat-background";
import { sqliteTaskStore } from "@ykurilov/agent-chat-background/sqlite";
import { createMessengers } from "@ykurilov/agent-chat-messengers";
import { createDemoMcp, createDemoMcpAdmin, createMockMcpService } from "./demo-mcp";
import type { MessengerBot, MessengerChatService } from "@ykurilov/agent-chat-messengers";
import { createSqliteMessengerStore } from "@ykurilov/agent-chat-messengers/sqlite";
import { telegramBot } from "@ykurilov/agent-chat-messengers/telegram";
import { createImageGeneration, extendImageCatalog, imageToolTimeoutMs, standardImageCatalog } from "@ykurilov/agent-chat-images";
import type { ImageGeneration } from "@ykurilov/agent-chat-images";
import { createSpendingLimits } from "@ykurilov/agent-chat-limits";
import type { SpendingWindowConfig } from "@ykurilov/agent-chat-limits";
import { createHistorySearchTools, historySearchInstructions } from "@ykurilov/agent-chat-history-search";
import { createLongTermMemory } from "@ykurilov/agent-chat-memory";
import { createSandboxHandler } from "@ykurilov/agent-chat-sandbox";
import { demoSandboxPeople } from "./demo-people";
import { createSqliteSandboxJournal } from "@ykurilov/agent-chat-sandbox/sqlite";
import { createSkills, createSkillsHandler, withSkills } from "@ykurilov/agent-chat-skills";
import { sqliteSkillStore } from "@ykurilov/agent-chat-skills/sqlite";
import { webToolsInstructions } from "@ykurilov/agent-chat-web-tools";
import { demoBrowserTools } from "../shared/demo-browser-tools";
import { pickSlot } from "../shared/demo-widgets";
import { demoSubjectChats } from "./demo-lessons";
import { agentInstructions } from "./agent-instructions";
import { createDemoTaskTools } from "./demo-task-tools";
import { createDemoTasks } from "./demo-tasks";
import { createDemoTools } from "./demo-tools";
import { createDemoWebTools } from "./demo-web-tools";
import { connectionModes, createConnectionSimulation, parseConnectionMode } from "./connection-simulation";
import { demoBeforeTurn, demoTurnRefusal, parseDemoFailure, withDemoFailure, withFailureSimulation } from "./failure-simulation";
import { createDemoMockModel, firstTextAt } from "./mock-model";
import { demoImageLibrary } from "./demo-image-library";
import { demoVideoLibrary } from "./demo-videos";
import { createDemoReports, researcherHelper } from "./demo-background";
import { createMockTelegram, mockTelegramToken, mockTelegramUsername } from "./mock-telegram";
import { createMockElevenLabs } from "./mock-elevenlabs";
import { createMockRunware } from "./mock-runware";
import { createMockScribe } from "./mock-scribe";
import { createMockDialogSoniox, createMockSoniox, mockPolish } from "./mock-soniox";
import { demoSoundsSettings, demoSpeechSettings, demoVoices } from "./demo-speech";

export const demoUsers = ["anna", "boris"] as const;
/** Выбор для новых чатов: DeepSeek 4.1 Flash у самого DeepSeek. */
const demoDefaultChoice = { modelId: "deepseek-4.1-flash", providerId: "deepseek" } as const;
const mockKeyEnv = "DEMO_MOCK_API_KEY";

/** Папка файлов вложений: рядом с базой, с тем же именем. */
export function attachmentsDirectory(databaseFile: string): string {
  return `${databaseFile}.attachments`;
}

export interface DemoAppOptions {
  databaseFile: string;
  /** `mock` — модель-заглушка вместо провайдеров, для e2e. */
  model: "live" | "mock";
  env: Record<string, string | undefined>;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const pair of header.split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** Каталог, где все провайдеры отвечают заглушкой: id провайдеров те же, что у настоящих, а снимок страницы виден всем. */
function mockCatalog(options: { withoutImages: boolean }): ModelCatalog {
  const providerIds = standardCatalog.providers.map((provider) => provider.id);
  return extendCatalog(standardCatalog, {
    addModels: standardCatalog.models.map((model) => ({
      ...model,
      // Заглушка не знает часов пик: цена хода одна в любое время суток, и проверки лимитов не зависят от часа прогона.
      ...(model.pricing && { pricing: Object.fromEntries(Object.entries(model.pricing).map(([providerId, { peakHours: _, ...price }]) => [providerId, price])) }),
      toolResultImageProviders: providerIds,
      // `DEMO_MODELS_WITHOUT_IMAGES`: все модели «не видят» картинки, для проверки пометки перед отправкой.
      ...(options.withoutImages && { acceptsImages: false }),
    })),
    addProviders: standardCatalog.providers.map((provider) => ({
      ...provider,
      apiKeyEnv: mockKeyEnv,
      createLanguageModel: (providerModelId: string) =>
        createDemoMockModel({ providerId: provider.id, providerModelId }),
    })),
  });
}

/** Порог сжатия для проверок: `DEMO_COMPACTION_THRESHOLD_TOKENS`; хвост и потолок сводки — доли порога. Без него — как в модуле. */
function compactionSettings(env: Record<string, string | undefined>) {
  const threshold = Number(env.DEMO_COMPACTION_THRESHOLD_TOKENS);
  if (!Number.isFinite(threshold) || threshold <= 0) return undefined;
  return { thresholdTokens: threshold, tailTokens: Math.floor(threshold / 4), summaryCeilingTokens: Math.floor(threshold / 2) };
}

/**
 * Бюджет для показа: `DEMO_SPENDING_LIMIT_USD` — сколько долларов может потратить каждый человек за период
 * (`DEMO_SPENDING_PERIOD`: `month` по умолчанию, `day` или `none`). Без первой переменной лимитов нет.
 * `setLimitUsd` меняет бюджет на ходу (в заглушке этим пользуется e2e: «лимит подняли»).
 * `DEMO_MESSAGE_LIMIT` — вместо бюджета лимит сообщений: столько сообщений в сутки у каждого человека.
 * `DEMO_MESSAGE_LIMIT_WINDOW=total` — те же сообщения на всё время, без суток (e2e не зависит от полуночи).
 */
function spendingLimits(
  env: Record<string, string | undefined>,
  storage: ChatStorage,
  catalog: ModelCatalog,
): { limits: SpendingLimits; setLimitUsd?: (next: number) => void } | undefined {
  const messageLimit = Number(env.DEMO_MESSAGE_LIMIT);
  if (Number.isInteger(messageLimit) && messageLimit > 0) {
    const windows: SpendingWindowConfig[] =
      env.DEMO_MESSAGE_LIMIT_WINDOW === "total"
        ? [{ id: "total-messages", scope: "user", kind: "total", limitMessages: messageLimit }]
        : [{ id: "day-messages", scope: "user", kind: "calendar", unit: "day", limitMessages: messageLimit }];
    return { limits: createSpendingLimits({ storage, catalog, windows, logError: (error) => console.error(error) }) };
  }
  let limitUsd = Number(env.DEMO_SPENDING_LIMIT_USD);
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) return undefined;
  const period = env.DEMO_SPENDING_PERIOD === "day" || env.DEMO_SPENDING_PERIOD === "none" ? env.DEMO_SPENDING_PERIOD : "month";
  const limits = createSpendingLimits({ storage, catalog, budget: () => ({ user: limitUsd }), period, logError: (error) => console.error(error) });
  return { limits, setLimitUsd: (next: number) => void (limitUsd = next) };
}

/**
 * Картинки агента: в `mock` ключ подставной, а Runware — наш поддельный на этом же сервере (адрес — через `connectProviders`,
 * как прокси). Вживую — только если в окружении есть `RUNWARE_API_KEY`: без него инструмента нет, как и без ключа модели.
 */
function demoImageGeneration(options: DemoAppOptions, attachments: Parameters<typeof createImageGeneration>[0]["attachments"], spending: Parameters<typeof createImageGeneration>[0]["spending"]): ImageGeneration | undefined {
  const { env } = options;
  if (options.model === "mock") {
    const port = env.DEMO_API_PORT ?? "8627";
    const catalog = extendImageCatalog(standardImageCatalog, { connectProviders: { runware: { baseURL: `http://localhost:${port}/api/demo/runware/v1` } } });
    return createImageGeneration({ attachments, env: { RUNWARE_API_KEY: "mock" }, catalog, ...(spending && { spending }), logError: (message) => console.error(message) });
  }
  if (!env.RUNWARE_API_KEY?.trim()) return undefined;
  return createImageGeneration({ attachments, env, ...(spending && { spending }), logError: (message) => console.error(message) });
}

/**
 * Чужие страницы, которым можно слать запросы к чату и голосу с cookie человека: `DEMO_ALLOWED_ORIGINS` через запятую
 * (например, школа на GetCourse, куда встроен чат). Страницы самого демо проходят и без списка: Vite пересылает `/api`
 * на сервер, и для браузера это один адрес. Фронт открыт без этой пересылки, на другом адресе, — впишите его:
 * `DEMO_ALLOWED_ORIGINS=http://localhost:5627` или шаблоном поддоменов `DEMO_ALLOWED_ORIGINS=https://*.example.com`.
 */
function demoAllowedOrigins(env: Record<string, string | undefined>): string[] {
  return (env.DEMO_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

/**
 * Голос стенда: звук идёт через сервер (`relay`), ключи Soniox и модели чистки остаются здесь.
 * В `mock` Soniox и чистка подменены по сценарию (mock-soniox.ts), сети нет.
 */
function mountDemoVoice(
  app: Hono,
  options: DemoAppOptions,
  storage: ChatStorage,
  resolveUser: (request: Request) => Promise<{ id: string } | null>,
  spendingLimits: SpendingLimits | undefined,
  voices: VoiceCatalog,
) {
  const mock = options.model === "mock";
  const { env } = options;
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const relay = createVoiceRelay({
    resolveUser,
    allowedOrigins: demoAllowedOrigins(env),
    ...(mock
      ? {
          apiKey: "mock",
          connectUpstream: () => createMockSoniox(),
          polish: { clean: mockPolish },
          // Стенд браузерных тестов: тесты идут параллельно и входят одним и тем же демо-пользователем, а лимиты проверяют модульные тесты.
          rateLimit: false as const,
          maxConnectionsPerUser: false as const,
          polishRateLimit: false as const,
        }
      : {
          // С российского компьютера Soniox доступен через прокси: адрес и заголовок берутся из окружения.
          ...(env.DEMO_SONIOX_WEBSOCKET_URL && { websocketUrl: env.DEMO_SONIOX_WEBSOCKET_URL }),
          ...(env.DEMO_SONIOX_PROXY_TOKEN && { upstreamHeaders: { "X-Proxy-Token": env.DEMO_SONIOX_PROXY_TOKEN } }),
          // Чистка текста: DeepSeek 4.1 Flash у Together; ключа нет — диктовка работает без чистки.
          polish: { provider: "together" as const, env },
          env,
        }),
  });
  mountVoiceRelay(app, "/api/voice/stream", relay, upgradeWebSocket);
  mountDemoVoiceDialog(app, options, storage, resolveUser, spendingLimits, voices, upgradeWebSocket);
  return injectWebSocket;
}

/**
 * Голосовой режим («разговор»): тот же Soniox и ElevenLabs через наш сервер, ключи остаются здесь.
 * В `mock` оба сервиса подменены по сценарию (mock-soniox.ts, mock-elevenlabs.ts), сети нет.
 * Настройки озвучки (голоса, модель, цена за 1000 знаков) — в demo-speech.ts.
 */
function mountDemoVoiceDialog(
  app: Hono,
  options: DemoAppOptions,
  storage: ChatStorage,
  resolveUser: (request: Request) => Promise<{ id: string } | null>,
  spendingLimits: SpendingLimits | undefined,
  voices: VoiceCatalog,
  upgradeWebSocket: UpgradeWebSocket,
) {
  const mock = options.model === "mock";
  const { env } = options;
  const speech = { catalog: voices, ...demoSpeechSettings(env) };
  const sounds = demoSoundsSettings(env);
  mountDialogRelay(app, {
    path: "/api/voice-dialog",
    upgradeWebSocket,
    allowedOrigins: demoAllowedOrigins(env),
    storage,
    resolveUser,
    ...(spendingLimits && { spendingLimits }),
    logError: (message) => console.error(message),
    ...(mock
      ? {
          speech: { ...speech, apiKey: "mock", connect: () => createMockElevenLabs() },
          recognition: { apiKey: "mock", connectUpstream: () => createMockDialogSoniox() },
          ...(sounds && { sounds: { ...sounds, apiKey: "mock", fetch: createMockScribe() } }),
          // Стенд браузерных тестов: тесты идут параллельно и входят одним и тем же демо-пользователем.
          rateLimit: false as const,
          maxConnectionsPerUser: false as const,
        }
      : {
          speech: { ...speech, env },
          ...(sounds && { sounds: { ...sounds, env } }),
          recognition: {
            env,
            // С российского компьютера Soniox доступен через прокси: адрес и заголовок берутся из окружения.
            ...(env.DEMO_SONIOX_WEBSOCKET_URL && { baseUrl: env.DEMO_SONIOX_WEBSOCKET_URL }),
            ...(env.DEMO_SONIOX_PROXY_TOKEN && { headers: { "X-Proxy-Token": env.DEMO_SONIOX_PROXY_TOKEN } }),
          },
        }),
  });
}

/** Кто админ демо и видит песочницу: `DEMO_ADMIN_IDS` через запятую; по умолчанию — Анна. */
function demoAdminIds(env: Record<string, string | undefined>): Set<string> {
  return new Set((env.DEMO_ADMIN_IDS ?? "anna").split(",").map((id) => id.trim()).filter(Boolean));
}

/**
 * Мессенджеры демо: Telegram в режиме опроса. В `mock` бот ходит к поддельному Telegram на этом же сервере
 * (`/api/demo/telegram`). Вживую бот подключается, если в окружении есть `DEMO_TELEGRAM_TOKEN` и `DEMO_TELEGRAM_USERNAME`.
 */
async function createDemoMessengers(options: DemoAppOptions, service: MessengerChatService, resolveUser: (request: Request) => Promise<{ id: string } | null>) {
  const { env } = options;
  const bots: MessengerBot[] = [];
  if (options.model === "mock") {
    const baseUrl = `http://localhost:${env.DEMO_API_PORT ?? "8627"}/api/demo/telegram`;
    bots.push(telegramBot({ token: mockTelegramToken, username: mockTelegramUsername, receive: { polling: true }, api: { baseUrl } }));
  } else if (env.DEMO_TELEGRAM_TOKEN && env.DEMO_TELEGRAM_USERNAME) {
    bots.push(telegramBot({ token: env.DEMO_TELEGRAM_TOKEN, username: env.DEMO_TELEGRAM_USERNAME, receive: { polling: true } }));
  }
  if (bots.length === 0) return undefined;
  const webUrl = env.DEMO_WEB_URL ?? `http://localhost:${env.DEMO_WEB_PORT ?? "5627"}`;
  return createMessengers({
    store: await createSqliteMessengerStore({ filePath: options.databaseFile }),
    bots,
    service,
    resolveUser,
    basePath: "/api/messengers",
    webChatUrl: (chatId) => `${webUrl}/?chat=${chatId}`,
    logError: (error) => console.error(error),
  });
}

/**
 * Хук итога хода демо: в законченном ответе есть «зачёт» — событие `lesson_passed`, иначе ничего. В чате урока
 * событие несёт ключ урока (`turn.subject.key`).
 */
function lessonPassedAfterTurn(turn: TurnResult): { events: AppEvent[] } | void {
  if (turn.status !== "complete" || !/зачёт/i.test(turn.text)) return;
  return { events: [{ type: "lesson_passed", ...(turn.subject && { data: { lesson: turn.subject.key } }) }] };
}

export async function createDemoApp(options: DemoAppOptions) {
  const storage = createSqliteChatStorage({ filePath: options.databaseFile });
  const mock = options.model === "mock";
  // Один каталог голосов на режим и на чат: чат знает голос человека и теги этого голоса (FR-024).
  const voices = createVoiceCatalog({ voices: [...demoVoices], defaultVoiceId: demoVoices[0].id, storage });
  const demoTools = createDemoTools();
  const demoTasks = createDemoTasks();
  const demoTaskTools = createDemoTaskTools(demoTasks);
  const webTools = createDemoWebTools({ model: options.model, env: options.env, storage });
  const historySearch = createHistorySearchTools({ storage });
  // Файлы вложений лежат рядом с базой: удалил базу — удалил и файлы.
  const attachments = createAttachments({ storage: createDiskAttachmentStorage({ directory: attachmentsDirectory(options.databaseFile) }) });
  const resolveUser = async (request: Request) => {
    const user = readCookie(request, "demo-user");
    return demoUsers.find((known) => known === user) ? { id: user! } : null;
  };
  const catalog = withFailureSimulation(mock ? mockCatalog({ withoutImages: options.env.DEMO_MODELS_WITHOUT_IMAGES === "1" }) : standardCatalog);
  const spending = spendingLimits(options.env, storage, catalog);
  const images = demoImageGeneration(options, attachments, { storage, ...(spending && { limits: spending.limits }) });
  const adminIds = demoAdminIds(options.env);
  // Серверы MCP, которые подключает админ: их инструменты агент видит рядом со своими (экран `/mcp`).
  const mcp = await createDemoMcp({ ...options, storage, isAdmin: (userId) => adminIds.has(userId) });
  // `DEMO_MEMORY=1` включает долгую память: инструмент и блок в запросах, адреса `/api/chat/memory` для экрана памяти.
  const memory = options.env.DEMO_MEMORY === "1" ? createLongTermMemory({ storage }) : undefined;
  // Навыки: список включённых — блоком контекста, тело агент грузит инструментом `use_skill`; правит их админ на `/skills`.
  const skills = createSkills({
    store: sqliteSkillStore(options.databaseFile),
    isAdmin: (user) => adminIds.has(user.id),
    chatStorage: storage,
  });
  const chatOptions: ChatHandlerOptions = {
    basePath: "/api/chat",
    storage,
    resolveUser,
    beforeTurn: demoBeforeTurn,
    defaultChoice: demoDefaultChoice,
    catalog,
    ...(spending && { limits: spending.limits }),
    attachments,
    ...(memory && { memory }),
    chatList: true,
    // Чаты уроков: страница `/lesson` открывает чат по ключу `lesson:demo`, первым пишет агент.
    subjectChats: demoSubjectChats,
    allowedOrigins: demoAllowedOrigins(options.env),
    // Стенд браузерных тестов: тесты идут параллельно одним демо-пользователем, предел ходов проверяют модульные тесты.
    ...(mock && { maxConcurrentTurnsPerUser: Number.POSITIVE_INFINITY }),
    agent: withSkills({
      // Инструкции про веб-инструменты и поиск постоянны: есть они или нет, решает запуск сервера, а не ход.
      instructions: [agentInstructions, ...(webTools ? [webToolsInstructions] : []), historySearchInstructions].join("\n"),
      // Права человека на ход: раз в начале хода. Серверы MCP «только админы» видны по `viewer.isAdmin`.
      viewer: async ({ ownerId }) => ({ isAdmin: adminIds.has(ownerId) }),
      // Инструменты MCP первыми: при одинаковом имени побеждает инструмент демо, в лог — предупреждение.
      tools: (model) => {
        const own = { ...demoTools, ...demoTaskTools(model), ...webTools?.(model), ...historySearch(model), ...images?.tools(model), ...demoVideoLibrary.tools(model), ...demoImageLibrary.tools(model) };
        return { ...mcp.tools(model, own), ...own };
      },
      ...(images && { toolTimeoutMs: { byTool: { generate_images: imageToolTimeoutMs } } }),
      // Функции браузерных инструментов — у страницы `/panel-app`; срок ответа короче только в e2e (`DEMO_BROWSER_TOOL_TIMEOUT_MS`).
      browserTools: demoBrowserTools,
      ...(options.env.DEMO_BROWSER_TOOL_TIMEOUT_MS && { browserToolTimeoutMs: Number(options.env.DEMO_BROWSER_TOOL_TIMEOUT_MS) }),
      voices,
      // Виджеты: пять базовых и свой `pick_slot` (компонент — на странице).
      widgets: { basic: true, custom: [pickSlot] },
      // Схемы: к инструкции добавляется строка про блок ```mermaid; рисует их страница (`diagrams={diagramsClient}`).
      diagrams: true,
      // Живые демонстрации: к инструкции добавляется строка про блок ```html-demo; запускает их страница (`liveDemos`).
      liveDemos: true,
      // Запасные провайдеры явно: проверки «перегрузка у первого» не зависят от значения по умолчанию в модуле.
      providerFallback: {},
      // Помощник «исследователь»: поручение видно в ленте строкой с шагами (T085 этапа 10 фичи 027).
      helpers: { researcher: researcherHelper },
    }, skills),
    compaction: compactionSettings(options.env),
    // Итог хода (фича 029, US2): законченный ответ со словом «зачёт» — событие «урок зачтён», страница рисует плашку.
    afterTurn: lessonPassedAfterTurn,
    env: mock ? { [mockKeyEnv]: "mock" } : options.env,
    // Короткий признак жизни только для e2e: быстрые проверки зависшей связи не ждут по 30 секунд.
    ...(mock && options.env.DEMO_HEARTBEAT_MS ? { heartbeatIntervalMs: Number(options.env.DEMO_HEARTBEAT_MS) } : {}),
  };
  // Фон: отчёты на SQLite демо. Песочница берёт `chatOptions` без фона: у службы фона один хозяин-чат.
  // В `mock` одновременных задач много: тесты идут параллельно одним человеком.
  const reports = createDemoReports();
  const background = createBackgroundTasks({
    store: sqliteTaskStore(options.databaseFile),
    tools: reports.tools,
    ...(mock && { maxRunningPerUser: 50 }),
    // Короткая аренда: после падения сервера брошенную задачу подбирают за секунды, а не за полминуты.
    leaseMs: 3_000,
  });
  const { handler, service } = createChatServer({ ...chatOptions, background });
  const messengers = await createDemoMessengers(options, service, resolveUser);
  // Песочница админа: тот же агент, свои чаты и журнал обращений к модели (адрес по умолчанию `/api/sandbox`).
  const sandbox = createSandboxHandler({
    chat: chatOptions,
    isAdmin: (user) => adminIds.has(user.id),
    journal: await createSqliteSandboxJournal({ filePath: options.databaseFile }),
    people: demoSandboxPeople,
  });

  // Имитация сбоя выбирается в настройках стенда и приходит cookie; она действует на ход, начатый этим запросом.
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true, model: options.model }));
  // Замер задержки (SC-001): когда заглушка отдала первый кусок текста на этот вопрос.
  if (mock) app.get("/api/demo/first-text-at", (c) => c.json({ at: firstTextAt(c.req.query("question") ?? "") }));
  if (mock && spending?.setLimitUsd) {
    const { setLimitUsd } = spending;
    app.post("/api/demo/spending-limit", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { limitUsd?: unknown };
      if (typeof body.limitUsd !== "number" || !(body.limitUsd > 0)) return c.json({ error: "limitUsd must be a positive number" }, 400);
      setLimitUsd(body.limitUsd);
      return c.json({ limitUsd: body.limitUsd });
    });
  }
  // Поддельный Runware; `DEMO_RUNWARE_SLOW_MS` — как долго он держит «медленный» заказ, если его не остановили.
  if (mock) app.route("/api/demo/runware", createMockRunware({ ...(options.env.DEMO_RUNWARE_SLOW_MS && { slowMs: Number(options.env.DEMO_RUNWARE_SLOW_MS) }) }));
  if (mock) {
    const connection = createConnectionSimulation();
    app.post("/api/demo/connection", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown };
      const mode = parseConnectionMode(body.mode);
      if (!mode) return c.json({ error: `mode must be one of: ${connectionModes.join(", ")}` }, 400);
      connection.setMode(mode);
      return c.json({ mode });
    });
    app.use("/api/chat/*", connection.middleware);
  }
  app.use("/api/chat/*", async (c, next) => {
    const failure = parseDemoFailure(readCookie(c.req.raw, "demo-failure"));
    const refusal = demoTurnRefusal(failure, c.req.raw);
    if (refusal) return refusal;
    await withDemoFailure(failure, next);
  });
  app.get("/api/demo/tasks", async (c) => {
    const user = await resolveUser(c.req.raw);
    return user ? c.json({ tasks: demoTasks.list(user.id) }) : c.json({ error: "unauthorized" }, 401);
  });
  app.get("/api/demo/tasks/:taskId", async (c) => {
    const user = await resolveUser(c.req.raw);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const task = demoTasks.find(user.id, c.req.param("taskId"));
    return task ? c.json({ task }) : c.json({ error: "not_found" }, 404);
  });
  if (mock) {
    app.post("/api/demo/reports/release", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { topic?: unknown };
      if (typeof body.topic !== "string" || !body.topic) return c.json({ error: "topic is required" }, 400);
      reports.release(body.topic);
      return c.json({ topic: body.topic });
    });
    app.route("/api/demo/telegram", createMockTelegram());
    app.route("/api/demo/mcp", createMockMcpService());
  }
  if (messengers) app.all("/api/messengers/*", (c) => messengers.handler.fetch(c.req.raw));
  mountChat(app, handler);
  mountChat(app, sandbox);
  // Экран навыков: не админу — 404 на любом адресе (адрес по умолчанию `/api/skills`).
  mountChat(app, createSkillsHandler({ skills, resolveUser, allowedOrigins: demoAllowedOrigins(options.env) }));
  mountChat(app, createDemoMcpAdmin(mcp, resolveUser, demoAllowedOrigins(options.env)));
  const injectWebSocket = mountDemoVoice(app, options, storage, resolveUser, spending?.limits, voices);
  return {
    app,
    injectWebSocket,
    recoverInterruptedAnswers: handler.recoverInterruptedAnswers,
    /** Подбирает задачи фона, брошенные прошлым запуском сервера. */
    recoverBackground: () => background.recover(),
    /** Запускает опрос ботов; зовётся, когда сервер уже слушает порт: бот ходит к поддельному Telegram на нём же. */
    startMessengers: async () => void (await messengers?.start()),
    flush: async () => {
      await messengers?.stop();
      await background.flush();
      await handler.flush();
      await sandbox.flush();
      await mcp.close();
    },
    close: () => storage.close(),
  };
}
