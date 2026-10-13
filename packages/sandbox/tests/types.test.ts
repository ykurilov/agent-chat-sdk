import type { AnswerEdit, ModelCallEvent, SpendingLimits, ToolCallEvent } from "@ykurilov/agent-chat-core";
import type { ChatHandlerOptions } from "@ykurilov/agent-chat-server";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AnswerEditMark,
  AnswerEditRecord,
  AnswerEditRequest,
  AnswerEditResponse,
  JournalBlob,
  JournalCallDetails,
  JournalEntry,
  JournalListResponse,
  SandboxChatSettings,
  SandboxHandlerOptions,
  SandboxHistoryExtras,
  SandboxJournal,
  SandboxSettingsRequest,
  SandboxSettingsResponse,
  Serialized,
} from "../src/index";
import type { SandboxJournal as SqliteEntryJournal } from "../src/sqlite";
import type { SandboxJournal as PostgresEntryJournal } from "../src/postgres";

// Типы проверяет `pnpm typecheck` (тесты входят в tsconfig пакета): рантайм здесь только подтверждает, что файл выполнился.
describe("типы песочницы", () => {
  it("SandboxHandlerOptions: боевые настройки чата, доступ админа, журнал, срок жизни и пределы", () => {
    expectTypeOf<SandboxHandlerOptions["chat"]>().toEqualTypeOf<ChatHandlerOptions>();
    expectTypeOf<SandboxHandlerOptions["basePath"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SandboxHandlerOptions["isAdmin"]>().toEqualTypeOf<(user: { id: string }, request: Request) => boolean | Promise<boolean>>();
    expectTypeOf<SandboxHandlerOptions["journal"]>().toEqualTypeOf<SandboxJournal>();
    expectTypeOf<SandboxHandlerOptions["retentionDays"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SandboxHandlerOptions["limits"]>().toEqualTypeOf<SpendingLimits | undefined>();
    expect(true).toBe(true);
  });

  it("SandboxJournal: очередь записи, чтение, настройки, правки, удаление", () => {
    expectTypeOf<SandboxJournal["enqueueModelCall"]>().toEqualTypeOf<(event: ModelCallEvent) => void>();
    expectTypeOf<SandboxJournal["enqueueToolCall"]>().toEqualTypeOf<(event: ToolCallEvent) => void>();
    expectTypeOf<SandboxJournal["flush"]>().toEqualTypeOf<() => Promise<void>>();
    expectTypeOf<SandboxJournal["listForChat"]>().toEqualTypeOf<(chatId: string, options?: { messageId?: string }) => Promise<JournalEntry[]>>();
    expectTypeOf<SandboxJournal["getCall"]>().toEqualTypeOf<(callId: string) => Promise<JournalCallDetails | null>>();
    expectTypeOf<SandboxJournal["getBlob"]>().toEqualTypeOf<(hash: string, ownerId: string) => Promise<JournalBlob | null>>();
    expectTypeOf<SandboxJournal["getSettings"]>().toEqualTypeOf<(chatId: string) => Promise<SandboxChatSettings | null>>();
    expectTypeOf<SandboxJournal["setSettings"]>().toEqualTypeOf<(settings: SandboxChatSettings) => Promise<void>>();
    expectTypeOf<SandboxJournal["markAnswerEdited"]>().toEqualTypeOf<(record: AnswerEditRecord) => Promise<void>>();
    expectTypeOf<SandboxJournal["listEditedAnswers"]>().toEqualTypeOf<(chatId: string) => Promise<AnswerEditRecord[]>>();
    expectTypeOf<SandboxJournal["deleteChat"]>().toEqualTypeOf<(chatId: string) => Promise<void>>();
    expectTypeOf<SandboxJournal["deleteOlderThan"]>().toEqualTypeOf<(before: Date) => Promise<number>>();
    expectTypeOf<SandboxJournal["close"]>().toEqualTypeOf<() => Promise<void>>();
    expectTypeOf<SqliteEntryJournal>().toEqualTypeOf<SandboxJournal>();
    expectTypeOf<PostgresEntryJournal>().toEqualTypeOf<SandboxJournal>();
    expect(true).toBe(true);
  });

  it("записи журнала: обращение без тел, вызов, подробности с кусками", () => {
    expectTypeOf<JournalEntry["kind"]>().toEqualTypeOf<"model" | "tool">();
    const entries: JournalEntry[] = [
      {
        kind: "model",
        id: "call-1",
        chatId: "c1",
        ownerId: "sandbox:u1",
        messageId: "m1",
        purpose: "answer",
        attempt: 1,
        modelId: "claude-sonnet-5-5",
        providerId: "anthropic",
        usage: null,
        costUsd: null,
        startedAt: new Date(0),
        firstChunkMs: 120,
        durationMs: 900,
        status: "complete",
        error: null,
        instructionsChanged: false,
      },
      {
        kind: "tool",
        id: "tool-1",
        chatId: "c1",
        ownerId: "sandbox:u1",
        messageId: "m1",
        modelCallId: "call-1",
        toolCallId: "tc-1",
        toolName: "search",
        inputHash: "h1",
        outputHash: "h2",
        error: null,
        startedAt: new Date(0),
        durationMs: 40,
      },
    ];
    const details: JournalCallDetails = {
      kind: "tool",
      call: entries[1] as Extract<JournalEntry, { kind: "tool" }>,
      input: { hash: "h1", content: { q: "кот" }, bytes: 9, truncated: false },
      output: null,
    };
    expect([...entries.map((entry) => entry.kind), details.kind]).toEqual(["model", "tool", "tool"]);
  });

  it("правка ответа: отметки textEdited и editedToolCallIds", () => {
    expectTypeOf<AnswerEditMark>().toEqualTypeOf<{ textEdited: boolean; editedToolCallIds: string[] }>();
    expectTypeOf<AnswerEditRecord>().toExtend<AnswerEditMark>();
    expectTypeOf<AnswerEditRecord["sourceMessageId"]>().toEqualTypeOf<string>();
    expectTypeOf<AnswerEditRequest>().toEqualTypeOf<AnswerEdit>();
    expectTypeOf<AnswerEditResponse["mark"]>().toEqualTypeOf<AnswerEditMark>();
    expectTypeOf<SandboxHistoryExtras["answerEdits"]>().toEqualTypeOf<Record<string, AnswerEditMark>>();
    expect(true).toBe(true);
  });

  it("ответы адресов: даты строками, настройки с боевой инструкцией", () => {
    expectTypeOf<Serialized<{ at: Date; list: Array<{ at: Date }>; n: number | null }>>().toEqualTypeOf<{ at: string; list: Array<{ at: string }>; n: number | null }>();
    expectTypeOf<JournalListResponse["entries"][number]["startedAt"]>().toEqualTypeOf<string>();
    expectTypeOf<SandboxSettingsResponse>().toEqualTypeOf<{ instructions: string | null; appInstructions: string; updatedAt: string | null }>();
    expectTypeOf<SandboxSettingsRequest>().toEqualTypeOf<{ instructions: string | null }>();
    expect(true).toBe(true);
  });
});
