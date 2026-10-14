import { describe, expect, it } from "vitest";
import { foreignWords, unknownLinks, type ReplyCheck } from "../src";
import { replyInput } from "./support/reply-input";

/** Как ядро гоняет `replyChecks`: по очереди, текст каждой следующей проверки — результат предыдущей. */
async function runChain(checks: readonly ReplyCheck[], text: string, rewrite: (system: string, prompt: string) => string) {
  let current = text;
  const notes: string[] = [];
  for (const check of checks) {
    const { input } = replyInput(current, { seenTexts: ["Запись: https://school.example/course"], rewrite: ({ system, prompt }) => rewrite(system, prompt) });
    const result = await check(input);
    if (result) {
      current = result.text;
      if (result.note) notes.push(result.note);
    }
  }
  return { text: current, notes };
}

describe("[foreignWords(), unknownLinks()] вместе", () => {
  it("ответ с иероглифом и выдуманной ссылкой чинится двумя переписками; в журнале две заметки", async () => {
    const answers: string[] = ["Это часть истории вашей семьи: https://fake.ru/a", "Это часть истории вашей семьи."];
    const result = await runChain([foreignWords({ script: "cyrillic" }), unknownLinks()], "Это часть 歷史 вашей семьи: https://fake.ru/a", () => answers.shift()!);
    expect(result.text).toBe("Это часть истории вашей семьи.");
    expect(result.notes).toHaveLength(2);
  });

  it("законная ссылка из инструкции остаётся", async () => {
    const result = await runChain([foreignWords({ script: "cyrillic" }), unknownLinks()], "Курс: https://school.example/course", () => {
      throw new Error("переписка не нужна");
    });
    expect(result).toEqual({ text: "Курс: https://school.example/course", notes: [] });
  });
});
