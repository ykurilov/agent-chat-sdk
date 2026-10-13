// Живая проверка приветствия (029, SC-003) на каждой паре «модель × провайдер» стандартного набора: чат начинается
// ответом агента (приветствием), перед ним в запросе стоит служебная строка; провайдер не отказывает, а модель видит
// приветствие в истории. Ключи — только из окружения (`pnpm secrets:load`). Запуск: `pnpm test:live greeting`.
import { describe, expect, it } from "vitest";
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../src";

const pairs = standardCatalog.models.flatMap((model) =>
  Object.keys(model.providerModelIds).map((providerId) => ({ modelId: model.id, providerId })),
);

const greeting = { text: "Здравствуйте! Я помощник урока «Дроби». Кодовое слово этого урока — «ананас». С чего начнём?" };

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

const textOf = (parts: { type: string; text?: string }[]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

describe.each(pairs)("приветствие на паре $modelId × $providerId", ({ modelId, providerId }) => {
  it("провайдер принимает чат, начатый агентом, модель видит приветствие", async () => {
    const errors: unknown[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: { instructions: "Ты помощник урока. Отвечай по-русски, коротко." },
      env: process.env,
      logError: (error) => void errors.push(error),
    });
    const chat = await service.createChat("anna", { greeting });
    await service
      .sendMessage("anna", chat.id, {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Какое кодовое слово урока ты назвал в первом сообщении? Ответь одним словом." }],
      })
      .then(drain);

    const { messages } = await service.getHistory("anna", chat.id);
    const answer = messages.at(-1)!;
    console.log(`${modelId} × ${providerId}: ${textOf(answer.parts).replace(/\s+/g, " ").slice(0, 120)}`);
    expect(errors).toEqual([]);
    expect(answer.role).toBe("assistant");
    expect(answer.metadata?.status).toBe("complete");
    expect(textOf(answer.parts).toLowerCase()).toContain("ананас");
  });
});
