import { describe, expect, it } from "vitest";
import { createVoiceHandler, createVoiceRelay } from "../src/server";
import type { RelayClientSocket, VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

const client = (): RelayClientSocket => ({ send: () => undefined, close: () => undefined });

/** Подсказка языка, с которой ретранслятор открыл Soniox после приветствия браузера. */
async function hintsAfterHello(hello: Record<string, unknown>, options: Partial<VoiceRelayOptions> = {}) {
  FakeUpstream.instances = [];
  const relay = createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: "main-key",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: () => undefined,
    ...options,
  });
  const access = await relay.authorize(new Request("http://app.test/api/voice/stream"));
  if (!("user" in access)) throw new Error("ожидали допуск");
  relay.accept(client(), access.user).receive(JSON.stringify({ audio_format: "auto", ...hello }));
  const upstream = FakeUpstream.instances.at(-1)!;
  upstream.open();
  return upstream.messages[0]!.language_hints;
}

describe("подсказка языка на каждую запись (режим relay)", () => {
  it("браузер прислал язык человека — Soniox получает его вместо подсказки сервера", async () => {
    expect(await hintsAfterHello({ language_hints: ["en"] }, { languageHints: ["ru"] })).toEqual(["en"]);
  });

  it("код с регионом приводится к языку, регистр и повторы убираются", async () => {
    expect(await hintsAfterHello({ language_hints: ["en-US", "EN", "pt_BR"] })).toEqual(["en", "pt"]);
  });

  it("не похоже на код языка, не список или пусто — подсказка сервера", async () => {
    for (const bad of [["русский"], ["<script>"], "en", [], [42], ["e"]]) {
      expect(await hintsAfterHello({ language_hints: bad }, { languageHints: ["ru"] })).toEqual(["ru"]);
    }
  });

  it("больше трёх языков — берутся первые три", async () => {
    expect(await hintsAfterHello({ language_hints: ["en", "de", "fr", "es"] })).toEqual(["en", "de", "fr"]);
  });

  it("allowedLanguageHints: чужие языки отбрасываются, а без своих остаётся подсказка сервера", async () => {
    const options = { languageHints: ["ru"], allowedLanguageHints: ["ru", "en"] };
    expect(await hintsAfterHello({ language_hints: ["de", "en"] }, options)).toEqual(["en"]);
    expect(await hintsAfterHello({ language_hints: ["de"] }, options)).toEqual(["ru"]);
  });

  it("allowedLanguageHints с регионом (`pt-BR`) разрешает язык `pt`", async () => {
    const options = { languageHints: ["ru"], allowedLanguageHints: ["pt-BR", "EN_us"] };
    expect(await hintsAfterHello({ language_hints: ["pt-BR"] }, options)).toEqual(["pt"]);
    expect(await hintsAfterHello({ language_hints: ["en"] }, options)).toEqual(["en"]);
  });

  it("без подсказки от браузера — как раньше", async () => {
    expect(await hintsAfterHello({}, { languageHints: ["ru", "en"] })).toEqual(["ru", "en"]);
  });
});

describe("подсказка языка на каждую запись (режим direct)", () => {
  const handler = (options: { languageHints?: string[]; allowedLanguageHints?: string[] } = {}) =>
    createVoiceHandler({
      basePath: "/api/voice",
      resolveUser: async () => ({ id: "anna" }),
      apiKey: "main-key",
      fetch: (async () => Response.json({ api_key: "temp:1", expires_at: "2026-09-30T00:00:00.000Z" }, { status: 201 })) as unknown as typeof fetch,
      ...options,
    });
  const session = async (body: unknown, options?: Parameters<typeof handler>[0]) => {
    const response = await handler(options).fetch(
      new Request("http://app.test/api/voice/session", { method: "POST", ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) }),
    );
    return ((await response.json()) as { languageHints: string[] }).languageHints;
  };

  it("язык из тела запроса ключа — в ответе, после той же проверки", async () => {
    expect(await session({ languageHints: ["en-GB"] }, { languageHints: ["ru"] })).toEqual(["en"]);
    expect(await session({ languageHints: ["de"] }, { languageHints: ["ru"], allowedLanguageHints: ["ru", "en"] })).toEqual(["ru"]);
    expect(await session({ languageHints: "<x>" }, { languageHints: ["ru"] })).toEqual(["ru"]);
  });

  it("без тела — подсказка сервера, как раньше", async () => {
    expect(await session(undefined, { languageHints: ["ru"] })).toEqual(["ru"]);
  });
});
