import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, MemoryNote } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../../src/create-long-term-memory";
import { optimizerRules } from "../../src/optimizer/run-optimization";
import { input, isoAt } from "./support";

// Что видно и что можно вернуть после слияния: список для экрана, отмена, каскадное удаление.

const noRest = { ...optimizerRules(24), minIntervalMs: 0, retryAfterFailureMs: 0 };

/** Три записи; первые две уже слиты в одну (слияние сделало хранилище, как после запуска оптимизатора). */
async function withMerge() {
  const storage = createInMemoryChatStorage();
  const memory = createLongTermMemory({ storage });
  const [first, second, third] = await storage.insertMemoryNotes!("anna", [
    input("Пишет код на TypeScript каждый день", ["О себе", "Работа"]),
    input("Пишет код на TypeScript в компании Acme", ["О себе", "Работа"]),
    input("Любит зелёный чай"),
  ]);
  const merge = (minutes: number, originals: MemoryNote[], content: string) => mergeNow(storage, minutes, originals, content);
  const run = await merge(0, [first!, second!], "Пишет код на TypeScript каждый день в компании Acme");
  const resultId = run.groups[0]!.resultId;
  return { storage, memory, first: first!, second: second!, third: third!, run, resultId, merge };
}

async function mergeNow(storage: ChatStorage, minutes: number, originals: MemoryNote[], content: string) {
  const claimed = await storage.claimMemoryOptimizationRun!("anna", noRest, isoAt(minutes));
  const applied = await storage.applyMemoryMerge!("anna", {
    runId: claimed!.id,
    finishedAt: isoAt(minutes + 1),
    merges: [{ result: { categories: originals[0]!.categories, content }, originals: originals.map(({ id, version }) => ({ id, version })) }],
  });
  if (typeof applied === "string") throw new Error(`слияние не применилось: ${applied}`);
  return applied;
}

describe("слияния для экрана: список", () => {
  it("слитый запуск: результат («стало») и оригиналы («было») в порядке склейки", async () => {
    const { memory, first, second, run, resultId } = await withMerge();
    const merges = await memory.listMerges("anna");
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({ runId: run.id, finishedAt: isoAt(1), revertible: true });
    const [group] = merges[0]!.groups;
    expect(group!.result).toMatchObject({ id: resultId, content: "Пишет код на TypeScript каждый день в компании Acme", version: 1 });
    expect(group!.originals.map((note) => note.id)).toEqual([first.id, second.id]);
    expect(group!.originals.map((note) => note.content)).toEqual([first.content, second.content]);
  });

  it("без слияний — пусто; чужие слияния не видны", async () => {
    const { memory } = await withMerge();
    expect(await memory.listMerges("boris")).toEqual([]);
    expect(await createLongTermMemory({ storage: createInMemoryChatStorage() }).listMerges("anna")).toEqual([]);
  });

  it("новейшие первыми; limit ограничивает число запусков", async () => {
    const { memory, storage, merge } = await withMerge();
    const other = (await storage.insertMemoryNotes!("anna", [input("Любит чай, зелёный без сахара"), input("Чай зелёный любит без сахара")])) as MemoryNote[];
    const later = await merge(60, other, "Любит зелёный чай без сахара");
    const merges = await memory.listMerges("anna");
    expect(merges.map((entry) => entry.runId)).toEqual([later.id, merges[1]!.runId]);
    expect(await memory.listMerges("anna", 1)).toHaveLength(1);
    expect((await memory.listMerges("anna", 1))[0]!.runId).toBe(later.id);
  });

  it("скрытые оригиналы не видны ни в списке записей, ни в блоке для агента, ни в поиске", async () => {
    const { memory, first, second } = await withMerge();
    const { notes, counts } = await memory.list("anna");
    expect(notes.map((note) => note.id)).not.toContain(first.id);
    expect(notes.map((note) => note.id)).not.toContain(second.id);
    expect(counts.total).toBe(2);
    const block = (await memory.snapshot({ userId: "anna", chatId: "c" }))!;
    expect(block).not.toContain(first.id);
    expect(block).not.toContain("каждый день\"");
    const found = await memory.search("anna", "TypeScript");
    expect(found.ok && found.value.notes.map((note) => note.id)).not.toContain(first.id);
    expect(found.ok && found.value.total).toBe(1);
  });

  it("результат позже склеили с другой записью — старое слияние из списка уходит (его результат скрыт)", async () => {
    const { memory, storage, resultId, third, merge } = await withMerge();
    const result = (await storage.listMemoryNotes!("anna")).find((note) => note.id === resultId)!;
    const later = await merge(60, [result, third], "Пишет код на TypeScript, любит чай");
    expect((await memory.listMerges("anna")).map((entry) => entry.runId)).toEqual([later.id]);
  });
});

describe("слияния: вернуть как было", () => {
  it("результат не менялся — оригиналы возвращены, результат удалён, слияние из списка ушло", async () => {
    const { memory, first, second, third, run, resultId } = await withMerge();
    expect(await memory.revertMerge("anna", run.id)).toBe("ok");
    const { notes } = await memory.list("anna");
    expect(notes.map((note) => note.id).sort()).toEqual([first.id, second.id, third.id].sort());
    expect(notes.map((note) => note.id)).not.toContain(resultId);
    expect(notes.find((note) => note.id === first.id)).toEqual(first);
    expect(await memory.listMerges("anna")).toEqual([]);
  });

  it("повторная отмена — not_found", async () => {
    const { memory, run } = await withMerge();
    await memory.revertMerge("anna", run.id);
    expect(await memory.revertMerge("anna", run.id)).toBe("not_found");
  });

  it("результат правили — в списке без права вернуть, отмена даёт conflict и ничего не меняет", async () => {
    const { memory, storage, run, resultId } = await withMerge();
    const edited = await memory.update("anna", resultId, 1, { categories: ["О себе"], content: "Пишет код на Rust" });
    expect(edited.ok).toBe(true);
    const [entry] = await memory.listMerges("anna");
    expect(entry).toMatchObject({ runId: run.id, revertible: false });
    expect(entry!.groups[0]!.result).toMatchObject({ content: "Пишет код на Rust", version: 2 });
    expect(await memory.revertMerge("anna", run.id)).toBe("conflict");
    expect((await memory.list("anna")).notes.map((note) => note.content).sort()).toEqual(["Любит зелёный чай", "Пишет код на Rust"]);
    expect(await storage.listMergedMemoryNotes!("anna")).toHaveLength(2);
  });

  it("чужой запуск и несуществующий — not_found; чужие записи не тронуты", async () => {
    const { memory, run } = await withMerge();
    expect(await memory.revertMerge("boris", run.id)).toBe("not_found");
    expect(await memory.revertMerge("anna", "нет-такого")).toBe("not_found");
    expect(await memory.listMerges("anna")).toHaveLength(1);
  });

  it("хранилище без методов оптимизации: список пуст, отмена — not_found", async () => {
    const storage: ChatStorage = { ...createInMemoryChatStorage() };
    for (const method of ["claimMemoryOptimizationRun", "finishMemoryOptimizationRun", "applyMemoryMerge", "revertMemoryMerge", "listMemoryOptimizationRuns", "listMergedMemoryNotes"] as const) delete storage[method];
    const memory = createLongTermMemory({ storage });
    expect(await memory.listMerges("anna")).toEqual([]);
    expect(await memory.revertMerge("anna", "x")).toBe("not_found");
  });
});

describe("слияния: скрытое удаляется вместе с результатом", () => {
  it("человек удалил результат — скрытые оригиналы удалены, в списке слияний пусто, вернуть нельзя", async () => {
    const { memory, storage, run, resultId } = await withMerge();
    expect((await memory.remove("anna", resultId, 1)).ok).toBe(true);
    expect(await storage.listMergedMemoryNotes!("anna")).toEqual([]);
    expect(await memory.listMerges("anna")).toEqual([]);
    expect(await memory.revertMerge("anna", run.id)).not.toBe("ok");
    expect((await memory.list("anna")).notes.map((note) => note.content)).toEqual(["Любит зелёный чай"]);
  });

  it("«стереть всю память» удаляет и скрытые оригиналы, и историю запусков; число — только видимых", async () => {
    const { memory, storage } = await withMerge();
    expect(await memory.clear("anna")).toBe(2);
    expect(await storage.listMergedMemoryNotes!("anna")).toEqual([]);
    expect(await storage.listMemoryOptimizationRuns!("anna")).toEqual([]);
    expect(await memory.listMerges("anna")).toEqual([]);
  });

  it("стирание памяти одного человека не трогает слияния другого", async () => {
    const { memory, storage } = await withMerge();
    const [one, two] = await storage.insertMemoryNotes!("boris", [input("Любит горные лыжи каждую зиму"), input("Каждую зиму катается на горных лыжах")]);
    await mergeAs(storage, "boris", [one!, two!]);
    await memory.clear("anna");
    expect(await memory.listMerges("boris")).toHaveLength(1);
  });
});

async function mergeAs(storage: ChatStorage, ownerId: string, originals: MemoryNote[]) {
  const run = await storage.claimMemoryOptimizationRun!(ownerId, noRest, isoAt(0));
  await storage.applyMemoryMerge!(ownerId, {
    runId: run!.id,
    finishedAt: isoAt(1),
    merges: [{ result: { categories: ["О себе"], content: "Любит горные лыжи зимой" }, originals: originals.map(({ id, version }) => ({ id, version })) }],
  });
}
