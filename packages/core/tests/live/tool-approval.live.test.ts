// Живая проверка подтверждения действий на каждой паре «модель × провайдер» (011): ход останавливается на опасном
// инструменте, после «Разрешить» инструмент выполняется ровно раз и модель дописывает ответ в то же сообщение;
// после «Отклонить» модель знает об отказе. Ключи — только из окружения. Запуск: `pnpm test:live tool-approval`.
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import type { ChatService } from "../../src/chat-service";
import type { AgentChatMessage } from "../../src/conversation/types";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";

const pairs = standardCatalog.models.flatMap((model) =>
  Object.keys(model.providerModelIds).map((providerId) => ({ modelId: model.id, providerId })),
);

const secretCode = "ключ-7391";

function setup(modelId: string, providerId: string) {
  const executed: string[] = [];
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: {
      instructions: [
        "Ты помощник в тестовом стенде. Когда просят стереть заметки, вызывай инструмент erase_notes и ничего не делай без него.",
        "После результата инструмента ответь одной короткой фразой по-русски. Если инструмент отклонён человеком, скажи, что не тронул заметки.",
      ].join("\n"),
      tools: {
        erase_notes: tool({
          title: "Стереть заметки",
          description: "Безвозвратно стирает заметки в папке. Человек подтверждает действие. Возвращает контрольный код.",
          inputSchema: z.object({ folder: z.string().describe("Папка с заметками") }),
          needsApproval: true,
          execute: async ({ folder }) => {
            executed.push(folder);
            return `Заметки в «${folder}» стёрты, контрольный код ${secretCode}.`;
          },
        }),
      },
    },
    env: process.env,
  });
  return { service, executed };
}

async function ask(service: ChatService) {
  const chat = await service.createChat("live");
  const stream = await service.sendMessage("live", chat.id, {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "Сотри заметки в папке «старое»." }],
  });
  await drain(stream);
  return chat.id;
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}

async function lastAnswer(service: ChatService, chatId: string): Promise<AgentChatMessage> {
  const { messages } = await service.getHistory("live", chatId);
  return messages.filter((message) => message.role === "assistant").at(-1)!;
}

/** Ждёт, пока ход после решения закончится (продолжение идёт в фоне на сервере). */
async function untilComplete(service: ChatService, chatId: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const answer = await lastAnswer(service, chatId);
    if (answer.metadata?.status !== "streaming") return answer;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("ход не закончился за две минуты");
}

const approvalIdOf = (answer: AgentChatMessage) =>
  (answer.parts.find((part) => part.type === "tool-erase_notes") as { approval?: { id: string } } | undefined)?.approval?.id;

const textOf = (answer: AgentChatMessage) =>
  answer.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

describe.each(pairs)("живая проверка подтверждения: $modelId × $providerId", ({ modelId, providerId }) => {
  it("«Разрешить»: инструмент выполнен один раз, ответ дописан в то же сообщение", async () => {
    const { service, executed } = setup(modelId, providerId);
    const chatId = await ask(service);

    const waiting = await lastAnswer(service, chatId);
    expect(waiting.metadata?.status, JSON.stringify(waiting.parts)).toBe("awaiting_approval");
    expect(executed).toEqual([]);
    const approvalId = approvalIdOf(waiting);
    expect(approvalId).toBeTruthy();

    const { resumed } = await service.answerApproval("live", chatId, approvalId!, "allow");
    expect(resumed).toBe(true);
    const finished = await untilComplete(service, chatId);

    expect(finished.metadata?.status, JSON.stringify(finished.metadata)).toBe("complete");
    expect(finished.id).toBe(waiting.id);
    expect(executed).toEqual(["старое"]);
    expect(textOf(finished).length).toBeGreaterThan(0);
    const { messages } = await service.getHistory("live", chatId);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("«Отклонить»: инструмент не выполнен, модель отвечает после отказа", async () => {
    const { service, executed } = setup(modelId, providerId);
    const chatId = await ask(service);
    const approvalId = approvalIdOf(await lastAnswer(service, chatId));

    await service.answerApproval("live", chatId, approvalId!, "deny");
    const finished = await untilComplete(service, chatId);

    expect(finished.metadata?.status, JSON.stringify(finished.metadata)).toBe("complete");
    expect(executed, JSON.stringify(finished.parts)).toEqual([]);
    expect(textOf(finished).length).toBeGreaterThan(0);
    expect(textOf(finished)).not.toContain(secretCode);
  });
});
