import type { MemoryMergeRevertResult, MemoryNote } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { fakeMemory } from "./support/fake-memory";
import { createTestChat } from "./support/test-chat";

// Адреса склейки повторов: список «Объединено» и «Вернуть как было». Память — заглушка с методами, как у пакета memory.

const stamp = "2026-09-30T10:00:00.000Z";
const note = (id: string, content: string, extra: object = {}): MemoryNote => ({ id, categories: ["О себе"], content, version: 1, createdAt: stamp, updatedAt: stamp, ...extra });

/** Запись слияния, как её отдаёт пакет памяти: с лишними служебными полями, которых на экран выдавать нельзя. */
const stored = () => ({
  runId: "run-1",
  finishedAt: "2026-09-30T12:00:00.000Z",
  revertible: true,
  ownerId: "anna",
  internalKey: "секрет-хранилища",
  groups: [
    {
      result: note("r1", "Пишет код на TypeScript каждый день в компании Acme", { ownerId: "anna", internalKey: "секрет" }),
      originals: [
        note("o1", "Пишет код на TypeScript каждый день", { mergedInto: "r1", ownerId: "anna" }),
        note("o2", "Пишет код на TypeScript в компании Acme", { mergedInto: "r1", ownerId: "anna" }),
      ],
    },
  ],
});

function mergeChat(revert: MemoryMergeRevertResult = "ok") {
  const { memory } = fakeMemory();
  const listMerges = vi.fn(async (ownerId: string, _limit?: number) => (ownerId === "anna" ? [stored()] : []));
  const revertMerge = vi.fn(async (_ownerId: string, _runId: string) => revert);
  return { ...createTestChat({ memory: Object.assign(memory, { listMerges, revertMerge }) }), listMerges, revertMerge };
}

describe("адреса /memory/merges: список", () => {
  it("GET /memory/merges — склейки человека: было и стало, без служебных полей", async () => {
    const { call, listMerges } = mergeChat();
    const response = await call("GET", "/memory/merges");
    expect(response.status).toBe(200);
    expect(listMerges).toHaveBeenCalledWith("anna");
    const body = await response.json();
    expect(body).toEqual({
      merges: [
        {
          runId: "run-1",
          finishedAt: "2026-09-30T12:00:00.000Z",
          revertible: true,
          groups: [
            {
              result: { id: "r1", categories: ["О себе"], content: "Пишет код на TypeScript каждый день в компании Acme", version: 1, createdAt: stamp, updatedAt: stamp },
              originals: [
                { id: "o1", categories: ["О себе"], content: "Пишет код на TypeScript каждый день", version: 1, createdAt: stamp, updatedAt: stamp },
                { id: "o2", categories: ["О себе"], content: "Пишет код на TypeScript в компании Acme", version: 1, createdAt: stamp, updatedAt: stamp },
              ],
            },
          ],
        },
      ],
    });
    const text = JSON.stringify(body);
    for (const secret of ["ownerId", "internalKey", "секрет", "mergedInto"]) expect(text).not.toContain(secret);
  });

  it("у человека нет склеек — пустой список; чужие склейки не видны", async () => {
    const { call } = mergeChat();
    const response = await call("GET", "/memory/merges", { user: "boris" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ merges: [] });
  });

  it("без входа — 401, в память не ходили", async () => {
    const { call, listMerges } = mergeChat();
    expect((await call("GET", "/memory/merges", { user: null })).status).toBe(401);
    expect(listMerges).not.toHaveBeenCalled();
  });

  it("память без склеек (нет методов) — 404, как без памяти", async () => {
    const chat = createTestChat({ memory: fakeMemory().memory });
    const response = await chat.call("GET", "/memory/merges");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { kind: "not_found" } });
    expect((await chat.call("POST", "/memory/merges/run-1/revert")).status).toBe(404);
  });

  it("без memory адресов нет — 404", async () => {
    const chat = createTestChat();
    expect((await chat.call("GET", "/memory/merges")).status).toBe(404);
  });

  it("другие методы и лишние сегменты — 404", async () => {
    const { call } = mergeChat();
    expect((await call("POST", "/memory/merges")).status).toBe(404);
    expect((await call("DELETE", "/memory/merges")).status).toBe(404);
    expect((await call("GET", "/memory/merges/run-1")).status).toBe(404);
    expect((await call("GET", "/memory/merges/run-1/revert")).status).toBe(404);
    expect((await call("POST", "/memory/merges/run-1/revert/more")).status).toBe(404);
  });
});

describe("адреса /memory/merges/:runId/revert: «Вернуть как было»", () => {
  it("ok — 200, память просят вернуть слияние этого человека", async () => {
    const { call, revertMerge } = mergeChat("ok");
    const response = await call("POST", "/memory/merges/run-1/revert");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reverted: "run-1" });
    expect(revertMerge).toHaveBeenCalledWith("anna", "run-1");
  });

  it("conflict — 409: результат с тех пор менялся", async () => {
    const { call } = mergeChat("conflict");
    const response = await call("POST", "/memory/merges/run-1/revert");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "conflict" } });
  });

  it.each(["limit_reached", "duplicate"] as const)("%s — 409: возврат вышел бы за пределы памяти или вернул бы повтор", async (kind) => {
    const { call } = mergeChat(kind);
    const response = await call("POST", "/memory/merges/run-1/revert");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind } });
  });

  it("not_found — 404: запуска нет или он не слит", async () => {
    const { call } = mergeChat("not_found");
    const response = await call("POST", "/memory/merges/run-1/revert");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { kind: "not_found" } });
  });

  it("без входа — 401, в память не ходили", async () => {
    const { call, revertMerge } = mergeChat();
    expect((await call("POST", "/memory/merges/run-1/revert", { user: null })).status).toBe(401);
    expect(revertMerge).not.toHaveBeenCalled();
  });
});
