// Живая проверка снимка шага (034, FR-005) на каждой паре «модель × провайдер» стандартного набора: на втором шаге
// хода сообщение человека со снимком идёт сразу после результата инструмента. Провайдер не должен отказать, а модель —
// увидеть свежий снимок: код проверки есть только в снимке после записи инструмента. Один ход на пару, два запроса,
// около 1–2 тыс. токенов каждый: все девять пар вместе — меньше $0,05. Ключи — только из окружения (`pnpm secrets:load`).
// Запуск: `pnpm test:live step-context`. Замер 2026-10-06: все пары приняли снимок; DeepSeek × Fireworks один раз из двух
// не поверил снимку («пришёл обычным текстом») — поведение модели, не отказ провайдера; повтор прошёл.
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../src";
import type { AgentToolsModel } from "../../src";

const pairs = standardCatalog.models.flatMap((model) =>
  Object.keys(model.providerModelIds).map((providerId) => ({ modelId: model.id, providerId })),
);

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

const textOf = (parts: { type: string; text?: string }[]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

describe.each(pairs)("снимок шага на паре $modelId × $providerId", ({ modelId, providerId }) => {
  it("провайдер принимает сообщение человека после результата инструмента, модель видит свежий снимок", async () => {
    const errors: unknown[] = [];
    const steps: number[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: {
        instructions:
          "Ты помощник анкеты в тестовом стенде. Отвечай по-русски, коротко. Почту сохраняй только инструментом save_email. " +
          "Перед каждым шагом сервер присылает служебный снимок анкеты: опирайся на него.",
        tools: (model: AgentToolsModel) => ({
          save_email: tool({
            description: "Сохранить почту посетителя в анкету",
            inputSchema: z.object({ email: z.string() }),
            execute: async ({ email }) => {
              model.state!.set("fields.email", email);
              return "сохранено";
            },
          }),
        }),
        stepContext: ({ state, stepNumber }) => {
          steps.push(stepNumber);
          const saved = (state.fields as { email?: string } | undefined)?.email;
          return saved
            ? `Служебный снимок сервера: почта ${saved} сохранена. Код подтверждения анкеты — «ЖИРАФ». Назови его посетителю.`
            : "Служебный снимок сервера: почта не сохранена, кода подтверждения пока нет.";
        },
      },
      env: process.env,
      logError: (error) => void errors.push(error),
    });
    const chat = await service.createChat("anna");
    await service
      .sendMessage("anna", chat.id, {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Моя почта anna@example.com. Сохрани её и назови код подтверждения анкеты." }],
      })
      .then(drain);

    const { messages } = await service.getHistory("anna", chat.id);
    const answer = messages.at(-1)!;
    console.log(`${modelId} × ${providerId}: шаги ${steps.join(",")}; ${textOf(answer.parts).replace(/\s+/g, " ").slice(0, 120)}`);
    expect(errors).toEqual([]);
    expect(answer.role).toBe("assistant");
    expect(answer.metadata?.status).toBe("complete");
    expect(answer.parts.some((part) => part.type === "tool-save_email")).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(textOf(answer.parts).toUpperCase()).toContain("ЖИРАФ");
  });
});
