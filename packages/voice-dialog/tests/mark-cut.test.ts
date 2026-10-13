import { CURRENT_FORMAT_VERSION, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, StoredMessage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { sessionWith } from "./support/session-harness";

const newStoredMessage = (fields: Pick<StoredMessage, "id" | "chatId" | "role">): StoredMessage => ({
  parentId: null,
  parts: [],
  formatVersion: CURRENT_FORMAT_VERSION,
  status: "complete",
  modelId: null,
  providerId: null,
  usage: null,
  reasoningDurationsMs: {},
  error: null,
  createdAt: new Date().toISOString(),
  ...fields,
});

async function storageWithMessages(): Promise<ChatStorage> {
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: "chat-1", ownerId: "anna", modelId: "m", providerId: "p" });
  await storage.createChat({ id: "chat-2", ownerId: "boris", modelId: "m", providerId: "p" });
  await storage.insertMessage(newStoredMessage({ id: "own", chatId: "chat-1", role: "assistant" }));
  await storage.insertMessage(newStoredMessage({ id: "question", chatId: "chat-1", role: "user" }));
  await storage.insertMessage(newStoredMessage({ id: "foreign", chatId: "chat-2", role: "assistant" }));
  return storage;
}

const cut = { partIndex: 0, charOffset: 120, spokenTail: "…и на этом слове меня перебили" };
const markCut = (messageId: string, overrides: Record<string, unknown> = {}) => ({ type: "mark_cut" as const, replyId: 1, messageId, ...cut, ...overrides });

describe("отметка обрыва: mark_cut", () => {
  it("своё сообщение агента: cut_saved и отметка лежит в хранилище", async () => {
    const storage = await storageWithMessages();
    const setup = sessionWith({ storage });
    setup.begin();
    await setup.command(markCut("own"));
    expect(setup.of("cut_saved")).toEqual([{ type: "cut_saved", messageId: "own" }]);
    expect((await storage.getMessage("own"))?.voiceCut).toEqual(cut);
  });

  it("сообщение из чужого чата — cut_rejected, в хранилище ничего", async () => {
    const storage = await storageWithMessages();
    const setup = sessionWith({ storage });
    setup.begin();
    await setup.command(markCut("foreign"));
    expect(setup.of("cut_rejected")).toEqual([{ type: "cut_rejected", messageId: "foreign" }]);
    expect((await storage.getMessage("foreign"))?.voiceCut ?? null).toBeNull();
  });

  it("неизвестное сообщение и сообщение человека — cut_rejected", async () => {
    const storage = await storageWithMessages();
    const setup = sessionWith({ storage });
    setup.begin();
    await setup.command(markCut("нет-такого"));
    await setup.command(markCut("question"));
    expect(setup.of("cut_rejected").map((message) => message.messageId)).toEqual(["нет-такого", "question"]);
    expect((await storage.getMessage("question"))?.voiceCut ?? null).toBeNull();
  });

  it("повторная отметка заменяет прежнюю", async () => {
    const storage = await storageWithMessages();
    const setup = sessionWith({ storage });
    setup.begin();
    await setup.command(markCut("own"));
    await setup.command(markCut("own", { charOffset: 40, spokenTail: "раньше" }));
    expect((await storage.getMessage("own"))?.voiceCut).toEqual({ partIndex: 0, charOffset: 40, spokenTail: "раньше" });
  });

  it("хранилище без setVoiceCut — не ошибка: режим продолжает работать, отметка живёт на экране", async () => {
    const storage = await storageWithMessages();
    delete (storage as { setVoiceCut?: unknown }).setVoiceCut;
    const setup = sessionWith({ storage });
    setup.begin();
    await expect(setup.command(markCut("own"))).resolves.toBeUndefined();
    expect(setup.of("cut_rejected")).toEqual([]);
    expect(setup.of("error")).toEqual([]);
    expect(setup.closes).toEqual([]);
  });

  it("хранилище отказало — cut_rejected и запись в журнал, режим жив", async () => {
    const storage = await storageWithMessages();
    storage.setVoiceCut = async () => {
      throw new Error("диск полон");
    };
    const setup = sessionWith({ storage });
    setup.begin();
    await setup.command(markCut("own"));
    expect(setup.of("cut_rejected")).toEqual([{ type: "cut_rejected", messageId: "own" }]);
    expect(setup.logged.join("\n")).toContain("диск полон");
    expect(setup.closes).toEqual([]);
  });

  it("слишком длинный хвост обрезается до последних 200 знаков", async () => {
    const storage = await storageWithMessages();
    const setup = sessionWith({ storage });
    setup.begin();
    await setup.command(markCut("own", { spokenTail: `${"а".repeat(500)}конец` }));
    const saved = (await storage.getMessage("own"))?.voiceCut;
    expect(saved?.spokenTail).toHaveLength(200);
    expect(saved?.spokenTail.endsWith("конец")).toBe(true);
  });
});
