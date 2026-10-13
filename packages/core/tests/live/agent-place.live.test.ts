// Живая проверка места на экране (021) на настоящей модели: модель называет задачу из описания места, а серверный инструмент
// получает человека и `data` места и переименовывает именно эту задачу. Ключ — только из окружения (`pnpm secrets:load`).
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../src";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

const place = { description: "Карточка задачи «Купить молоко» (id 7)", data: { taskId: "7" } };

function createService(renamed: { ownerId: string; taskId: unknown; title: string }[]) {
  return createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
    agent: {
      instructions: "Ты помощник по задачам. Отвечай по-русски, коротко. Чтобы переименовать задачу, вызывай rename_task.",
      tools: ({ ownerId, place: current }) => ({
        rename_task: tool({
          description: "Переименовывает задачу, которую человек сейчас смотрит на экране.",
          inputSchema: z.object({ title: z.string().describe("Новое название задачи") }),
          execute: async ({ title }) => {
            const taskId = (current?.data as { taskId?: unknown } | undefined)?.taskId;
            renamed.push({ ownerId, taskId, title });
            return { ok: true };
          },
        }),
      }),
    },
    env: process.env,
  });
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

const textOf = (parts: { type: string; text?: string }[]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

describe("место на экране на DeepSeek 4.1 Flash", () => {
  it("модель называет задачу из места, инструмент получает человека и id из data", async () => {
    const renamed: { ownerId: string; taskId: unknown; title: string }[] = [];
    const service = createService(renamed);
    const chat = await service.createChat("anna");
    const ask = (id: string, text: string) =>
      service
        .sendMessage("anna", chat.id, { id, role: "user", parts: [{ type: "text", text }] }, { page: { place, tabId: "tab-1" } })
        .then(drain);
    const lastAnswerText = async () => {
      const { messages } = await service.getHistory("anna", chat.id);
      return textOf(messages.findLast((message) => message.role === "assistant")?.parts ?? []);
    };

    await ask("u1", "Где я сейчас?");
    const where = await lastAnswerText();
    console.log(`Ответ на «Где я сейчас?»: ${where.replace(/\s+/g, " ").slice(0, 200)}`);
    expect(where.toLowerCase()).toContain("купить молоко");

    await ask("u2", "Переименуй эту задачу в «Купить кефир»");
    expect(renamed).toHaveLength(1);
    expect(renamed[0]!.ownerId).toBe("anna");
    expect(renamed[0]!.taskId).toBe("7");
    expect(renamed[0]!.title.toLowerCase()).toContain("кефир");
  });
});
