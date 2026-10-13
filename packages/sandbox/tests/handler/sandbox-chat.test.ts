import { jsonSchema, tool } from "ai";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemorySandboxJournal, isSandboxOwner } from "../../src/index";
import type { JournalListResponse, SandboxSettingsResponse } from "../../src/index";
import { appInstructions, setupSandbox } from "./support/sandbox-setup";

afterEach(() => {
  vi.useRealTimers();
});

describe("песочный владелец (T032)", () => {
  it("isSandboxOwner отличает песочного владельца от обычного", () => {
    expect(isSandboxOwner("sandbox:anna")).toBe(true);
    expect(isSandboxOwner("anna")).toBe(false);
    expect(isSandboxOwner("sandboxanna")).toBe(false);
  });

  it("песочный чат записан на sandbox:<id админа>; боевой sumUsage админа его ходов не видит", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    expect((await setup.storage.getChat(chatId))?.ownerId).toBe("sandbox:anna");
    expect(await setup.storage.sumUsage({ ownerId: "anna" })).toEqual([]);
    expect((await setup.storage.sumUsage({ ownerId: "sandbox:anna" })).length).toBeGreaterThan(0);
  });

  it("лимиты чата приложения в песочницу не переходят: по умолчанию без лимита", async () => {
    const refusing = {
      assertWithinLimit: async () => {
        throw new Error("лимит приложения не должен звучать в песочнице");
      },
      status: async () => ({ user: [], chat: [] }),
    };
    const setup = setupSandbox({ chat: { limits: refusing as never } });
    const chatId = await setup.createChat();
    await setup.send(chatId);
    expect((await setup.call("GET", `/${chatId}/spending`)).status).toBe(404);
  });

  it("лимит сообщений приложения в песочнице не считает сообщения", async () => {
    const takeMessage = vi.fn(async () => {
      throw new Error("счёт сообщений приложения не должен звучать в песочнице");
    });
    const setup = setupSandbox({ chat: { limits: { assertWithinLimit: async () => {}, status: async () => ({ state: "ok" as const }), takeMessage } } });
    const chatId = await setup.createChat();
    await setup.send(chatId);
    expect(takeMessage).not.toHaveBeenCalled();
  });

  it("ход пишет журнал: обращение к модели с id песочного чата", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    const response = await setup.call("GET", `/chats/${chatId}/journal`);
    expect(response.status).toBe(200);
    const { entries } = (await response.json()) as JournalListResponse;
    expect(entries).toEqual([expect.objectContaining({ kind: "model", chatId, ownerId: "sandbox:anna", purpose: "answer", status: "complete" })]);
  });
});

describe("инструменты приложения получают настоящий ownerId (T034)", () => {
  it("инструмент видит id админа и id песочного чата", async () => {
    const seen: Array<{ ownerId: string; chatId: string }> = [];
    const setup = setupSandbox({
      steps: [{ toolCall: { id: "call-1", name: "record_owner", input: {} } }, { text: "записал" }],
      chat: {
        agent: {
          instructions: appInstructions,
          tools: (model) => ({
            record_owner: tool({
              description: "Запомнить владельца.",
              inputSchema: jsonSchema({ type: "object", properties: {} }),
              execute: async () => {
                seen.push({ ownerId: model.ownerId, chatId: model.chatId });
                return { ok: true };
              },
            }),
          }),
        },
      },
    });
    const chatId = await setup.createChat();
    await setup.send(chatId);
    expect(seen).toEqual([{ ownerId: "anna", chatId }]);
    const { entries } = (await (await setup.call("GET", `/chats/${chatId}/journal`)).json()) as JournalListResponse;
    expect(entries.filter((entry) => entry.kind === "tool")).toEqual([expect.objectContaining({ toolName: "record_owner", toolCallId: "call-1" })]);
  });
});

describe("адреса журнала (T035)", () => {
  it("запись и кусок своего чата отдаются; чужой callId, hash и chatId → 404", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    const [entry] = await setup.journal.listForChat(chatId);
    const call = await setup.call("GET", `/journal/calls/${entry!.id}`);
    expect(call.status).toBe(200);
    const details = (await call.json()) as { kind: string; instructions: { hash: string; content: unknown } };
    expect(details.kind).toBe("model");
    const blob = await setup.call("GET", `/journal/blobs/${details.instructions.hash}`);
    expect(blob.status).toBe(200);
    expect(((await blob.json()) as { content: unknown }).content).toEqual(details.instructions.content);

    expect((await setup.call("GET", "/journal/calls/no-such-call")).status).toBe(404);
    expect((await setup.call("GET", `/journal/blobs/${"0".repeat(64)}`)).status).toBe(404);
    expect((await setup.call("GET", `/chats/${crypto.randomUUID()}/journal`)).status).toBe(404);
  });

  it("журнал одного хода — по messageId", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    await setup.send(chatId, "первый");
    await setup.send(chatId, "второй");
    const all = await setup.journal.listForChat(chatId);
    const messageId = all[1]!.messageId!;
    const { entries } = (await (await setup.call("GET", `/chats/${chatId}/journal?messageId=${messageId}`)).json()) as JournalListResponse;
    expect(entries.map((entry) => entry.id)).toEqual([all[1]!.id]);
  });
});

describe("адреса настроек (T036)", () => {
  it("без правки: instructions null, боевая инструкция для сравнения", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    const response = await setup.call("GET", `/chats/${chatId}/settings`);
    expect(response.status).toBe(200);
    expect((await response.json()) as SandboxSettingsResponse).toEqual({ instructions: null, appInstructions, updatedAt: null });
  });

  it("правка видна в следующем обращении к модели; соседний чат — с прежней; null возвращает боевую", async () => {
    const setup = setupSandbox();
    const edited = await setup.createChat();
    const neighbour = await setup.createChat();
    const put = await setup.call("PUT", `/chats/${edited}/settings`, { body: { instructions: "Отвечай стихами." } });
    expect(put.status).toBe(200);
    const saved = (await put.json()) as SandboxSettingsResponse;
    expect(saved).toEqual({ instructions: "Отвечай стихами.", appInstructions, updatedAt: expect.any(String) });
    expect((await setup.journal.getSettings(edited))?.updatedBy).toBe("anna");

    await setup.send(edited);
    await setup.send(neighbour);
    const systemOf = (index: number) => setup.model.doStreamCalls[index]!.prompt[0] as { role: string; content: string };
    expect(systemOf(0).content).toContain("Отвечай стихами.");
    expect(systemOf(0).content).not.toContain(appInstructions);
    expect(systemOf(1).content).toContain(appInstructions);
    const [entry] = await setup.journal.listForChat(edited);
    const details = await setup.journal.getCall(entry!.id);
    expect(JSON.stringify(details!.kind === "model" && details!.instructions.content)).toContain("Отвечай стихами.");

    await setup.call("PUT", `/chats/${edited}/settings`, { body: { instructions: null } });
    await setup.send(edited);
    expect(systemOf(2).content).toContain(appInstructions);
  });

  it("неверное тело или инструкция длиннее 100 000 знаков → 400", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    for (const body of [{ instructions: 5 }, {}, { instructions: "я".repeat(100_001) }]) {
      const response = await setup.call("PUT", `/chats/${chatId}/settings`, { body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    }
    expect((await setup.call("PUT", `/chats/${chatId}/settings`, { body: { instructions: "я".repeat(100_000) } })).status).toBe(200);
  });
});

describe("удаление песочного чата (T039)", () => {
  it("чистит журнал, настройки и правки", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    await setup.send(chatId);
    await setup.call("PUT", `/chats/${chatId}/settings`, { body: { instructions: "своя" } });
    expect((await setup.journal.listForChat(chatId)).length).toBeGreaterThan(0);
    expect((await setup.call("DELETE", `/${chatId}`)).status).toBe(204);
    expect(await setup.journal.listForChat(chatId)).toEqual([]);
    expect(await setup.journal.getSettings(chatId)).toBeNull();
  });
});

describe("срок жизни журнала (T040)", () => {
  it("чистка при создании и раз в сутки; по умолчанию 30 дней", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const journal = createMemorySandboxJournal({ env: {} });
    const deleted: Date[] = [];
    const spy = vi.spyOn(journal, "deleteOlderThan").mockImplementation(async (before) => {
      deleted.push(before);
      return 0;
    });
    setupSandbox({ sandbox: { journal } });
    expect(deleted).toEqual([new Date("2026-09-01T00:00:00Z")]);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(deleted).toEqual([new Date("2026-09-01T00:00:00Z"), new Date("2026-09-02T00:00:00Z")]);
    spy.mockRestore();
  });

  it("свой retentionDays", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const journal = createMemorySandboxJournal({ env: {} });
    const deleted: Date[] = [];
    vi.spyOn(journal, "deleteOlderThan").mockImplementation(async (before) => {
      deleted.push(before);
      return 0;
    });
    setupSandbox({ sandbox: { journal, retentionDays: 7 } });
    expect(deleted).toEqual([new Date("2026-09-24T00:00:00Z")]);
  });

  it("таймер не держит процесс (unref)", () => {
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as never);
    setupSandbox({ storage: createInMemoryChatStorage() });
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 24 * 60 * 60 * 1000);
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });
});
