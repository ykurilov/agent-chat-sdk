// Живая проверка виджетов (024, SC-008): настоящая модель по просьбе «уточни тариф кнопками» зовёт `ask_choice`, ход встаёт
// на паузу «ждёт человека»; ответ через `answerWidget` продолжает тот же ход, выбранный вариант есть в тексте модели.
// Тест падает только от поломок нашей стороны; сам вызов `ask_choice` обязателен (SC-008), поэтому просьба и модель подобраны
// так, чтобы он случался стабильно: до двух попыток. Ключ — только из окружения (`pnpm secrets:load`). Запуск: `pnpm test:live widgets`.
import { describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatService } from "../../src/chat-service";
import type { AgentChatMessage } from "../../src/conversation/types";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "deepseek-4.1-flash";
const providerId = "openrouter";
const ownerId = "widgets-tester";
const plans = ["Базовый", "Стандарт", "Про"];
const chosen = "Стандарт";
const maxAttempts = 2;

function setup() {
  return createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: {
      instructions: "Ты помощник по подписке. Отвечай по-русски, коротко. Когда нужно уточнить выбор, спрашивай кнопками, а не текстом. Уточняй только тариф; получив выбор, подтверди его одной фразой и больше ничего не спрашивай.",
      widgets: { basic: true },
    },
    env: process.env,
  });
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}

async function lastAnswer(service: ChatService, chatId: string): Promise<AgentChatMessage> {
  const { messages } = await service.getHistory(ownerId, chatId);
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

/** Продолжение идёт в фоне на сервере: ждём, пока ответ перестанет стримиться. */
async function untilSettled(service: ChatService, chatId: string): Promise<AgentChatMessage> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const answer = await lastAnswer(service, chatId);
    if (answer.metadata?.status !== "streaming") return answer;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("ход не закончился за две минуты");
}

const textOf = (answer: AgentChatMessage) => answer.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

describe("виджеты у настоящей модели (OpenRouter)", () => {
  it("«уточни тариф кнопками»: модель зовёт ask_choice, ответ человека продолжает ход, выбор виден в тексте", async () => {
    const service = setup();
    let chatId = "";
    let waiting: AgentChatMessage | undefined;
    let call: { toolCallId: string; input: { question: string; options: string[] } } | undefined;
    let attempts = 0;
    for (; attempts < maxAttempts && !call; attempts++) {
      chatId = (await service.createChat(ownerId)).id;
      await drain(
        await service.sendMessage(ownerId, chatId, {
          id: `u-${attempts}`,
          role: "user",
          parts: [{ type: "text", text: `Хочу оформить подписку. Уточни у меня тариф кнопками: ${plans.join(", ")}.` }],
        }),
      );
      waiting = await lastAnswer(service, chatId);
      call = waiting.parts.find((part) => part.type === "tool-ask_choice" && part.state === "input-available") as typeof call;
    }
    console.info(`[widgets-result] попыток до ask_choice: ${attempts}, вызов: ${call ? "да" : "нет"}`);

    // SC-008: вызов должен реально случиться.
    expect(call, `модель не позвала ask_choice: ${JSON.stringify(waiting?.parts)}`).toBeTruthy();
    expect(waiting!.metadata?.status).toBe("awaiting_approval");
    expect(call!.input.options).toEqual(expect.arrayContaining([chosen]));

    const { resumed } = await service.answerWidget({ chatId, ownerId, toolCallId: call!.toolCallId, answer: { выбрано: chosen } });
    expect(resumed).toBe(true);
    const finished = await untilSettled(service, chatId);

    expect(finished.metadata?.status, JSON.stringify(finished.parts)).toBe("complete");
    expect(finished.id).toBe(waiting!.id);
    const stored = finished.parts.find((part) => part.type === "tool-ask_choice") as { state: string; output?: unknown } | undefined;
    expect(stored?.state).toBe("output-available");
    // Выбор человека дошёл до модели: это поведение модели, но без него продолжение бессмысленно.
    console.info(`[widgets-result] ответ модели: ${textOf(finished).slice(0, 200)}`);
    expect(textOf(finished)).toContain(chosen);
  }, 240_000);
});
