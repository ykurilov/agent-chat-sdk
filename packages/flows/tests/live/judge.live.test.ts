// Живая проверка судьи: настоящий microsoft/microsoft-decision-1 через OpenRouter на двух простых условиях.
// Платная (два запроса, около $0,0001). Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
// Запуск: `pnpm test:live judge`.
import { describe, expect, it } from "vitest";
import type { RecordExternalUsageInput } from "@ykurilov/agent-chat-core";
import { createFlowJudge } from "../../src/runtime/judge";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const condition = "Понятны тема курса и продажи";
const goal = "Понять тему курса, аудиторию и текущие продажи.";

describe("судья на настоящем decision-1", () => {
  it("выполнено / не выполнено: вероятности приходят, расход записан с source judge", async () => {
    const usage: RecordExternalUsageInput[] = [];
    const judge = createFlowJudge(
      { fallback: { providerId: "openrouter", modelId: "unused" } },
      () => ({
        askModel: async () => {
          throw new Error("запасная модель в живой проверке не должна понадобиться");
        },
        recordUsage: async (input) => {
          usage.push(input);
        },
        assertWithinLimit: async () => {},
      }),
    );
    const met = await judge.checkClaim({
      ownerId: "live",
      chatId: "live",
      exitId: "intro_clear",
      condition,
      goal,
      why: "Человек назвал тему курса и объём продаж",
      messages: [
        { role: "agent", text: "О чём ваш курс и как идут продажи?" },
        { role: "human", text: "Курс по акварели для новичков. Продаю примерно 5 штук в месяц, в основном через инстаграм." },
      ],
    });
    const notMet = await judge.checkClaim({
      ownerId: "live",
      chatId: "live",
      exitId: "intro_clear",
      condition,
      goal,
      why: "Кажется, всё понятно",
      messages: [
        { role: "agent", text: "О чём ваш курс и как идут продажи?" },
        { role: "human", text: "А вы вообще кто? Зачем вам это знать?" },
      ],
    });
    console.log(JSON.stringify({ met, notMet, usage: usage.map(({ cost, inputTokens, outputTokens, source, modelId }) => ({ cost, inputTokens, outputTokens, source, modelId })) }, null, 2));
    expect(met).toMatchObject({ source: "decision", confirmed: true });
    expect(notMet).toMatchObject({ source: "decision", confirmed: false });
    expect(usage).toHaveLength(2);
    expect(usage.every((entry) => entry.source === "judge")).toBe(true);
    expect(usage.reduce((sum, entry) => sum + entry.cost, 0)).toBeLessThan(0.02);
  });
});
