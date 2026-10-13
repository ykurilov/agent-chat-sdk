import { defineWidget } from "@ykurilov/agent-chat-core";
import { z } from "zod";

/**
 * Свой виджет демо: общий модуль сервера (`agent.widgets.custom`) и страницы (`widgets={{ pick_slot: … }}`).
 * Агент предлагает время встречи, человек нажимает на одно из них.
 */
export const pickSlot = defineWidget({
  name: "pick_slot",
  description: "Предложить человеку выбрать время встречи из списка",
  inputSchema: z.object({ slots: z.array(z.string()).min(2).max(6) }),
  answerSchema: z.object({ slot: z.string() }),
  question: (input) => `Выберите время: ${input.slots.join(", ")}`,
});
