// Живая проверка песочницы на модели Anthropic (026, T047): Claude Haiku 4.5 через OpenRouter с рассуждениями.
// Цель: после правки ответа (рассуждения убраны) и результата инструмента следующий ход проходит без ошибки провайдера,
// а модель видит правленый текст и результат. В стандартном каталоге Claude нет, профиль добавлен только в этом тесте.
// Ключ — только из окружения (`pnpm secrets:load`). Запуск: `pnpm test:live sandbox-anthropic`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JournalCallResponse, JournalListResponse } from "../../src/index";

vi.mock("@ykurilov/agent-chat-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ykurilov/agent-chat-core")>();
  const haiku = {
    id: "claude-haiku-4.5",
    displayName: "Claude Haiku 4.5",
    contextWindowTokens: 200_000,
    acceptsImages: true,
    reasoning: { replayPastTurns: true, levels: ["low", "medium", "high"], defaultLevel: "medium" },
    providerModelIds: { openrouter: "anthropic/claude-haiku-4.5" },
    pricing: { openrouter: { inputPerMillion: 1, outputPerMillion: 5, cachedInputPerMillion: 0.1, cacheWritePerMillion: 1.25 } },
  } as const;
  return { ...original, standardCatalog: original.extendCatalog(original.standardCatalog, { addModels: [haiku as never] }) };
});

const { createDemoApp } = await import("../../../../apps/demo/server/demo-app");

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelChoice = { modelId: "claude-haiku-4.5", providerId: "openrouter", reasoning: "medium" };
const budgetUsd = 0.3;
const folder = mkdtempSync(join(tmpdir(), "sandbox-anthropic-live-"));
let demo: Awaited<ReturnType<typeof createDemoApp>>;

beforeAll(async () => {
  demo = await createDemoApp({ databaseFile: join(folder, "live.sqlite"), model: "live", env: { OPENROUTER_API_KEY: apiKey, DEMO_ADMIN_IDS: "anna" } });
});

afterAll(async () => {
  await demo.flush();
  demo.close();
  rmSync(folder, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return demo.app.request(`http://localhost${path}`, {
    method,
    headers: { cookie: "demo-user=anna", "content-type": "application/json", origin: "http://localhost" },
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
    message: { id: `anthropic-u-${++turnCounter}`, role: "user", parts: [{ type: "text", text }] },
  });
  expect(response.status).toBe(200);
  await response.text();
  await demo.flush();
}

interface Part {
  type: string;
  text?: string;
  toolCallId?: string;
}
interface Message {
  id: string;
  role: string;
  parts: Part[];
  metadata?: { status?: string; error?: unknown };
}

async function lastAnswer(chatId: string): Promise<Message> {
  const { messages } = await json<{ messages: Message[] }>(await call("GET", `/api/sandbox/${chatId}`));
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

const answerText = (message: Message) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");

async function modelCalls(chatId: string) {
  const { entries } = await json<JournalListResponse>(await call("GET", `/api/sandbox/chats/${chatId}/journal`));
  return entries.filter((entry) => entry.kind === "model");
}

describe("песочница на Claude Haiku 4.5 через OpenRouter, рассуждения включены", () => {
  it("правка ответа и результата инструмента: следующие ходы проходят без ошибки провайдера", async () => {
    const { id: chatId } = await json<{ id: string }>(await call("POST", "/api/sandbox"));
    await json(await call("PUT", `/api/sandbox/${chatId}/model`, modelChoice));

    await ask(chatId, "Найди в каталоге видео про градиентный спуск, вызови find_videos, и назови его название. Сначала подумай.");
    const first = await lastAnswer(chatId);
    expect(first.metadata?.status, JSON.stringify(first.metadata)).toBe("complete");
    const findCall = first.parts.find((part) => part.type === "tool-find_videos");
    expect(findCall, "модель не вызвала find_videos").toBeDefined();
    const reasoningParts = first.parts.filter((part) => part.type === "reasoning").length;
    console.info(`[anthropic-live] ход 1: частей рассуждений ${reasoningParts}, обращений ${(await modelCalls(chatId)).length}`);
    expect(reasoningParts, "рассуждения не пришли — проверка бессмысленна").toBeGreaterThan(0);

    const edited = await json<{ messageId: string }>(
      await call("POST", `/api/sandbox/chats/${chatId}/messages/${first.id}/answer-edit`, {
        text: "Нашёл видео «СИНЯЯ ЗЕБРА». Кодовое слово этого ответа: ПОМИДОР-42.",
        toolOutputs: { [findCall!.toolCallId!]: { найдено: [{ id: "gradient-descent", title: "СИНЯЯ ЗЕБРА" }] } },
      }),
    );
    const { messages } = await json<{ messages: Message[] }>(await call("GET", `/api/sandbox/${chatId}`));
    const editedMessage = messages.find((message) => message.id === edited.messageId)!;
    expect(editedMessage.parts.some((part) => part.type === "reasoning")).toBe(false);

    const before = (await modelCalls(chatId)).length;
    await ask(chatId, "Какое кодовое слово было в твоём прошлом ответе и как называется видео, которое нашёл find_videos? Не вызывай инструменты.");
    const second = await lastAnswer(chatId);
    expect(second.metadata?.status, JSON.stringify(second.metadata)).toBe("complete");
    const reply = answerText(second);
    console.info(`[anthropic-live] после правки: ${reply.replace(/\s+/g, " ").slice(0, 200)}; рассуждений в ответе ${second.parts.filter((part) => part.type === "reasoning").length}`);
    expect(reply).toContain("ПОМИДОР-42");
    expect(reply).toContain("СИНЯЯ ЗЕБРА");

    // Ещё один ход: теперь в истории и правленый ответ без рассуждений, и новый ответ с рассуждениями.
    await ask(chatId, "Повтори кодовое слово целиком, вместе с цифрами. Не вызывай инструменты.");
    const third = await lastAnswer(chatId);
    expect(third.metadata?.status, JSON.stringify(third.metadata)).toBe("complete");
    expect(answerText(third)).toContain("ПОМИДОР");

    const entries = await modelCalls(chatId);
    expect(entries.length).toBeGreaterThan(before);
    let costUsd = 0;
    for (const entry of entries) {
      if (entry.kind !== "model") continue;
      const recorded = await json<JournalCallResponse>(await call("GET", `/api/sandbox/journal/calls/${entry.id}`));
      expect(recorded.kind === "model" && recorded.call.error, `ошибка в журнале: ${JSON.stringify(recorded)}`).toBeFalsy();
      costUsd += entry.costUsd ?? 0;
      console.info(`[anthropic-live] обращение: вход ${entry.usage?.inputTokens} (кэш ${entry.usage?.cachedInputTokens}), выход ${entry.usage?.outputTokens}, ${entry.costUsd} $`);
    }
    console.info(`[anthropic-live] ИТОГО: обращений ${entries.length}, цена ${costUsd.toFixed(6)} $`);
    expect(costUsd).toBeLessThan(budgetUsd);
  }, 240_000);
});
