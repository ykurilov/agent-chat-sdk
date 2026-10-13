import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { createLongTermMemory } from "@ykurilov/agent-chat-memory";
import { describe, expect, it, vi } from "vitest";
import { readOnlyMemory } from "../../src/read-only-memory";
import { sandboxOwnerOf } from "../../src/sandbox-owner";
import type { ModelStep } from "./support/sandbox-setup";
import { setupSandbox } from "./support/sandbox-setup";

const refusal = { error: { kind: "invalid", message: "в песочнице память только для чтения" } };

/** Песочница с боевой памятью, где у Анны уже есть заметка «Любит чай». */
async function withMemory(steps: ModelStep[] = []) {
  const storage = createInMemoryChatStorage();
  const memory = createLongTermMemory({ storage, optimizer: false });
  const afterAnswer = vi.fn(async () => {});
  const created = await memory.create("anna", { categories: ["О себе"], content: "Любит чай" });
  if (!created.ok) throw new Error("заметка не создана");
  const setup = setupSandbox({ storage, steps, chat: { memory: { ...memory, afterAnswer } } });
  return { setup, memory, afterAnswer, note: created.value };
}

/** Результаты вызовов инструментов хода из журнала. */
async function toolOutputs(setup: ReturnType<typeof setupSandbox>, chatId: string) {
  const entries = (await setup.journal.listForChat(chatId)).filter((entry) => entry.kind === "tool");
  return Promise.all(
    entries.map(async (entry) => {
      const details = await setup.journal.getCall(entry.id);
      return details?.kind === "tool" ? details.output?.content : undefined;
    }),
  );
}

describe("память только на чтение (T038)", () => {
  it("песочный ход видит боевую заметку админа", async () => {
    const { setup } = await withMemory();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    expect(JSON.stringify(setup.model.doStreamCalls[0]!.prompt)).toContain("Любит чай");
  });

  it("search работает и находит боевую заметку", async () => {
    const { setup } = await withMemory([{ toolCall: { id: "s1", name: "manage_memory", input: { action: "search", query: "чай" } } }, { text: "нашёл" }]);
    const chatId = await setup.createChat();
    await setup.send(chatId);
    const [output] = await toolOutputs(setup, chatId);
    expect(JSON.stringify(output)).toContain("Любит чай");
  });

  it("create, update, delete — отказ «только для чтения», боевая память не меняется", async () => {
    const { setup, memory, note } = await withMemory([
      { toolCall: { id: "c1", name: "manage_memory", input: { action: "create", notes: [{ categories: ["О себе"], content: "Любит кофе" }] } } },
      { toolCall: { id: "u1", name: "manage_memory", input: { action: "update", id: "x", version: 1, content: "Не любит чай" } } },
      { toolCall: { id: "d1", name: "manage_memory", input: { action: "delete", id: "x", version: 1 } } },
      { text: "не вышло" },
    ]);
    const chatId = await setup.createChat();
    await setup.send(chatId);
    expect(await toolOutputs(setup, chatId)).toEqual([refusal, refusal, refusal]);
    const { notes } = await memory.list("anna");
    expect(notes.map((item) => [item.id, item.content, item.version])).toEqual([[note.id, "Любит чай", note.version]]);
    expect((await memory.list("sandbox:anna")).notes).toEqual([]);
  });

  it("afterAnswer после песочного ответа не зовётся (а в боевом — зовётся)", async () => {
    const { setup, afterAnswer } = await withMemory();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    await setup.sandbox.flush();
    expect(afterAnswer).not.toHaveBeenCalled();

    const battleChat = ((await (await setup.callBattle("POST", "", { body: {} })).json()) as { id: string }).id;
    await (
      await setup.callBattle("POST", `/${battleChat}/messages`, { body: { message: { id: "b1", role: "user", parts: [{ type: "text", text: "привет" }] } } })
    ).text();
    await setup.battle.handler.flush();
    expect(afterAnswer).toHaveBeenCalled();
  });

  it("инструменты в запросе побайтно как у боевого чата", async () => {
    const { setup } = await withMemory();
    const battleChat = ((await (await setup.callBattle("POST", "", { body: {} })).json()) as { id: string }).id;
    await (
      await setup.callBattle("POST", `/${battleChat}/messages`, { body: { message: { id: "b1", role: "user", parts: [{ type: "text", text: "привет" }] } } })
    ).text();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    const [battleCall, sandboxCall] = setup.model.doStreamCalls;
    expect(JSON.stringify(sandboxCall!.tools)).toBe(JSON.stringify(battleCall!.tools));
    expect(JSON.stringify(sandboxCall!.tools)).toContain("manage_memory");
  });

  it("адреса /memory песочницы → 404, боевые /memory работают", async () => {
    const { setup } = await withMemory();
    for (const [method, path] of [
      ["GET", "/memory"],
      ["DELETE", "/memory"],
      ["POST", "/memory"],
      ["GET", "/memory/merges"],
    ] as const) {
      expect((await setup.call(method, path, { body: method === "POST" ? { categories: ["О себе"], content: "x" } : undefined })).status, `${method} ${path}`).toBe(404);
    }
    expect((await setup.callBattle("GET", "/memory")).status).toBe(200);
  });
});

describe("readOnlyMemory: blocks", () => {
  it("пробрасывает blocks боевой памяти с настоящим владельцем; нет blocks у боевой памяти — нет и у обёртки", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage, optimizer: false });
    await memory.create("anna", { categories: ["О себе"], content: "Любит чай" });
    const wrapped = readOnlyMemory(memory);
    const blocks = await wrapped.blocks!({ userId: sandboxOwnerOf("anna"), chatId: "c1" });
    expect(blocks?.map((block) => block.key)[0]).toBe("memory");
    expect(JSON.stringify(blocks)).toContain("Любит чай");
    const { blocks: _omitted, ...withoutBlocks } = memory;
    expect(readOnlyMemory(withoutBlocks).blocks).toBeUndefined();
  });

  it("в копии чата человека — блоки этого человека", async () => {
    const storage = createInMemoryChatStorage();
    const memory = createLongTermMemory({ storage, optimizer: false });
    await memory.create("boris", { categories: ["О себе"], content: "Живёт в Осло" });
    const wrapped = readOnlyMemory(memory, { toolsModel: (model) => model, personOf: () => "boris" });
    expect(JSON.stringify(await wrapped.blocks!({ userId: sandboxOwnerOf("anna"), chatId: "c1" }))).toContain("Осло");
  });
});
