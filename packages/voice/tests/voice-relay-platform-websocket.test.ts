import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRelay } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.unstubAllGlobals());

const baseOptions = {
  resolveUser: async () => ({ id: "anna" }),
  apiKey: "main-secret-key-0123456789",
  websocketUrl: "wss://stt.test/transcribe",
};

describe("голосовой сервер на Node без встроенного WebSocket (Node 20)", () => {
  it("при создании говорит понятно, что нужен Node 22, а не падает при первом соединении", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => createVoiceRelay(baseOptions)).toThrow(/Node\.js 22/);
  });

  it("со своим способом соединения встроенный WebSocket не нужен", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => createVoiceRelay({ ...baseOptions, connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never })).not.toThrow();
  });
});
