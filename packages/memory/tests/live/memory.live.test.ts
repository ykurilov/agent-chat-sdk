// Живая проверка долгой памяти на каждой паре «модель × провайдер» стандартного набора: модель сохраняет просьбу «запомни»,
// в новом чате пользуется записью, а по просьбе «забудь» удаляет её. Ключи — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live memory`. В вывод идут вызовы инструмента и ответы: по ним глазами проверяют инструкцию и описание инструмента.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../../src/create-long-term-memory";

const pairs = standardCatalog.models.flatMap((model) =>
  Object.keys(model.providerModelIds).map((providerId) => ({ modelId: model.id, providerId })),
);

const ownerId = "live";
const assistantText = (message: AgentChatMessage | undefined) =>
  (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");

function setup(modelId: string, providerId: string) {
  const storage = createInMemoryChatStorage();
  const memory = createLongTermMemory({ storage });
  const service = createChatService({
    storage,
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId },
    agent: { instructions: "Ты помощник в тестовом стенде. Отвечай по-русски, коротко.", maxSteps: 6 },
    memory,
    env: process.env,
  });
  let counter = 0;
  /** Новый чат, одно сообщение человека; возвращает последний ответ агента. */
  async function askInNewChat(text: string) {
    const chat = await service.createChat(ownerId);
    const stream = await service.sendMessage(ownerId, chat.id, { id: `u${(counter += 1)}`, role: "user", parts: [{ type: "text", text }] });
    for await (const _chunk of stream) {
      // ход дочитывается до конца
    }
    const { messages } = await service.getHistory(ownerId, chat.id);
    const answer = messages.findLast((message) => message.role === "assistant");
    const calls = (answer?.parts ?? []).filter((part) => part.type.startsWith("tool-"));
    return { text: assistantText(answer), calls };
  }
  const notes = async () => (await storage.listMemoryNotes!(ownerId)).map((note) => note.content);
  return { askInNewChat, notes };
}

function logTurn(label: string, turn: { text: string; calls: unknown[] }) {
  console.log(`[${label}] ответ: ${turn.text}\n[${label}] вызовы: ${JSON.stringify(turn.calls)}`);
}

describe.each(pairs)("живая память: $modelId × $providerId", ({ modelId, providerId }) => {
  it(
    "сохраняет по «запомни», использует в новом чате, удаляет по «забудь»",
    async () => {
      const { askInNewChat, notes } = setup(modelId, providerId);

      const saved = await askInNewChat("Запомни: я пишу на Rust, а пакеты ставлю только через pnpm, npm не люблю.");
      logTurn("запомни", saved);
      expect(saved.calls.length, "модель вызвала инструмент памяти").toBeGreaterThan(0);
      const afterSave = (await notes()).join(" | ");
      expect(afterSave, `записи: ${afterSave}`).toMatch(/pnpm/i);
      expect(afterSave, `записи: ${afterSave}`).toMatch(/rust/i);

      const used = await askInNewChat("На каком языке я пишу и каким менеджером пакетов пользуюсь? Ответь одной строкой.");
      logTurn("новый чат", used);
      expect(used.text, `ответ: ${used.text}`).toMatch(/rust/i);
      expect(used.text, `ответ: ${used.text}`).toMatch(/pnpm/i);

      const forgotten = await askInNewChat("Забудь всё, что я говорил про пакеты и npm.");
      logTurn("забудь", forgotten);
      const afterForget = (await notes()).join(" | ");
      expect(afterForget, `записи после «забудь»: ${afterForget}`).not.toMatch(/pnpm/i);
    },
    240_000,
  );
});
