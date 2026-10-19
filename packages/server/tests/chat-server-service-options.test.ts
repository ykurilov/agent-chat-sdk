import * as core from "@ykurilov/agent-chat-core";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { AgentNotice } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatServer } from "../src/index";
import type { ChatHandlerOptions } from "../src/index";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";

vi.mock("@ykurilov/agent-chat-core", async (original) => {
  const actual = await original<typeof import("@ykurilov/agent-chat-core")>();
  return { ...actual, createChatService: vi.fn(actual.createChatService) };
});

afterEach(() => vi.mocked(core.createChatService).mockClear());

type ServiceOptions = Parameters<typeof core.createChatService>[0];
/** Служба сервера заводит их сама: общий реестр идущих ответов и события чата для `watch`. */
type OwnServerKey = "registry" | "chatEvents";

const base: ChatHandlerOptions = {
  basePath: "/api/chat",
  storage: createInMemoryChatStorage(),
  resolveUser: async () => ({ id: "anna" }),
  defaultChoice: { modelId: mockModelId, providerId: "mock" },
  catalog: mockCatalog(),
  agent: { instructions: "Ты помощник." },
  env: mockEnv,
  logError: () => {},
};

describe("102 createChatServer передаёт службе все её опции", () => {
  it("appNoticeViews доходят: пометка flow_timer с правом appNotices есть в истории", async () => {
    const { handler, service } = createChatServer({
      ...base,
      chatCapabilities: () => ({ appNotices: true }),
      appNoticeViews: { flow_timer: (data) => ({ silentMs: (data as { silentMs: number }).silentMs }) },
    });
    const { id: chatId } = (await (await handler.fetch(new Request("http://test.local/api/chat", { method: "POST" }))).json()) as { id: string };
    const notice: AgentNotice = { kind: "app", name: "flow_timer", title: "Человек молчал час", data: { silentMs: 3_600_000, stateId: "s1" } };
    await service.deliverNotices({ ownerId: "anna", chatId, notices: [notice], wakeAgent: false, deliveryKey: "t1" });

    const history = (await (await handler.fetch(new Request(`http://test.local/api/chat/${chatId}`))).json()) as {
      messages: Array<{ parts: Array<{ type: string; data?: { notices?: unknown[] } }> }>;
    };
    const shown = history.messages.flatMap((message) => message.parts.flatMap((part) => part.data?.notices ?? []));
    expect(shown).toEqual([{ kind: "app", name: "flow_timer", data: { silentMs: 3_600_000 } }]);
  });

  it("страж: каждый ключ опций службы доходит до createChatService как есть", () => {
    const sentinel = (key: string) => ({ sentinel: key });
    // `satisfies Record<…>`: новая опция службы без строки здесь — ошибка типов, а не тихо потерянная настройка.
    const everyServiceOption = {
      storage: base.storage,
      catalog: base.catalog,
      defaultChoice: base.defaultChoice,
      agent: base.agent,
      compaction: sentinel("compaction"),
      attachments: sentinel("attachments"),
      memory: sentinel("memory"),
      limits: sentinel("limits"),
      beforeTurn: () => {},
      turnNotStarted: () => {},
      chatCapabilities: () => ({}),
      beforeCreateChat: () => {},
      maxConcurrentTurnsPerUser: 3,
      env: base.env,
      logError: base.logError,
      now: () => new Date(0),
      replyChecks: sentinel("replyChecks"),
      turnObserver: sentinel("turnObserver"),
      chatInstructions: async () => null,
      staffOfChat: () => undefined,
      lockedToolOutputs: ["file_read"],
      abandonedBursts: sentinel("abandonedBursts"),
      background: { listForChat: () => [], cancel: () => {}, answerApproval: () => {} },
      onTurnFinished: () => {},
      afterTurn: () => {},
      afterTurnTimeoutMs: 1000,
      afterTurnAttempts: 2,
      onStateChanged: () => {},
      onStateChangedTimeoutMs: 1000,
      onStateChangedAttempts: 2,
      onModelChosen: () => {},
      modelMenu: sentinel("modelMenu"),
      privateStateKeys: ["secret"],
      appNoticeViews: { flow_timer: () => ({}) },
    } satisfies Record<Exclude<keyof ServiceOptions, OwnServerKey>, unknown>;

    const create = vi.mocked(core.createChatService);
    create.mockImplementationOnce(() => ({}) as ReturnType<typeof core.createChatService>);
    createChatServer({ ...base, ...(everyServiceOption as unknown as Partial<ChatHandlerOptions>) });

    const received = create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(everyServiceOption)) expect(received[key], key).toBe(value);
    expect(received.registry).toBeDefined();
    expect(received.chatEvents).toBeDefined();
    for (const serverOnly of ["basePath", "resolveUser"]) expect(received, serverOnly).not.toHaveProperty(serverOnly);
  });
});
