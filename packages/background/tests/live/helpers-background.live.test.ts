// Живая проверка помощников и фона на OpenRouter (027, T092, T093). Ключ — только из окружения (`pnpm secrets:load`
// или `.env.local`, его читает проект `live`). Запуск: `pnpm exec vitest run --project live packages/background/tests/live/helpers-background.live.test.ts`.
// Три проверки, всё на дешёвых моделях, ожидание $0,15–0,3:
//   1. T092: помощник с поиском; второй вызов того же помощника берёт кэш провайдера (SC-002); фоновый помощник
//      переживает «перезапуск» сервера и продолжает с сохранённых шагов, повторных вызовов инструментов нет.
//   2. T093: помощник на Claude Haiku 4.5 (через OpenRouter, с рассуждениями) встаёт на подтверждение и после «Разрешить»
//      продолжает без ошибки провайдера — и внутри хода, и фоновой задачей (шаги с рассуждениями пережили базу).
// Тест печатает строки `[live-cost]` с токенами и ценой каждого запроса; ключи и тела запросов не печатаются.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage, AgentHelper, ChatStorage, TaskView } from "@ykurilov/agent-chat-core";
import { createChatServer } from "@ykurilov/agent-chat-server";
import type { ChatServerService } from "@ykurilov/agent-chat-server";
import { jsonSchema, tool } from "ai";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks } from "../../src/index";
import { sqliteTaskStore } from "../../src/sqlite";
import type { TaskStore } from "../../src/types";
import { noticesIn } from "../support/chat-server";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const haiku = {
  id: "claude-haiku-4.5",
  displayName: "Claude Haiku 4.5",
  contextWindowTokens: 200_000,
  acceptsImages: true,
  reasoning: { replayPastTurns: true, levels: ["low", "medium", "high"], defaultLevel: "medium" },
  providerModelIds: { openrouter: "anthropic/claude-haiku-4.5" },
  pricing: { openrouter: { inputPerMillion: 1, outputPerMillion: 5, cachedInputPerMillion: 0.1, cacheWritePerMillion: 1.25 } },
} as const;
const catalog = extendCatalog(standardCatalog, { addModels: [haiku as never] });
const cheap = { modelId: "deepseek-4.1-flash", providerId: "openrouter" };
const claude = { modelId: "claude-haiku-4.5", providerId: "openrouter", reasoning: "medium" };
const price: Record<string, { input: number; output: number; cached: number }> = {
  "deepseek/deepseek-v4.1-flash": { input: 0.3, output: 1.2, cached: 0.006 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5, cached: 0.1 },
};
const HELPER_MARK = "МЕТКА-ПОМОЩНИКА-9f3a";

// ——— запись запросов: токены, кэш, цена; тела и заголовки не пишутся ———
interface CallRecord {
  who: "helper" | "main";
  model: string;
  status: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number | undefined;
  replayedReasoning: boolean;
}
const calls: CallRecord[] = [];
const pendingReads: Promise<void>[] = [];
const originalFetch = globalThis.fetch;
/** Сколько запросов помощника пропустить, а следующий повесить до отмены (имитация остановки сервера). */
let hangHelperAfter: number | undefined;
let helperRequestsSeen = 0;
let hungHelperRequests = 0;

function recordingFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || !String(input).includes("/chat/completions")) return originalFetch(input, init);
    const body = JSON.parse(init.body) as { model?: string; messages?: Array<Record<string, unknown>> };
    const who = init.body.includes(HELPER_MARK) ? "helper" : "main";
    if (who === "helper") {
      helperRequestsSeen += 1;
      if (hangHelperAfter !== undefined && helperRequestsSeen > hangHelperAfter) {
        hungHelperRequests += 1;
        const signal = init.signal;
        return new Promise<Response>((_, reject) => {
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    }
    const record: CallRecord = {
      who,
      model: body.model ?? "?",
      status: 0,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      costUsd: undefined,
      replayedReasoning: (body.messages ?? []).some((message) => message.role === "assistant" && ("reasoning_details" in message || "reasoning" in message || "reasoning_content" in message)),
    };
    calls.push(record);
    const response = await originalFetch(input, init);
    record.status = response.status;
    const copy = response.clone();
    pendingReads.push(
      copy
        .text()
        .then((text) => {
          const lines = text.trimStart().startsWith("{") ? [text] : text.split("\n").filter((line) => line.startsWith("data:") && line.includes('"usage"')).map((line) => line.slice(5));
          for (const line of lines.reverse()) {
            try {
              const usage = (JSON.parse(line) as { usage?: Usage }).usage;
              if (!usage) continue;
              record.promptTokens = usage.prompt_tokens ?? 0;
              record.cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
              record.completionTokens = usage.completion_tokens ?? 0;
              record.costUsd = usage.cost;
              return;
            } catch {
              // неполная строка потока
            }
          }
        })
        .catch(() => {}),
    );
    return response;
  };
}
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cost?: number;
}

const costOf = (record: CallRecord): number => {
  if (record.costUsd !== undefined) return record.costUsd;
  const rate = price[record.model] ?? { input: 1, output: 5, cached: 0.1 };
  const fresh = Math.max(record.promptTokens - record.cachedTokens, 0);
  return (fresh * rate.input + record.cachedTokens * rate.cached + record.completionTokens * rate.output) / 1_000_000;
};

async function reportCost(title: string, from: number): Promise<number> {
  await Promise.all(pendingReads.splice(0));
  const mine = calls.slice(from);
  const total = mine.reduce((sum, record) => sum + costOf(record), 0);
  const lines = mine.map(
    (record, index) =>
      `  ${index + 1}. ${record.who} ${record.model} http=${record.status} вход=${record.promptTokens} из кэша=${record.cachedTokens} выход=${record.completionTokens} ≈$${costOf(record).toFixed(5)}`,
  );
  console.log(`[live-cost] ${title}: запросов ${mine.length}, всего ≈$${total.toFixed(4)}${mine.some((record) => record.costUsd === undefined) ? " (часть цены — расчёт по тарифу)" : ""}\n${lines.join("\n")}`);
  spentUsd += total;
  return total;
}
let spentUsd = 0;

beforeAll(() => {
  globalThis.fetch = recordingFetch();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  console.log(`[live-cost] ИТОГО по файлу ≈$${spentUsd.toFixed(4)}`);
});

// ——— стенд: служба чата + фон на SQLite, настоящая модель ———
const folders: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  hangHelperAfter = undefined;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function sharedStores() {
  const folder = mkdtempSync(join(tmpdir(), "background-live-"));
  folders.push(folder);
  const filePath = join(folder, "tasks.sqlite");
  const stores: TaskStore[] = [];
  const storage: ChatStorage = createInMemoryChatStorage();
  return {
    storage,
    openStore() {
      const store = sqliteTaskStore(filePath);
      stores.push(store);
      return store;
    },
    async close() {
      for (const store of stores) await store.close?.();
    },
  };
}

interface Copy {
  service: ChatServerService;
  errors: string[];
  call(method: string, path: string, body?: unknown): Promise<Response>;
  ask(chatId: string, id: string, text: string): Promise<void>;
  history(chatId: string): Promise<AgentChatMessage[]>;
  tasks(chatId: string): Promise<TaskView[]>;
}

async function openCopy(input: { storage: ChatStorage; store: TaskStore; helpers: Record<string, AgentHelper> }): Promise<Copy> {
  const errors: string[] = [];
  const background = createBackgroundTasks({ store: input.store, leaseMs: 5_000 });
  const { handler, service } = createChatServer({
    basePath: "/api/chat",
    resolveUser: async () => ({ id: "anna" }),
    defaultChoice: cheap,
    catalog,
    agent: {
      instructions: "Ты помощник в тестовом стенде. Любое задание на поиск сведений отдавай помощнику helper_researcher, сам ничего не ищи. Когда помощник вернул итог или запущен в фоне, ответь одной короткой фразой по-русски.",
      helpers: input.helpers,
    },
    env: process.env,
    storage: input.storage,
    chatList: true,
    background,
    logError: (message) => errors.push(message),
  });
  await service.recoverInterruptedAnswers();
  cleanups.push(() => service.flush());
  const call = (method: string, path: string, body?: unknown) =>
    handler.fetch(
      new Request(`http://test.local/api/chat${path}`, {
        method,
        ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  return {
    service,
    errors,
    call,
    async ask(chatId, id, text) {
      const stream = await service.sendMessage("anna", chatId, { id, role: "user", parts: [{ type: "text", text }] });
      const reader = stream.getReader();
      while (!(await reader.read()).done);
    },
    async history(chatId) {
      return (await service.getHistory("anna", chatId)).messages;
    },
    async tasks(chatId) {
      return (await (await call("GET", `/${chatId}/tasks`)).json()) as TaskView[];
    },
  };
}

// ——— помощник и его инструменты ———
const longRules = Array.from(
  { length: 60 },
  (_, index) => `Правило ${index + 1}. Станции пронумерованы, каждая записана в справочнике; при поиске называй номер станции полностью и не округляй годы постройки (пункт ${index + 1}).`,
).join("\n");

const searchLog: string[] = [];
const stationFacts: Record<string, string> = {
  "17": "Станция «Звезда-17» построена в 1987 году, код проверки ZORB-4417.",
  "18": "Станция «Звезда-18» построена в 1993 году, код проверки ZORB-4418.",
};
const search_web = tool({
  description: "Ищет сведения о станциях в справочнике. Принимает запрос, возвращает найденную строку.",
  inputSchema: jsonSchema<{ query: string }>({ type: "object", properties: { query: { type: "string", description: "Поисковый запрос" } }, required: ["query"] }),
  execute: async ({ query }) => {
    searchLog.push(query);
    const number = /\d+/.exec(query)?.[0] ?? "";
    return stationFacts[number] ?? "В справочнике ничего не найдено.";
  },
});

const researcher = (extra: Partial<AgentHelper> = {}): AgentHelper => ({
  description: "Ищет сведения о станциях в справочнике и коротко отвечает по-русски",
  instructions: [
    `${HELPER_MARK}. Ты исследователь станций. Для каждого задания вызови инструмент search_web ровно один раз, затем ответь одной фразой с годом постройки и кодом проверки.`,
    longRules,
  ].join("\n"),
  model: cheap,
  tools: { search_web },
  ...extra,
});

const helperPart = (messages: AgentChatMessage[]) =>
  messages.flatMap((message) => message.parts).find((part) => part.type === "tool-helper_researcher") as
    | { state: string; output?: { status: string; text: string; steps: Array<{ type: string; toolName?: string }>; pendingApproval?: { approvalId: string; toolName: string } } }
    | undefined;

describe("T092: помощник с поиском и фон на OpenRouter", { timeout: 150_000 }, () => {
  it("помощник ищет в справочнике; второй вызов того же помощника берёт кэш (SC-002)", async () => {
    const from = calls.length;
    searchLog.length = 0;
    const shared = sharedStores();
    cleanups.push(shared.close);
    const copy = await openCopy({ storage: shared.storage, store: shared.openStore(), helpers: { researcher: researcher() } });
    const chatId = (await copy.service.createChat("anna")).id;

    await copy.ask(chatId, "u1", "Узнай через помощника, в каком году построена станция «Звезда-17».");
    const first = helperPart(await copy.history(chatId));
    expect(first?.output?.status, JSON.stringify(first)).toBe("done");
    expect(first?.output?.steps.some((step) => step.type === "tool" && step.toolName === "search_web")).toBe(true);
    expect(first?.output?.text).toContain("1987");

    await copy.ask(chatId, "u2", "Теперь так же узнай через помощника про станцию «Звезда-18».");
    const helperParts = (await copy.history(chatId)).flatMap((message) => message.parts).filter((part) => part.type === "tool-helper_researcher");
    expect(helperParts).toHaveLength(2);
    expect(JSON.stringify(helperParts[1])).toContain("1993");
    expect(searchLog).toHaveLength(2);

    await reportCost("T092 помощник и кэш", from);
    const helperCalls = calls.slice(from).filter((record) => record.who === "helper");
    expect(helperCalls.length).toBeGreaterThanOrEqual(4);
    const secondInvocationFirstRequest = helperCalls[2]!;
    console.log(`[live-cache] помощник: запросы по порядку, из кэша: ${helperCalls.map((record) => `${record.cachedTokens}/${record.promptTokens}`).join(", ")}`);
    expect(secondInvocationFirstRequest.cachedTokens).toBeGreaterThan(0);
    expect(copy.errors).toEqual([]);
  });

  it("фоновый помощник переживает перезапуск сервера и продолжает с сохранённых шагов", async () => {
    const from = calls.length;
    searchLog.length = 0;
    const shared = sharedStores();
    cleanups.push(shared.close);
    const background = researcher({ background: true });
    const before = await openCopy({ storage: shared.storage, store: shared.openStore(), helpers: { researcher: background } });
    const chatId = (await before.service.createChat("anna")).id;

    // Первый запрос помощника (поиск) проходит, второй (после результата поиска) зависает: сервер «остановлен» между шагами.
    helperRequestsSeen = 0;
    hungHelperRequests = 0;
    hangHelperAfter = 1;
    await before.ask(chatId, "u1", "Поручи помощнику узнать год постройки станции «Звезда-17».");
    await vi.waitFor(() => expect(hungHelperRequests).toBe(1), { timeout: 90_000 });
    expect(searchLog).toHaveLength(1);
    expect((await before.tasks(chatId)).map((task) => task.status)).toEqual(["running"]);
    await before.service.flush();

    // Новый экземпляр на тех же базах: помощник продолжает, шаг поиска не повторяется.
    hangHelperAfter = undefined;
    const after = await openCopy({ storage: shared.storage, store: shared.openStore(), helpers: { researcher: background } });
    await vi.waitFor(async () => expect(noticesIn(await after.history(chatId)).flat().some((notice) => notice.kind === "task_done")).toBe(true), { timeout: 90_000 });
    const done = noticesIn(await after.history(chatId)).flat().find((notice) => notice.kind === "task_done");
    expect(done?.result).toContain("1987");
    expect(searchLog, "после перезапуска поиск не должен повториться").toHaveLength(1);
    expect((await after.tasks(chatId)).map((task) => task.status)).toEqual(["done"]);
    await vi.waitFor(async () => expect((await after.history(chatId)).filter((message) => message.role === "assistant").length).toBeGreaterThanOrEqual(2), { timeout: 60_000 });
    expect(after.errors).toEqual([]);
    await reportCost("T092 фон и перезапуск", from);
  });
});

// ——— T093: пауза ради подтверждения на Claude ———
const emailLog: string[] = [];
const send_email = tool({
  description: "Отправляет письмо. Человек подтверждает отправку.",
  title: "Отправить письмо",
  inputSchema: jsonSchema<{ to: string; text: string }>({
    type: "object",
    properties: { to: { type: "string" }, text: { type: "string" } },
    required: ["to", "text"],
  }),
  needsApproval: true,
  execute: async ({ to }) => {
    emailLog.push(to);
    return `Письмо отправлено: ${to}`;
  },
});
const mailer = (extra: Partial<AgentHelper> = {}): AgentHelper => ({
  description: "Пишет и отправляет письма",
  instructions: `${HELPER_MARK}. Ты почтальон. Подумай, затем отправь письмо инструментом send_email и после результата ответь одной фразой по-русски.`,
  model: claude,
  tools: { send_email },
  ...extra,
});
const mailerPart = (messages: AgentChatMessage[]) =>
  messages.flatMap((message) => message.parts).find((part) => part.type === "tool-helper_mailer") as
    | { output?: { status: string; text: string; pendingApproval?: { approvalId: string; toolName: string } } }
    | undefined;

describe("T093: пауза помощника ради подтверждения на Claude Haiku 4.5 через OpenRouter", { timeout: 150_000 }, () => {
  async function chatWithMailer(helpers: Record<string, AgentHelper>) {
    const shared = sharedStores();
    cleanups.push(shared.close);
    const copy = await openCopy({ storage: shared.storage, store: shared.openStore(), helpers });
    return { copy, chatId: (await copy.service.createChat("anna")).id };
  }

  it("внутри хода: «Разрешить» → помощник продолжает без ошибки рассуждений", async () => {
    const from = calls.length;
    emailLog.length = 0;
    const { copy, chatId } = await chatWithMailer({ mailer: mailer() });
    await copy.ask(chatId, "u1", "Поручи помощнику helper_mailer отправить письмо petya@example.com с текстом «Привет».");
    const waiting = mailerPart(await copy.history(chatId));
    expect(waiting?.output?.status, JSON.stringify(waiting)).toBe("awaiting_approval");
    expect(waiting?.output?.pendingApproval?.toolName).toBe("send_email");
    expect(emailLog).toEqual([]);

    const { resumed } = await copy.service.answerApproval("anna", chatId, waiting!.output!.pendingApproval!.approvalId, "allow");
    expect(resumed).toBe(true);
    await vi.waitFor(async () => expect(mailerPart(await copy.history(chatId))?.output?.status).toBe("done"), { timeout: 90_000 });
    expect(emailLog).toEqual(["petya@example.com"]);
    expect(mailerPart(await copy.history(chatId))?.output?.text.length).toBeGreaterThan(0);
    await vi.waitFor(async () => expect((await copy.history(chatId)).at(-1)?.metadata?.status).toBe("complete"), { timeout: 60_000 });
    await reportCost("T093 подтверждение внутри хода", from);
    const helperCalls = calls.slice(from).filter((record) => record.who === "helper");
    console.log(`[live-reasoning] внутри хода: запросов помощника ${helperCalls.length}, коды ${helperCalls.map((record) => record.status).join(",")}, рассуждения вернулись в запрос после паузы: ${helperCalls.at(-1)?.replayedReasoning}`);
    expect(helperCalls.every((record) => record.status === 200)).toBe(true);
    expect(copy.errors).toEqual([]);
  });

  it("фоновой задачей: «Разрешить» после чтения шагов из базы → итог доставлен без ошибки", async () => {
    const from = calls.length;
    emailLog.length = 0;
    const { copy, chatId } = await chatWithMailer({ mailer: mailer({ background: true }) });
    await copy.ask(chatId, "u1", "Поручи помощнику helper_mailer отправить письмо petya@example.com с текстом «Привет».");
    await vi.waitFor(async () => expect(noticesIn(await copy.history(chatId)).flat().some((notice) => notice.kind === "task_awaiting_approval")).toBe(true), { timeout: 90_000 });
    const card = noticesIn(await copy.history(chatId)).flat().find((notice) => notice.kind === "task_awaiting_approval")!;
    expect(emailLog).toEqual([]);

    const answer = await copy.call("POST", `/${chatId}/tasks/${card.taskId!}/approval`, { decision: "allow", approvalId: card.approval!.approvalId });
    expect(await answer.json()).toEqual({ status: "resumed" });
    await vi.waitFor(async () => expect(noticesIn(await copy.history(chatId)).flat().some((notice) => notice.kind === "task_done")).toBe(true), { timeout: 90_000 });
    expect(emailLog).toEqual(["petya@example.com"]);
    await reportCost("T093 подтверждение фоновой задачей", from);
    const helperCalls = calls.slice(from).filter((record) => record.who === "helper");
    console.log(`[live-reasoning] фон: запросов помощника ${helperCalls.length}, коды ${helperCalls.map((record) => record.status).join(",")}, рассуждения вернулись в запрос после паузы: ${helperCalls.at(-1)?.replayedReasoning}`);
    expect(helperCalls.every((record) => record.status === 200)).toBe(true);
    expect(copy.errors).toEqual([]);
  });
});
