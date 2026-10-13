// Живая проверка на настоящей модели: правка и переключение веток. Модель видит только текущую ветку,
// а сжатие, сделанное на одной ветке, на другой молчит. Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
import { describe, expect, it } from "vitest";
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../src";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

function createService(compaction?: { thresholdTokens: number; tailTokens: number; summaryCeilingTokens: number }) {
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
    agent: { instructions: "Ты помощник. Отвечай по-русски, коротко." },
    ...(compaction && { compaction }),
    env: process.env,
  });
  return service;
}

const textOf = (parts: { type: string; text?: string }[]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

describe("ветки на DeepSeek 4.1 Flash", () => {
  it(
    "правка: модель не знает прежнюю ветку; переключение назад: знает; переделка даёт второй вариант",
    async () => {
      const service = createService();
      const chat = await service.createChat("anna");
      const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
      const lastAnswerText = async () => {
        const { messages } = await service.getHistory("anna", chat.id);
        return textOf(messages.findLast((message) => message.role === "assistant")?.parts ?? []);
      };

      await drain(await service.sendMessage("anna", chat.id, user("q1", "Меня зовут Пётр. Ответь одним словом: принято.")));
      await drain(await service.editMessage("anna", chat.id, "q1", user("q1-edit", "Меня зовут Иван. Ответь одним словом: принято.")));

      // После правки — ветка с Иваном; о Петре модель не знает.
      await drain(await service.sendMessage("anna", chat.id, user("q2", "Как меня зовут? Ответь одним словом, только имя.")));
      const afterEdit = await lastAnswerText();
      console.log(`После правки: ${afterEdit}`);
      expect(afterEdit).toContain("Иван");
      expect(afterEdit).not.toContain("Пётр");

      // Возврат к первой ветке: там Пётр.
      const history = await service.selectBranch("anna", chat.id, "q1");
      expect(history.messages.find((message) => message.role === "user")?.id).toBe("q1");
      await drain(await service.sendMessage("anna", chat.id, user("q3", "Как меня зовут? Ответь одним словом, только имя.")));
      const afterSwitch = await lastAnswerText();
      console.log(`После возврата: ${afterSwitch}`);
      expect(afterSwitch).toContain("Пётр");
      expect(afterSwitch).not.toContain("Иван");

      // Переделка последнего ответа: второй вариант рядом с первым.
      const last = (await service.getHistory("anna", chat.id)).messages.findLast((message) => message.role === "assistant")!;
      await drain(await service.regenerate("anna", chat.id, last.id));
      const { forks } = await service.getBranchForks("anna", chat.id);
      expect(forks.some((fork) => fork.siblingIds.length === 2 && fork.siblingIds.includes(last.id))).toBe(true);
    },
    240_000,
  );

  it(
    "сжатие, сделанное на одной ветке, на другой молчит и возвращается вместе с веткой",
    async () => {
      const service = createService({ thresholdTokens: 1500, tailTokens: 300, summaryCeilingTokens: 700 });
      const chat = await service.createChat("anna");
      const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
      const ask = async (id: string, text: string) => drain(await service.sendMessage("anna", chat.id, user(id, text)));

      await ask("q1", "Запомни: код от сейфа 4471. Ответь одним словом: принято.");
      for (const [index, topic] of ["парусный спорт", "выпечку хлеба", "устройство мостов"].entries()) {
        await ask(`q${index + 2}`, `Расскажи подробно, примерно на 250 слов, про ${topic}.`);
      }
      await expect
        .poll(async () => (await service.getCompactions("anna", chat.id)).compactions.length, { timeout: 120_000, interval: 1_000 })
        .toBeGreaterThan(0);
      await expect
        .poll(async () => (await service.getCompactions("anna", chat.id)).compacting, { timeout: 120_000, interval: 500 })
        .toBe(false);

      // Правка первого вопроса: новая ветка, сводки старой ветки на ней нет, модель о коде не знает.
      await drain(await service.editMessage("anna", chat.id, "q1", user("q1-edit", "Запомни: код от сейфа 9902. Ответь одним словом: принято.")));
      expect((await service.getCompactions("anna", chat.id)).compactions).toHaveLength(0);
      await ask("q5", "Какой код от сейфа? Ответь одним числом.");
      const { messages } = await service.getHistory("anna", chat.id);
      const answer = textOf(messages.findLast((message) => message.role === "assistant")?.parts ?? []);
      console.log(`Ответ на новой ветке: ${answer}`);
      expect(answer).toContain("9902");
      expect(answer).not.toContain("4471");

      // Возврат: сводка на месте.
      await service.selectBranch("anna", chat.id, "q1");
      expect((await service.getCompactions("anna", chat.id)).compactions.length).toBeGreaterThan(0);
    },
    420_000,
  );
});
