import { describe, expect, it } from "vitest";
import { createVoiceRelay, RELAY_CLOSE } from "../src/server";
import type { RelayAccess, VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  return createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: "main-key",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: () => undefined,
    ...options,
  });
}

const request = (headers: Record<string, string> = {}) => new Request("http://app.test/api/voice/stream", { headers });
const closeCodeOf = (access: RelayAccess) => ("refusal" in access ? access.closeCode : "допущен");

describe("ретранслятор голоса: причина отказа доходит до браузера кодом закрытия", () => {
  it("не вошёл — «нет доступа» (4401)", async () => {
    expect(closeCodeOf(await relayWith({ resolveUser: async () => null }).authorize(request()))).toBe(RELAY_CLOSE.unauthorized);
  });

  it.each([
    ["limit", RELAY_CLOSE.limit],
    ["spending_limit_reached", RELAY_CLOSE.limit],
    ["too_long", RELAY_CLOSE.tooLong],
    ["rate_limited", RELAY_CLOSE.rateLimited],
    ["service_unavailable", RELAY_CLOSE.upstream],
    ["no_course", RELAY_CLOSE.forbidden],
  ])("отказ приложения с кодом %s → код закрытия %s", async (code, closeCode) => {
    const relay = relayWith({ resolveUser: async () => ({ refused: { code, message: "нет" } }) });
    expect(closeCodeOf(await relay.authorize(request()))).toBe(closeCode);
  });

  it("частота превышена — 4429; нет ключа Soniox — 4502", async () => {
    const limited = relayWith({ rateLimit: { maxSessions: 1, perSeconds: 60 } });
    await limited.authorize(request());
    expect(closeCodeOf(await limited.authorize(request()))).toBe(RELAY_CLOSE.rateLimited);
    expect(closeCodeOf(await relayWith({ apiKey: undefined, env: {} }).authorize(request()))).toBe(RELAY_CLOSE.upstream);
  });

  it("чужая страница соединения не получает вовсе: только HTTP-отказ, без кода закрытия", async () => {
    const access = await relayWith().authorize(request({ Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" }));
    expect("refusal" in access && access.refusal.status).toBe(403);
    expect(closeCodeOf(access)).toBeUndefined();
  });
});
