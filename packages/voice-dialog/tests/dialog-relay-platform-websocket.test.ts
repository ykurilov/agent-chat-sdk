import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDialogRelay } from "../src/server/dialog-relay";
import { connectFake } from "./support/fake-socket";
import { ELEVEN_KEY, SONIOX_KEY } from "./support/session-harness";

afterEach(() => vi.unstubAllGlobals());

const speech = {
  voices: [{ id: "voice-1", name: "Диктор" }],
  defaultVoiceId: "voice-1",
  pricePerThousandChars: { eleven_v4_turbo: 0.05, eleven_v4: 0.1 },
  apiKey: ELEVEN_KEY,
};

function createRelay(overrides: Parameters<typeof createDialogRelay>[0] extends infer O ? Partial<O> : never) {
  return createDialogRelay({
    storage: createInMemoryChatStorage(),
    resolveUser: async () => ({ id: "anna" }),
    speech: { ...speech, connect: connectFake },
    recognition: { apiKey: SONIOX_KEY, connectUpstream: connectFake },
    logError: () => {},
    ...overrides,
  });
}

describe("голосовой диалог на Node без встроенного WebSocket (Node 20)", () => {
  it("при создании говорит понятно, что нужен Node 22, а не падает при первом соединении", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => createRelay({ speech, recognition: { apiKey: SONIOX_KEY } })).toThrow(/Node\.js 22/);
    expect(() => createRelay({ recognition: { apiKey: SONIOX_KEY } })).toThrow(/Node\.js 22/);
    expect(() => createRelay({ speech: { ...speech } })).toThrow(/Node\.js 22/);
  });

  it("со своим способом соединения везде встроенный WebSocket не нужен", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => createRelay({})).not.toThrow();
  });
});
