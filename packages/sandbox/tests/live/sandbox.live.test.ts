// Живая проверка песочницы (026, T047): демо-сервер с настоящей моделью (DeepSeek 4.1 Flash через OpenRouter), админ «anna».
// Ход с инструментом пишется в журнал; правка ответа и результата инструмента доходит до модели; своя инструкция меняет
// поведение; смена модели работает; ключа OpenRouter нет ни в одном куске журнала. Runware не подключается (картинки платные).
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает. Запуск: `pnpm test:live sandbox`.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoApp } from "../../../../apps/demo/server/demo-app";
import type { JournalCallResponse, JournalListResponse, SandboxSettingsResponse } from "../../src/index";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelChoice = { modelId: "deepseek-4.1-flash", providerId: "openrouter" };
const folder = mkdtempSync(join(tmpdir(), "sandbox-live-"));
const databaseFile = join(folder, "live.sqlite");
// Демо видит только ключ OpenRouter: ни Runware, ни других платных сервисов.
let demo: Awaited<ReturnType<typeof createDemoApp>>;

beforeAll(async () => {
  demo = await createDemoApp({ databaseFile, model: "live", env: { OPENROUTER_API_KEY: apiKey, DEMO_ADMIN_IDS: "anna" } });
});

afterAll(async () => {
  await demo.flush();
  demo.close();
  rmSync(folder, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, user = "anna"): Promise<Response> {
  return demo.app.request(`http://localhost${path}`, {
    method,
    headers: { cookie: `demo-user=${user}`, "content-type": "application/json", origin: "http://localhost" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return (await response.json()) as T;
}

let turnCounter = 0;
async function ask(chatId: string, text: string): Promise<void> {
  const response = await call("POST", `/api/sandbox/${chatId}/messages`, {
    message: { id: `live-u-${++turnCounter}`, role: "user", parts: [{ type: "text", text }] },
  });
  expect(response.status).toBe(200);
  await response.text(); // поток дочитан — ход закончен
  await demo.flush();
}

interface Part {
  type: string;
  text?: string;
  toolCallId?: string;
  output?: unknown;
}
interface Message {
  id: string;
  role: string;
  parts: Part[];
  metadata?: { status?: string; usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number } };
}
interface History {
  messages: Message[];
  answerEdits?: Record<string, { textEdited: boolean; editedToolCallIds: string[] }>;
}

async function lastAnswer(chatId: string): Promise<Message> {
  const { messages } = await json<History>(await call("GET", `/api/sandbox/${chatId}`));
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

function answerText(message: Message): string {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
}

async function journalOf(chatId: string) {
  const { entries } = await json<JournalListResponse>(await call("GET", `/api/sandbox/chats/${chatId}/journal`));
  return entries;
}

async function details(callId: string) {
  return json<JournalCallResponse>(await call("GET", `/api/sandbox/journal/calls/${callId}`));
}

const spent = { calls: 0, costUsd: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

describe("песочница на настоящей модели (DeepSeek 4.1 Flash через OpenRouter)", () => {
  let chatId = "";

  it("админ пишет агенту: в журнале обращения к модели с токенами и ценой и вызов find_videos", async () => {
    const created = await json<{ id: string }>(await call("POST", "/api/sandbox"));
    chatId = created.id;
    await json(await call("PUT", `/api/sandbox/${chatId}/model`, modelChoice));
    await ask(chatId, "Найди в каталоге видео про нейросети и назови его название. Вызови find_videos.");

    const answer = await lastAnswer(chatId);
    expect(answer.metadata?.status).toBe("complete");
    expect(answer.parts.some((part) => part.type === "tool-find_videos")).toBe(true);

    const entries = await journalOf(chatId);
    const modelCalls = entries.filter((entry) => entry.kind === "model");
    const toolCalls = entries.filter((entry) => entry.kind === "tool");
    expect(modelCalls.length).toBeGreaterThanOrEqual(2);
    expect(toolCalls.some((entry) => entry.kind === "tool" && entry.toolName === "find_videos")).toBe(true);
    for (const entry of modelCalls) {
      if (entry.kind !== "model") continue;
      expect(entry.usage?.inputTokens).toBeGreaterThan(0);
      expect(entry.costUsd).toBeGreaterThan(0);
      expect(entry.providerId).toBe("openrouter");
    }
    const sum = modelCalls.reduce((total, entry) => total + (entry.kind === "model" ? (entry.costUsd ?? 0) : 0), 0);
    const first = modelCalls[0]!;
    const second = modelCalls[1]!;
    if (first.kind === "model" && second.kind === "model") {
      console.info(
        `[sandbox-live] ход 1: обращений ${modelCalls.length}, вызовов инструментов ${toolCalls.length}; ` +
          `обращение 1: вход ${first.usage?.inputTokens} (кэш ${first.usage?.cachedInputTokens}), выход ${first.usage?.outputTokens}, ${first.costUsd} $; ` +
          `обращение 2: вход ${second.usage?.inputTokens} (кэш ${second.usage?.cachedInputTokens}), выход ${second.usage?.outputTokens}, ${second.costUsd} $; сумма ${sum} $`,
      );
    }

    // Цифры журнала сходятся с записью расходов чата.
    const database = new Database(databaseFile, { readonly: true });
    const usageRow = database.prepare("select count(*) as n from sandbox_model_calls").get() as { n: number };
    database.close();
    expect(usageRow.n).toBe(modelCalls.length);
  }, 180_000);

  it("правка ответа и результата find_videos: следующий ход опирается на правленое", async () => {
    const answer = await lastAnswer(chatId);
    const findCall = answer.parts.find((part) => part.type === "tool-find_videos")!;
    const edited = await json<{ messageId: string }>(
      await call("POST", `/api/sandbox/chats/${chatId}/messages/${answer.id}/answer-edit`, {
        text: "Нашёл видео «СИНЯЯ ЗЕБРА». Кодовое слово этого ответа: ПОМИДОР-42.",
        toolOutputs: { [findCall.toolCallId!]: { найдено: [{ id: "gradient-descent", title: "СИНЯЯ ЗЕБРА" }] } },
      }),
    );
    expect(edited.messageId).not.toBe(answer.id);
    const before = (await journalOf(chatId)).length;

    await ask(chatId, "Какое кодовое слово было в твоём прошлом ответе и как называется видео, которое нашёл find_videos? Не вызывай инструменты.");
    const reply = answerText(await lastAnswer(chatId));
    console.info(`[sandbox-live] после правки модель ответила: ${reply.replace(/\s+/g, " ").slice(0, 200)}`);
    expect(reply).toContain("ПОМИДОР-42");

    // Правленый текст виден в сообщениях обращения к модели в журнале.
    const entries = (await journalOf(chatId)).slice(before).filter((entry) => entry.kind === "model");
    const last = await details(entries.at(-1)!.id);
    if (last.kind !== "model") throw new Error("ожидалось обращение к модели");
    expect(JSON.stringify(last.messages.map((message) => message.content))).toContain("ПОМИДОР-42");
    expect(JSON.stringify(last.messages.map((message) => message.content))).toContain("СИНЯЯ ЗЕБРА");
  }, 180_000);

  it("своя инструкция чата меняет поведение; «вернуть боевую» её убирает", async () => {
    const marker = "Йо-хо-хо!";
    const set = await json<SandboxSettingsResponse>(
      await call("PUT", `/api/sandbox/chats/${chatId}/settings`, { instructions: `Ты пират. Каждый ответ начинай словами «${marker}». Отвечай по-русски, коротко.` }),
    );
    expect(set.instructions).toContain("пират");
    const before = (await journalOf(chatId)).length;
    await ask(chatId, "Привет, как дела? Не вызывай инструменты.");
    const reply = answerText(await lastAnswer(chatId));
    console.info(`[sandbox-live] ответ с пиратской инструкцией: ${reply.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(reply).toContain("Йо-хо-хо");
    const entries = (await journalOf(chatId)).slice(before).filter((entry) => entry.kind === "model");
    const recorded = await details(entries[0]!.id);
    if (recorded.kind !== "model") throw new Error("ожидалось обращение к модели");
    expect(JSON.stringify(recorded.instructions.content)).toContain("пират");

    await json(await call("PUT", `/api/sandbox/chats/${chatId}/settings`, { instructions: null }));
    const reset = await json<SandboxSettingsResponse>(await call("GET", `/api/sandbox/chats/${chatId}/settings`));
    expect(reset.instructions).toBeNull();
  }, 180_000);

  it("смена модели: следующее обращение уходит к GLM 5.3 Flash", async () => {
    await json(await call("PUT", `/api/sandbox/${chatId}/model`, { modelId: "glm-5.3-flash", providerId: "openrouter", reasoning: "low" }));
    const before = (await journalOf(chatId)).length;
    await ask(chatId, "Ответь одним словом: «ок». Не вызывай инструменты.");
    const entries = (await journalOf(chatId)).slice(before).filter((entry) => entry.kind === "model");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.kind === "model" && entry.modelId === "glm-5.3-flash")).toBe(true);
    const answer = await lastAnswer(chatId);
    expect(answer.metadata?.status).toBe("complete");
  }, 180_000);

  it("итоги: траты по журналу и ключа в журнале нет", async () => {
    await demo.flush();
    for (const entry of await journalOf(chatId)) {
      if (entry.kind !== "model") continue;
      spent.calls += 1;
      spent.costUsd += entry.costUsd ?? 0;
      spent.inputTokens += entry.usage?.inputTokens ?? 0;
      spent.cachedTokens += entry.usage?.cachedInputTokens ?? 0;
      spent.outputTokens += entry.usage?.outputTokens ?? 0;
    }
    console.info(
      `[sandbox-live] ИТОГО по журналу: обращений ${spent.calls}, вход ${spent.inputTokens} (из кэша ${spent.cachedTokens}), выход ${spent.outputTokens}, цена ${spent.costUsd.toFixed(6)} $`,
    );
    expect(spent.costUsd).toBeLessThan(0.5);

    // Журнал сходится с записью расходов: те же токены и та же цена, записи принадлежат песочному владельцу, боевых трат у админа нет.
    const ledger = new Database(databaseFile, { readonly: true });
    const sandboxRows = ledger.prepare("select count(*) n, sum(input_tokens) i, sum(cached_input_tokens) c, sum(output_tokens) o, sum(cost_usd) usd from usage_records where owner_id = 'sandbox:anna'").get() as Record<string, number>;
    const battleRows = ledger.prepare("select count(*) n from usage_records where owner_id = 'anna'").get() as { n: number };
    ledger.close();
    console.info(`[sandbox-live] запись расходов sandbox:anna: ${sandboxRows.n} зап., вход ${sandboxRows.i} (кэш ${sandboxRows.c}), выход ${sandboxRows.o}, ${sandboxRows.usd} $; боевых у anna: ${battleRows.n}`);
    expect(sandboxRows.i).toBe(spent.inputTokens);
    expect(sandboxRows.c).toBe(spent.cachedTokens);
    expect(sandboxRows.o).toBe(spent.outputTokens);
    expect(sandboxRows.usd).toBeCloseTo(spent.costUsd, 9);
    expect(battleRows.n).toBe(0);

    // Поиск ключа по всей базе: все куски журнала (после gzip), все текстовые поля таблиц журнала и сами файлы базы.
    const database = new Database(databaseFile, { readonly: true });
    const blobs = database.prepare("select data from sandbox_blobs").all() as Array<{ data: Buffer }>;
    expect(blobs.length).toBeGreaterThan(0);
    const holders = blobs.filter((blob) => gunzipSync(blob.data).toString("utf8").includes(apiKey!)).length;
    const tables = (database.prepare("select name from sqlite_master where type='table' and name like 'sandbox_%' and name != 'sandbox_blobs'").all() as Array<{ name: string }>).map((row) => row.name);
    let tableHits = 0;
    for (const table of tables) {
      for (const row of database.prepare(`select * from ${table}`).all() as Array<Record<string, unknown>>) {
        if (JSON.stringify(row).includes(apiKey!)) tableHits += 1;
      }
    }
    database.close();
    const fileHits = readdirSync(folder).filter((name) => name.startsWith("live.sqlite") && readFileSync(join(folder, name)).includes(apiKey!)).length;
    console.info(`[sandbox-live] ключ в кусках журнала: ${holders} из ${blobs.length}; в таблицах: ${tableHits} (${tables.length} табл.); в файлах базы: ${fileHits}`);
    expect(holders).toBe(0);
    expect(tableHits).toBe(0);
  }, 60_000);
});
