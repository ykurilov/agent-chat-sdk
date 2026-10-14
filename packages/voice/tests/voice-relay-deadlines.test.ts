import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRelay, RELAY_CLOSE } from "../src/server";
import type { RelayClientSocket, VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.useRealTimers());

class FakeClient implements RelayClientSocket {
  closedWith: number | undefined;
  send() {}
  close(code: number) {
    this.closedWith = code;
  }
}

function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  FakeUpstream.instances = [];
  return createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: "main-key",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: () => undefined,
    ...options,
  });
}

const request = () => new Request("http://app.test/api/voice/stream");

describe("ретранслятор: срок до приветствия", () => {
  it("браузер молчит после подъёма — закрытие «протокол» через 10 с, слот пользователя свободен", async () => {
    vi.useFakeTimers();
    const relay = relayWith({ maxConnectionsPerUser: 1, rateLimit: false });
    const silent = new FakeClient();
    relay.accept(silent, { id: "anna" });
    expect("refusal" in (await relay.authorize(request()))).toBe(true);

    vi.advanceTimersByTime(9_999);
    expect(silent.closedWith).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(silent.closedWith).toBe(RELAY_CLOSE.protocol);
    expect("user" in (await relay.authorize(request()))).toBe(true);
  });

  it("приветствие пришло вовремя — срок снят, соединение живёт дальше", () => {
    vi.useFakeTimers();
    const relay = relayWith({ helloTimeoutMs: 1_000 });
    const client = new FakeClient();
    relay.accept(client, { id: "anna" }).receive(JSON.stringify({ audio_format: "auto" }));

    vi.advanceTimersByTime(5_000);

    expect(client.closedWith).toBeUndefined();
  });
});

describe("ретранслятор: предел одного куска (единый для Hono и node)", () => {
  it("кусок звука больше `maxFrameBytes` — закрытие 1009", () => {
    const relay = relayWith({ maxFrameBytes: 1024 });
    const client = new FakeClient();
    const connection = relay.accept(client, { id: "anna" });
    connection.receive(JSON.stringify({ audio_format: "auto" }));
    FakeUpstream.instances.at(-1)!.open();

    connection.receive(new Uint8Array(4096));

    expect(client.closedWith).toBe(RELAY_CLOSE.messageTooBig);
    expect(FakeUpstream.instances.at(-1)!.sent.filter((item) => typeof item !== "string")).toEqual([]);
  });

  it("текст больше предела (длинное приветствие) — тоже 1009", () => {
    const relay = relayWith({ maxFrameBytes: 64 });
    const client = new FakeClient();
    relay.accept(client, { id: "anna" }).receive(JSON.stringify({ audio_format: "auto", padding: "x".repeat(200) }));
    expect(client.closedWith).toBe(RELAY_CLOSE.messageTooBig);
  });
});
