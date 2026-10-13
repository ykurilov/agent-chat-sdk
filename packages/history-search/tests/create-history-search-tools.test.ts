import { describe, expect, it } from "vitest";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { createHistorySearchTools, historySearchInstructions } from "../src";
import { compactionThrough, chatId, executeOptions, seedChat } from "./support";

const model = { profile: { id: "m" }, providerId: "p", chatId } as never;

async function runSearch(storage: ReturnType<typeof createInMemoryChatStorage>, query: string, options = {}): Promise<string> {
  const tools = createHistorySearchTools({ storage, ...options })(model);
  const tool = tools.search_earlier_conversation!;
  return (await tool.execute!({ query }, executeOptions())) as string;
}

async function compacted() {
  const storage = createInMemoryChatStorage();
  await seedChat(storage, [
    ["Запомни: код от сейфа 4471", "Запомнил код."],
    ["Что нового?", "Ничего."],
    ["Как дела?", "Хорошо."],
  ]);
  await storage.insertCompaction(compactionThrough("a2"));
  return storage;
}

describe("инструмент «поиск по старой переписке»", () => {
  it("даёт один инструмент с постоянным описанием", () => {
    const first = createHistorySearchTools({ storage: createInMemoryChatStorage() })(model);
    const second = createHistorySearchTools({ storage: createInMemoryChatStorage() })(model);
    expect(Object.keys(first)).toEqual(["search_earlier_conversation"]);
    expect(first.search_earlier_conversation!.description).toBe(second.search_earlier_conversation!.description);
    expect(historySearchInstructions).toContain("search_earlier_conversation");
  });

  it("находку отдаёт нумерованным списком: кто, когда, фрагмент", async () => {
    const text = await runSearch(await compacted(), "код сейфа");
    expect(text).toMatch(/^1\. /m);
    expect(text).toContain("4471");
    expect(text).toContain("2026-03-01 10:00");
    expect(text).toMatch(/человек/i);
  });

  it("ничего не нашлось — говорит об этом и подсказывает, что попробовать", async () => {
    const text = await runSearch(await compacted(), "самолёт");
    expect(text).toContain("ничего не нашлось");
  });

  it("история не сжималась — говорит, что искать негде", async () => {
    const storage = createInMemoryChatStorage();
    await seedChat(storage, [["привет", "привет"]]);
    expect(await runSearch(storage, "привет")).toContain("не сжималась");
  });

  it("пустой запрос — просит назвать слова", async () => {
    expect(await runSearch(await compacted(), " ; ")).toContain("Запрос пустой");
  });

  it("если находок больше, чем показано, говорит сколько всего", async () => {
    const storage = createInMemoryChatStorage();
    await seedChat(storage, [
      ["слон первый", "слон"], ["слон второй", "слон"], ["слон третий", "слон"], ["конец", "конец"], ["ещё", "ещё"],
    ]);
    await storage.insertCompaction(compactionThrough("a4"));
    const text = await runSearch(storage, "слон", { maxResults: 3 });
    expect(text).toContain("показано 3 из 6");
  });
});
