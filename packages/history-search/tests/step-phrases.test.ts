import { describe, expect, it } from "vitest";
import { englishHistorySearchStepPhrases, historySearchStepPhrases } from "../src/labels";

describe("фразы поиска по старой переписке для простого вида", () => {
  it("«идёт» и «готово» по-русски и по-английски", () => {
    expect(historySearchStepPhrases).toEqual({ search_earlier_conversation: { running: "Вспоминаю старую переписку", done: "Заглянул в старую переписку" } });
    expect(Object.keys(englishHistorySearchStepPhrases)).toEqual(["search_earlier_conversation"]);
    expect(JSON.stringify(englishHistorySearchStepPhrases)).not.toMatch(/[А-Яа-яЁё]/);
  });
});
