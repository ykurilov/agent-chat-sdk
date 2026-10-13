import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "@playwright/test";
import type { ConnectionMode } from "../../server/connection-simulation";

/*
 * Свой сервер демо и своя раздача собранной страницы у каждого теста, которому они нужны:
 * тем, кто роняет и перезапускает сервер или меняет имитацию связи (она действует на все чаты сервера).
 * Порты свободные, база своя: такие тесты идут параллельно с остальными и друг с другом.
 */

const demoDir = fileURLToPath(new URL("../..", import.meta.url));

export interface OwnServerOptions {
  /** Как часто сервер шлёт признак жизни; по умолчанию как в модуле, 10 с. */
  heartbeatMs?: number;
  /** Порог автосжатия истории в токенах; без него — как в модуле, 200 тысяч. */
  compactionThresholdTokens?: number;
  /** Все модели сервера не видят картинки: проверка пометки перед отправкой. */
  modelsWithoutImages?: boolean;
  /** Бюджет каждого человека в долларах (`DEMO_SPENDING_LIMIT_USD`): проверка лимитов расходов. */
  spendingLimitUsd?: number;
  /**
   * Лимит сообщений каждого человека (`DEMO_MESSAGE_LIMIT`): столько сообщений в сутки или, с `window: "total"`, на всё
   * время (`DEMO_MESSAGE_LIMIT_WINDOW`) — так тест не зависит от полуночи.
   */
  messageLimit?: { messages: number; window?: "day" | "total" };
  /** Долгая память агента включена (`DEMO_MEMORY=1`): инструмент, блок в запросах, экран памяти. */
  memory?: boolean;
  /** Срок ответа вкладки на браузерный инструмент (`DEMO_BROWSER_TOOL_TIMEOUT_MS`); по умолчанию как в модуле, 30 с. */
  browserToolTimeoutMs?: number;
}

export interface OwnServer {
  webUrl: string;
  /** Убивает сервер демо без штатной остановки, как падение процесса. */
  crashApi: () => Promise<void>;
  /** Штатная остановка сигналом SIGTERM: сервер дописывает идущие ответы в базу и выходит с кодом 0. */
  stopApiGracefully: () => Promise<void>;
  /** Поднимает сервер демо заново на той же базе и на том же порту. */
  startApi: () => Promise<void>;
  /** Включает имитацию связи: она действует на все чаты сервера. */
  setConnectionMode: (mode: ConnectionMode) => Promise<void>;
  /** Меняет бюджет на ходу: «лимит подняли». Работает, если сервер поднят с `spendingLimitUsd`. */
  setSpendingLimit: (limitUsd: number) => Promise<void>;
  /** «Выпускает» отчёт по теме: фоновая задача «отчёт», которая его ждёт, заканчивается. */
  releaseReport: (topic: string) => Promise<void>;
  /** Человек пишет боту в поддельном Telegram. */
  telegramSay: (person: { personId: number; name: string; username?: string }, text: string) => Promise<void>;
  /** Сообщения бота этому человеку в поддельном Telegram. */
  telegramMessages: (personId: number) => Promise<Array<{ messageId: number; text: string }>>;
  /** Останавливает оба процесса, ждёт их выхода и удаляет базу. */
  stop: () => Promise<void>;
}

/**
 * Два свободных порта. Первый сокет держим открытым, пока берём второй: иначе система может выдать один порт дважды.
 * Между закрытием сокетов и запуском серверов порт может увести другой воркер, поэтому запуск повторяется.
 */
async function freePorts(): Promise<[number, number]> {
  const listen = () =>
    new Promise<{ port: number; release: () => Promise<void> }>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, () => {
        const { port } = probe.address() as { port: number };
        resolve({ port, release: () => new Promise((done) => probe.close(() => done())) });
      });
    });
  const first = await listen();
  const second = await listen();
  await Promise.all([first.release(), second.release()]);
  return [first.port, second.port];
}

/** Удаляет файл базы вместе с журналом и общей памятью SQLite. */
export function removeDatabaseFiles(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
  rmSync(`${file}.attachments`, { recursive: true, force: true });
}

/** Процесс в своей группе: убивается вместе с потомками. */
function kill(child: ChildProcess | undefined, signal: NodeJS.Signals) {
  if (child?.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, signal);
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Убивает процесс и ждёт, пока он выйдет. */
async function terminate(child: ChildProcess | undefined) {
  if (!child || hasExited(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  kill(child, "SIGTERM");
  const timeout = setTimeout(() => kill(child, "SIGKILL"), 5_000);
  await exited;
  clearTimeout(timeout);
}

/**
 * Ждёт, пока именно наш процесс займёт порт, и после этого ответа по адресу.
 * Одного ответа мало: порт, отпущенный в `freePorts`, мог успеть занять чужой сервер, и он ответит раньше, чем наш процесс упадёт с «порт занят».
 * Поэтому ждём строку с адресом в выводе нашего процесса: серверы пишут её только после того, как заняли порт.
 * Если процесс вышел раньше (например, порт занят), сразу падает.
 */
async function waitUntilUp(url: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  const port = new URL(url).port;
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    // Vite выделяет порт цветом: убираем управляющие коды.
    output = (output + chunk.toString().replace(/\u001b\[[0-9;]*m/g, "")).slice(-2_000);
  });
  const listening = () => output.includes(`localhost:${port}`);
  while (Date.now() < deadline) {
    if (hasExited(child)) throw new Error(`Процесс вышел до ответа ${url}`);
    if (listening() && (await fetch(url).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Нет ответа ${url} за 30 с`);
}

async function startOnce(options: OwnServerOptions): Promise<OwnServer> {
  const [apiPort, webPort] = await freePorts();
  const databaseFile = join(tmpdir(), `agent-chat-e2e-own-${process.env.DEMO_E2E_RUN_ID}-${apiPort}.sqlite`);
  const distDir = process.env.DEMO_E2E_DIST!;
  const env = {
    ...process.env,
    DEMO_MODEL: "mock",
    DEMO_API_PORT: String(apiPort),
    DEMO_WEB_PORT: String(webPort),
    DEMO_DB_FILE: databaseFile,
    ...(options.heartbeatMs && { DEMO_HEARTBEAT_MS: String(options.heartbeatMs) }),
    ...(options.modelsWithoutImages && { DEMO_MODELS_WITHOUT_IMAGES: "1" }),
    ...(options.memory && { DEMO_MEMORY: "1" }),
    ...(options.browserToolTimeoutMs && { DEMO_BROWSER_TOOL_TIMEOUT_MS: String(options.browserToolTimeoutMs) }),
    ...(options.spendingLimitUsd && { DEMO_SPENDING_LIMIT_USD: String(options.spendingLimitUsd) }),
    ...(options.messageLimit && { DEMO_MESSAGE_LIMIT: String(options.messageLimit.messages), DEMO_MESSAGE_LIMIT_WINDOW: options.messageLimit.window ?? "day" }),
    ...(options.compactionThresholdTokens && { DEMO_COMPACTION_THRESHOLD_TOKENS: String(options.compactionThresholdTokens) }),
  };
  const start = (args: string[]) => spawn(process.execPath, args, { cwd: demoDir, env, detached: true, stdio: ["ignore", "pipe", "ignore"] });

  let api: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  const startApi = async () => {
    api = start(["--conditions=@ykurilov/agent-chat-source", "--import", "tsx", "server/index.ts"]);
    await waitUntilUp(`http://localhost:${apiPort}/api/health`, api);
  };
  const stop = async () => {
    await Promise.all([terminate(api), terminate(web)]);
    removeDatabaseFiles(databaseFile);
  };

  const webUrl = `http://localhost:${webPort}`;
  try {
    await startApi();
    web = start(["node_modules/vite/bin/vite.js", "preview", "--outDir", distDir]);
    await waitUntilUp(webUrl, web);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    webUrl,
    startApi,
    crashApi: async () => {
      const crashed = new Promise((resolve) => api?.once("exit", resolve));
      kill(api, "SIGKILL");
      await crashed;
    },
    stopApiGracefully: async () => {
      const exited = new Promise<number | null>((resolve) => api?.once("exit", resolve));
      kill(api, "SIGTERM");
      expect(await exited, "сервер должен выйти сам, с кодом 0").toBe(0);
    },
    setConnectionMode: async (mode) => {
      const response = await fetch(`${webUrl}/api/demo/connection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      expect(response.ok).toBe(true);
    },
    setSpendingLimit: async (limitUsd) => {
      const response = await fetch(`${webUrl}/api/demo/spending-limit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limitUsd }),
      });
      expect(response.ok).toBe(true);
    },
    releaseReport: async (topic) => {
      const response = await fetch(`${webUrl}/api/demo/reports/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      expect(response.ok).toBe(true);
    },
    telegramSay: async (person, text) => {
      const response = await fetch(`${webUrl}/api/demo/telegram/control/say`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...person, text }),
      });
      expect(response.ok).toBe(true);
    },
    telegramMessages: async (personId) => {
      const response = await fetch(`${webUrl}/api/demo/telegram/control/messages?chatId=${personId}`);
      return ((await response.json()) as { messages: Array<{ messageId: number; text: string }> }).messages;
    },
    stop,
  };
}

const START_ATTEMPTS = 3;

export async function startOwnServer(options: OwnServerOptions = {}): Promise<OwnServer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startOnce(options);
    } catch (error) {
      if (attempt >= START_ATTEMPTS) throw error;
    }
  }
}

/** `test` со свойством `ownServer` (свой сервер на тест); `baseURL` страницы указывает на него. */
export const test = base.extend<{
  ownServer: OwnServer;
  heartbeatMs: number | undefined;
  compactionThresholdTokens: number | undefined;
  modelsWithoutImages: boolean | undefined;
  spendingLimitUsd: number | undefined;
  messageLimit: OwnServerOptions["messageLimit"];
  memory: boolean | undefined;
  browserToolTimeoutMs: number | undefined;
}>({
  heartbeatMs: [undefined, { option: true }],
  compactionThresholdTokens: [undefined, { option: true }],
  modelsWithoutImages: [undefined, { option: true }],
  spendingLimitUsd: [undefined, { option: true }],
  messageLimit: [undefined, { option: true }],
  memory: [undefined, { option: true }],
  browserToolTimeoutMs: [undefined, { option: true }],
  ownServer: async ({ heartbeatMs, compactionThresholdTokens, modelsWithoutImages, spendingLimitUsd, messageLimit, memory, browserToolTimeoutMs }, use) => {
    const server = await startOwnServer({ heartbeatMs, compactionThresholdTokens, modelsWithoutImages, spendingLimitUsd, messageLimit, memory, browserToolTimeoutMs });
    await use(server);
    await server.stop();
  },
  baseURL: async ({ ownServer }, use) => {
    await use(ownServer.webUrl);
  },
});

export { expect };
