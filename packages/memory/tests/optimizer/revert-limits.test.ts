import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { MemoryNote } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../../src/create-long-term-memory";
import type { LongTermMemoryOptions } from "../../src/create-long-term-memory";
import { optimizerRules } from "../../src/optimizer/run-optimization";
import { input, isoAt } from "./support";

// «Вернуть как было» не должно обходить пределы и дубли: за время, пока оригиналы были скрыты, память могла заполниться.

const noRest = { ...optimizerRules(24), minIntervalMs: 0, retryAfterFailureMs: 0 };
const work = ["О себе", "Работа"];

/** Три записи; первые две слиты в одну. Видно две: результат и «Любит зелёный чай». */
async function withMerge(options: Partial<LongTermMemoryOptions> = {}) {
  const storage = createInMemoryChatStorage();
  const memory = createLongTermMemory({ storage, optimizer: false, ...options });
  const [first, second, third] = (await storage.insertMemoryNotes!("anna", [
    input("Пишет код на TypeScript каждый день", work),
    input("Пишет код на TypeScript в компании Acme", work),
    input("Любит зелёный чай"),
  ])) as MemoryNote[];
  const claimed = await storage.claimMemoryOptimizationRun!("anna", noRest, isoAt(0));
  const applied = await storage.applyMemoryMerge!("anna", {
    runId: claimed!.id,
    finishedAt: isoAt(1),
    merges: [{ result: input("Пишет код на TypeScript каждый день в компании Acme", work), originals: [first!, second!].map(({ id, version }) => ({ id, version })) }],
  });
  if (typeof applied === "string") throw new Error(`слияние не применилось: ${applied}`);
  return { storage, memory, first: first!, second: second!, third: third!, run: applied };
}

const contents = async (memory: Awaited<ReturnType<typeof withMerge>>["memory"]) => (await memory.list("anna")).notes.map((note) => note.content).sort();

describe("возврат слияния и пределы памяти", () => {
  it("число записей: возврат вышел бы за предел — limit_reached, всё осталось как было", async () => {
    const { memory, run } = await withMerge({ maxNotes: 5 });
    for (const text of ["Один", "Два", "Три"]) await memory.create("anna", input(text));
    const before = await contents(memory);
    expect(before).toHaveLength(5);
    expect(await memory.revertMerge("anna", run.id)).toBe("limit_reached");
    expect(await contents(memory)).toEqual(before);
    // Слияние по-прежнему можно вернуть, когда место появится.
    expect((await memory.listMerges("anna"))[0]).toMatchObject({ runId: run.id, revertible: true });
  });

  it("место освободили — тот же возврат проходит", async () => {
    const { memory, run } = await withMerge({ maxNotes: 5 });
    const added = [];
    for (const text of ["Один", "Два", "Три"]) added.push(await memory.create("anna", input(text)));
    expect(await memory.revertMerge("anna", run.id)).toBe("limit_reached");
    // Освобождаем место своей записью: у записей одной миллисекунды порядок в списке случайный.
    const freed = added[0]!;
    if (!freed.ok) throw new Error("запись не создалась");
    await memory.remove("anna", freed.value.id, freed.value.version);
    expect(await memory.revertMerge("anna", run.id)).toBe("ok");
    expect((await memory.list("anna")).notes).toHaveLength(5);
  });

  it("возврат ровно до предела — проходит", async () => {
    const { memory, run } = await withMerge({ maxNotes: 5 });
    for (const text of ["Один", "Два"]) await memory.create("anna", input(text));
    expect(await memory.revertMerge("anna", run.id)).toBe("ok");
    expect((await memory.list("anna")).notes).toHaveLength(5);
  });

  it("объём: возврат вышел бы за предел знаков — limit_reached", async () => {
    // Результат слияния короче двух оригиналов вместе; лишний объём набегает при возврате.
    const { memory, run } = await withMerge({ maxTotalChars: 150 });
    const before = await contents(memory);
    await memory.create("anna", input("Держит на столе три горшка с базиликом и мятой"));
    const withNew = await contents(memory);
    expect(withNew.length).toBe(before.length + 1);
    expect(await memory.revertMerge("anna", run.id)).toBe("limit_reached");
    expect(await contents(memory)).toEqual(withNew);
  });

  it("повтор: такой же факт записали заново, пока оригинал был скрыт, — duplicate, ничего не меняется", async () => {
    const { memory, run } = await withMerge();
    const again = await memory.create("anna", input("Пишет код на TypeScript каждый день", work));
    expect(again.ok).toBe(true);
    const before = await contents(memory);
    expect(await memory.revertMerge("anna", run.id)).toBe("duplicate");
    expect(await contents(memory)).toEqual(before);
    expect((await memory.listMerges("anna"))[0]).toMatchObject({ revertible: true });
  });

  it("повтор оригинала, записанный с другим регистром и пробелами, тоже замечается", async () => {
    const { memory, run } = await withMerge();
    await memory.create("anna", input("пишет  код на TYPESCRIPT каждый день", work));
    expect(await memory.revertMerge("anna", run.id)).toBe("duplicate");
  });

  it("одновременно возврат и новая запись: предел цел, проходит одно из двух", async () => {
    const { memory, run } = await withMerge({ maxNotes: 5 });
    for (const text of ["Один", "Два"]) await memory.create("anna", input(text));
    const [reverted, created] = await Promise.all([memory.revertMerge("anna", run.id), memory.create("anna", input("Новая"))]);
    expect([reverted === "ok", created.ok].filter(Boolean)).toHaveLength(1);
    expect(reverted === "ok" || reverted === "limit_reached").toBe(true);
    expect((await memory.list("anna")).notes.length).toBeLessThanOrEqual(5);
  });

  it("чужая память пределов этого человека не занимает", async () => {
    const { memory, run } = await withMerge({ maxNotes: 5 });
    for (const text of ["Один", "Два", "Три"]) await memory.create("boris", input(text));
    expect(await memory.revertMerge("anna", run.id)).toBe("ok");
  });
});
