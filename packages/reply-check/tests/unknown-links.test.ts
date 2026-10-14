import { describe, expect, it } from "vitest";
import { russianReplyCheckLabels, unknownLinks } from "../src";
import { LINK_REWRITE_INSTRUCTION, UNKNOWN_LINKS_NOTE } from "../src/unknown-links";
import { replyInput } from "./support/reply-input";

describe("проверка «выдуманные ссылки»", () => {
  it("ссылки из seenTexts — законные: модель не зовётся, ответ не меняется", async () => {
    const { input, calls } = replyInput("Запись: https://a.ru/z", { seenTexts: ["Ссылка: https://a.ru/z"] });
    expect(await unknownLinks()(input)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("ответ без ссылок чист", async () => {
    const { input, calls } = replyInput("Понимаю вас.");
    expect(await unknownLinks()(input)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("чужая ссылка — одна переписка; модель убрала — уходит переписанный, заметка в журнал", async () => {
    const { input, calls } = replyInput("Запишитесь: https://fake.ru/zapis", { rewrite: () => "Ссылку на запись пришлёт эксперт." });
    const result = await unknownLinks()(input);
    expect(result).toMatchObject({ text: "Ссылку на запись пришлёт эксперт." });
    expect(result?.note).toContain("ссылки не из инструкции");
    expect(result?.note).toContain("https://fake.ru/zapis");
    expect(calls).toEqual([{ system: LINK_REWRITE_INSTRUCTION, prompt: `Запишитесь: https://fake.ru/zapis\n\n${UNKNOWN_LINKS_NOTE} https://fake.ru/zapis` }]);
  });

  it("после переписки ссылка осталась — вырезается кодом, второй переписки нет", async () => {
    const { input, calls } = replyInput("Вот: https://fake.ru/a. Жду!", { rewrite: () => "Вот: https://fake.ru/a. Жду!" });
    const result = await unknownLinks()(input);
    expect(result?.text).toBe("Вот. Жду!");
    expect(result?.note).toContain("вырезаны");
    expect(calls).toHaveLength(1);
  });

  it("модель не ответила — ссылка вырезается кодом", async () => {
    const { input } = replyInput("Запись тут: www.fake.ru, жду", {
      rewrite: () => {
        throw new Error("503");
      },
    });
    expect((await unknownLinks()(input))?.text).toBe("Запись тут, жду");
  });

  it("модель вернула текст со служебной строкой запроса — он отбрасывается, ссылка вырезается кодом", async () => {
    const { input } = replyInput("Запись тут: www.fake.ru, жду", { rewrite: () => `Запись тут, жду\n\n${UNKNOWN_LINKS_NOTE} www.fake.ru` });
    expect((await unknownLinks()(input))?.text).toBe("Запись тут, жду");
  });

  it("переписанный текст оставил законную ссылку и одну чужую — чужая вырезается из него", async () => {
    const { input } = replyInput("Вот https://a.ru/z и https://fake.ru/q", {
      seenTexts: ["https://a.ru/z"],
      rewrite: () => "Вот https://a.ru/z и https://fake.ru/q тоже",
    });
    expect((await unknownLinks()(input))?.text).toBe("Вот https://a.ru/z и тоже");
  });

  it("appDomains: короткое имя на домене приложений, названное человеком, законно", async () => {
    const seen = ["Опубликовала, адрес sveta-nails"];
    const legal = replyInput("Ваша ссылка: https://sveta-nails.apps.example.com/", { seenTexts: seen });
    expect(await unknownLinks({ appDomains: ["apps.example.com"] })(legal.input)).toBeUndefined();
    const invented = replyInput("Ваша ссылка: https://sveta.apps.example.com/", { seenTexts: seen });
    expect((await unknownLinks({ appDomains: ["apps.example.com"] })(invented.input))?.text).toBe("Ваша ссылка");
  });

  it("ответ целиком из выдуманной ссылки — после вырезания пусто: уходит запасная фраза, а не ссылка", async () => {
    for (const answer of ["https://fake.ru/a", "https://fake.ru/a.", "www.fake.ru!"]) {
      const { input } = replyInput(answer, { rewrite: () => answer });
      const result = await unknownLinks()(input);
      expect(result?.text).toBe(russianReplyCheckLabels.linkOnlyReply);
      expect(result?.note).toContain("запасная фраза");
    }
  });

  it("запасная фраза — из словаря приложения", async () => {
    const { input } = replyInput("https://fake.ru/a", { rewrite: () => "" });
    expect((await unknownLinks({ labels: { linkOnlyReply: "Ссылку пришлёт куратор." } })(input))?.text).toBe("Ссылку пришлёт куратор.");
  });
});
