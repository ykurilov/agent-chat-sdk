import { describe, expect, it } from "vitest";
import { foreignWords } from "../src";
import { FOREIGN_WORDS_INSTRUCTION_CYRILLIC, FOREIGN_WORDS_NOTE } from "../src/foreign-words";
import { replyInput } from "./support/reply-input";

describe("проверка «чужие слова»", () => {
  it("чистый ответ уходит как есть, модель не зовётся", async () => {
    const { input, calls } = replyInput("Понимаю вас.");
    expect(await foreignWords({ script: "cyrillic" })(input)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("чужие слова — модель переписывает один раз; чисто — уходит переписанный, в журнал заметка", async () => {
    const { input, calls } = replyInput("Actually, это важно.", { rewrite: () => "На самом деле это важно." });
    const result = await foreignWords({ script: "cyrillic" })(input);
    expect(result).toMatchObject({ text: "На самом деле это важно." });
    expect(result?.note).toContain("чужие слова");
    expect(result?.note).toContain("переписан");
    expect(result?.note).toContain("Actually");
    expect(calls).toHaveLength(1);
  });

  it("модели уходит неизменная инструкция и текст со списком чужих слов после него — под кэш", async () => {
    const first = replyInput("Actually, это важно.", { rewrite: () => "На самом деле это важно." });
    const second = replyInput("Нужно больше 歷史 тут.", { rewrite: () => "Нужно больше истории тут." });
    const check = foreignWords({ script: "cyrillic" });
    await check(first.input);
    await check(second.input);
    expect(first.calls[0]!.system).toBe(second.calls[0]!.system);
    expect(first.calls[0]!.system).toBe(FOREIGN_WORDS_INSTRUCTION_CYRILLIC);
    expect(first.calls[0]!.prompt).toBe(`Actually, это важно.\n\n${FOREIGN_WORDS_NOTE} Actually`);
  });

  it("модели передаются только чужие слова: названия и сокращения — нет", async () => {
    const text = "Actually, пришлю PDF в WhatsApp.";
    const { input, calls } = replyInput(text, { rewrite: () => "На самом деле пришлю PDF в WhatsApp." });
    await foreignWords({ script: "cyrillic" })(input);
    expect(calls[0]!.prompt).toBe(`${text}\n\n${FOREIGN_WORDS_NOTE} Actually`);
  });

  it("слова из seenTexts и knownNames законны", async () => {
    const { input, calls } = replyInput("Запишем в Notion и в airtable.", { seenTexts: ["Работаем в airtable"] });
    expect(await foreignWords({ script: "cyrillic", knownNames: ["Notion"] })(input)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("после переписки чужие слова остались — уходит вариант, где их меньше; второй переписки нет", async () => {
    const better = replyInput("Actually, это 歷史 важно.", { rewrite: () => "Вот это 歷史 важно." });
    expect(await foreignWords({ script: "cyrillic" })(better.input)).toMatchObject({ text: "Вот это 歷史 важно." });
    expect(better.calls).toHaveLength(1);

    const worse = replyInput("Actually, это важно.", { rewrite: () => "Actually, it is 歷史 важно." });
    const result = await foreignWords({ script: "cyrillic" })(worse.input);
    expect(result).toMatchObject({ text: "Actually, это важно." });
    expect(result?.note).toContain("Actually");
    expect(worse.calls).toHaveLength(1);
  });

  it("модель не ответила или вернула пустоту — уходит исходный ответ", async () => {
    const failed = replyInput("Actually, это важно.", {
      rewrite: () => {
        throw new Error("503");
      },
    });
    expect(await foreignWords({ script: "cyrillic" })(failed.input)).toMatchObject({ text: "Actually, это важно." });
    const empty = replyInput("Actually, это важно.", { rewrite: () => "  " });
    expect(await foreignWords({ script: "cyrillic" })(empty.input)).toMatchObject({ text: "Actually, это важно." });
  });

  it("переписанный текст со служебной строкой запроса не принимается", async () => {
    const { input } = replyInput("Actually, это важно.", { rewrite: () => `На самом деле это важно.\n\n${FOREIGN_WORDS_NOTE} Actually` });
    expect(await foreignWords({ script: "cyrillic" })(input)).toMatchObject({ text: "Actually, это важно." });
  });

  it("переписанный текст сильно другой длины не принимается: смысл мог уйти", async () => {
    const original = "Actually, это очень важно для вашего дела, давайте разберём подробно.";
    const short = replyInput(original, { rewrite: () => "Ок." });
    expect(await foreignWords({ script: "cyrillic" })(short.input)).toMatchObject({ text: original });
    const long = replyInput("Actually, это важно.", { rewrite: () => "На самом деле это очень важно, и вот почему: ".repeat(3) });
    expect(await foreignWords({ script: "cyrillic" })(long.input)).toMatchObject({ text: "Actually, это важно." });
  });

  it("допустимую длину переписки задаёт maxLengthRatio", async () => {
    const rewrite = () => "На самом деле это действительно важно.";
    const strict = replyInput("Actually, это важно.", { rewrite });
    expect(await foreignWords({ script: "cyrillic", maxLengthRatio: 1.2 })(strict.input)).toMatchObject({ text: "Actually, это важно." });
    const loose = replyInput("Actually, это важно.", { rewrite });
    expect(await foreignWords({ script: "cyrillic", maxLengthRatio: 2.5 })(loose.input)).toMatchObject({ text: "На самом деле это действительно важно." });
  });
});

describe("проверка «чужие слова» для ответа латиницей", () => {
  it("английский ответ с кириллицей и иероглифами переписывается по-английски", async () => {
    const { input, calls } = replyInput("Sure, привет, this is 歷史.", { rewrite: () => "Sure, hello, this is history." });
    const result = await foreignWords({ script: "latin" })(input);
    expect(result).toMatchObject({ text: "Sure, hello, this is history." });
    expect(calls[0]!.system).toContain("по-английски");
    expect(calls[0]!.system).not.toBe(FOREIGN_WORDS_INSTRUCTION_CYRILLIC);
  });

  it("язык в инструкции задаётся настройкой language", async () => {
    const { input, calls } = replyInput("Ja, привет, das ist gut.", { rewrite: () => "Ja, hallo, das ist gut." });
    await foreignWords({ script: "latin", language: "по-немецки" })(input);
    expect(calls[0]!.system).toContain("по-немецки");
  });

  it("чистый английский ответ — модель не зовётся", async () => {
    const { input, calls } = replyInput("Actually, this is important.");
    expect(await foreignWords({ script: "latin" })(input)).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
