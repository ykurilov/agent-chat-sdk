import { CORE_SERVICE_BLOCKS, createInMemoryChatStorage, cutForgedBlocks } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../src/create-long-term-memory";
import { buildMemoryBlocks } from "../src/memory-block";

const ANSWER = "Дима, почти всё разъехалось. Почему ты решил, что друга лучше поставить спиной к окну?";
const note = { id: "aa838bf2", categories: ["Имя"], content: "Ученика зовут Дима.", version: 1, createdAt: "2026-10-11T10:00:00.000Z", updatedAt: "2026-10-11T10:00:00.000Z" };

describe("служебный формат памяти", () => {
  const memory = createLongTermMemory({ storage: createInMemoryChatStorage() });
  const formats = [...CORE_SERVICE_BLOCKS, ...(memory.serviceBlocks ?? [])];

  it("память регистрирует тег <agent_memory>", () => {
    expect(memory.serviceBlocks).toEqual([{ tag: "agent_memory" }]);
  });

  it("настоящие блоки памяти из вопроса хода, подделанные в ответе, вырезаются все", () => {
    const blocks = buildMemoryBlocks([note], 10_000)!.map((block) => ("text" in block ? block.text : "")).join("\n");
    expect(cutForgedBlocks(`${ANSWER}\n\n${blocks}`, formats).text.trim()).toBe(ANSWER);
  });

  it("слово «agent_memory» в объяснении и тег в коде — не трогаются", () => {
    const text = "Память лежит в блоке `<agent_memory>`, например:\n\n```\n<agent_memory>\n[]\n</agent_memory>\n```";
    expect(cutForgedBlocks(text, formats)).toEqual({ text, blocks: [] });
  });
});
