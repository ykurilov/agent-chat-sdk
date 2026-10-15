import type { ChatEvent, ChatService } from "@ykurilov/agent-chat-core";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createChatServer } from "../src/chat-handler";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";

// Несколько обработчиков на одном хранилище: брошенную пачку обход отдаёт службе из `abandonedBursts.serviceFor`.

const HOUR_AGO = new Date(Date.now() - 3_600_000);

function server(options: Partial<ChatHandlerOptions> & Pick<ChatHandlerOptions, "storage">) {
  return createChatServer({
    basePath: "/api/chat",
    resolveUser: async () => ({ id: "anna" }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: mockCatalog(),
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    ...options,
  });
}

describe("обработчик чата: abandonedBursts", () => {
  it("serviceFor передан в службу: пачку упавшей копии отвечает названная служба, а не та, что делала обход", async () => {
    const storage = createInMemoryChatStorage();
    const crashed = server({ storage, now: () => HOUR_AGO });
    const chat = await crashed.service.createChat("anna");
    const sent = await crashed.service.sendBurstMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }, { answerAfterRestart: true });
    void sent.turn.catch(() => {});

    let version: ChatService | null = null;
    const serviceFor = vi.fn(() => version);
    const recovery = server({ storage, abandonedBursts: { serviceFor } });
    const own = server({ storage, abandonedBursts: { serviceFor } });
    version = own.service;
    const started: Array<{ service: string; event: ChatEvent }> = [];
    recovery.service.subscribeEvents((event) => started.push({ service: "recovery", event }));
    own.service.subscribeEvents((event) => started.push({ service: "own", event }));

    await recovery.service.recoverInterruptedAnswers({ soleServer: true });
    await vi.waitFor(() => expect(started.filter(({ event }) => event.type === "turn-finished")).toHaveLength(1));
    expect(serviceFor).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "anna", chatId: chat.id }));
    expect(started.filter(({ event }) => event.type === "turn-started").map(({ service }) => service)).toEqual(["own"]);
    await own.service.flush();
  });
});
