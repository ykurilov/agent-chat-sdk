import { ChatNotFoundError, SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { RecordExternalUsageInput } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRelay, RELAY_CLOSE } from "../src/server";
import type { RelayClientSocket, VoiceRelayOptions, VoiceSpending } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.useRealTimers());

class FakeClient implements RelayClientSocket {
  readonly sent: string[] = [];
  closedWith: number | undefined;
  send(data: string) {
    this.sent.push(data);
  }
  close(code: number) {
    this.closedWith = code;
  }
  get messages() {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }
}

function fakeService(options: { overLimit?: boolean; ownChats?: string[] } = {}) {
  const recorded: RecordExternalUsageInput[] = [];
  const checked: Array<[string, string]> = [];
  const ownChats = options.ownChats ?? ["chat-42"];
  const service: VoiceSpending["service"] = {
    async assertOwnChat(_userId, chatId) {
      if (!ownChats.includes(chatId)) throw new ChatNotFoundError(chatId);
    },
    async assertWithinLimit(ownerId, chatId) {
      checked.push([ownerId, chatId]);
      if (options.overLimit) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
    },
    async recordUsage(input) {
      recorded.push(input);
    },
  };
  return { service, recorded, checked };
}

let clock = 0;
function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  FakeUpstream.instances = [];
  clock = 1_000_000;
  const logged: string[] = [];
  const relay = createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: "main-secret-key-0123456789",
    websocketUrl: "wss://stt.test/transcribe",
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: (message) => logged.push(message),
    now: () => clock,
    ...options,
  });
  return { relay, logged, upstream: () => FakeUpstream.instances.at(-1)! };
}

const request = (query = "") => new Request(`http://app.test/api/voice/stream${query}`);

async function dictate(options: Partial<VoiceRelayOptions>, query = "?chat=chat-42") {
  const setup = relayWith(options);
  const access = await setup.relay.authorize(request(query));
  if (!("user" in access)) throw new Error("ожидали допуск");
  const client = new FakeClient();
  const connection = setup.relay.accept(client, access.user, access.chatId);
  connection.receive(JSON.stringify({ audio_format: "auto" }));
  setup.upstream().open();
  return { ...setup, client, connection, access };
}

describe("голос: расход распознавания в журнал и лимиты (voice_input)", () => {
  it("лимит исчерпан — отказ до подъёма с кодом закрытия «лимит», Soniox не зовём", async () => {
    const { service, checked } = fakeService({ overLimit: true });
    const { relay } = relayWith({ spending: { service, recognitionUsdPerHour: 0.12 } });

    const access = await relay.authorize(request("?chat=chat-42"));

    expect("refusal" in access && access.closeCode).toBe(RELAY_CLOSE.limit);
    expect("refusal" in access && access.refusal.status).toBe(402);
    expect(checked).toEqual([["anna", "chat-42"]]);
    expect(FakeUpstream.instances).toHaveLength(0);
  });

  it("секунды звука от первого куска до конца — расход voice_input на человека и его чат по цене за час", async () => {
    const { service, recorded } = fakeService();
    const { connection, upstream } = await dictate({ spending: { service, recognitionUsdPerHour: 0.36 } });

    connection.receive(new Uint8Array([1, 2]));
    clock += 9_400;
    connection.receive("");
    upstream().receive({ tokens: [], finished: true });
    upstream().drop(1000);
    await vi.waitFor(() => expect(recorded).toHaveLength(1));

    expect(recorded[0]).toMatchObject({
      ownerId: "anna",
      chatId: "chat-42",
      source: "voice_input",
      modelId: "stt-rt-v5",
      providerId: "soniox",
      inputTokens: 10,
      outputTokens: 0,
    });
    expect(recorded[0]!.cost).toBeCloseTo((10 * 0.36) / 3600, 10);
  });

  it("браузер закрыл соединение посреди записи — расход всё равно записан, один раз", async () => {
    const { service, recorded } = fakeService();
    const { connection } = await dictate({ spending: { service, recognitionUsdPerHour: 0.36 } });

    connection.receive(new Uint8Array([1]));
    clock += 2_000;
    connection.closed();
    connection.closed();
    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]!.inputTokens).toBe(2);
  });

  it("звука не было — расхода нет", async () => {
    const { service, recorded } = fakeService();
    const { connection } = await dictate({ spending: { service, recognitionUsdPerHour: 0.36 } });
    connection.closed();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(recorded).toEqual([]);
  });

  it("чат из адреса без признаков номера (или без него) — метка `voice`", async () => {
    const { service, checked } = fakeService();
    const { relay } = relayWith({ spending: { service, recognitionUsdPerHour: 0.1 } });

    await relay.authorize(request("?chat=../../etc"));
    await relay.authorize(request());

    expect(checked).toEqual([
      ["anna", "voice"],
      ["anna", "voice"],
    ]);
  });

  it("чат из адреса чужой или его нет — лимит и расход без чата (`voice`): окно чужого чата не трогаем", async () => {
    const { service, checked, recorded } = fakeService({ ownChats: ["chat-42"] });
    const { relay } = relayWith({ spending: { service, recognitionUsdPerHour: 0.1 } });

    const foreign = await relay.authorize(request("?chat=boris-chat"));
    const own = await relay.authorize(request("?chat=chat-42"));

    expect("user" in foreign && foreign.chatId).toBe("voice");
    expect("user" in own && own.chatId).toBe("chat-42");
    expect(checked).toEqual([
      ["anna", "voice"],
      ["anna", "chat-42"],
    ]);
    expect(recorded).toEqual([]);
  });

  it("свой выбор чата приложением", async () => {
    const { service, checked } = fakeService();
    const { relay } = relayWith({ spending: { service, recognitionUsdPerHour: 0.1, chatId: async (_request, user) => `dictation-${user.id}` } });
    const access = await relay.authorize(request("?chat=chat-42"));
    expect("user" in access && access.chatId).toBe("dictation-anna");
    expect(checked).toEqual([["anna", "dictation-anna"]]);
  });

  it("цена распознавания обязательна и не меньше нуля", () => {
    const { service } = fakeService();
    expect(() => relayWith({ spending: { service, recognitionUsdPerHour: -1 } })).toThrow(/recognitionUsdPerHour/);
    expect(() => relayWith({ spending: { service } as never })).toThrow(/recognitionUsdPerHour/);
  });
});

describe("голос: расход чистки текста моделью (voice_polish)", () => {
  async function polishRun(options: Partial<VoiceRelayOptions>) {
    const setup = await dictate(options);
    setup.connection.receive(JSON.stringify({ type: "finalize" }));
    setup.upstream().receive({ tokens: [{ text: "ну э привет мир", is_final: true }, { text: "<fin>", is_final: true }] });
    await vi.waitFor(() => expect(setup.client.messages.some((message) => "polished" in message)).toBe(true));
    return setup;
  }

  it("чистка через askModel службы чата: модель каталога, человек и чат, вид voice_polish", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const askModel = vi.fn(async (input: Record<string, unknown>) => {
      asked.push(input);
      return { text: "Привет, мир.", usage: { inputTokens: 50, outputTokens: 5, costUsd: 0.0001 } };
    });
    const { service } = fakeService();
    const { client } = await polishRun({
      spending: { service, recognitionUsdPerHour: 0.1 },
      polish: { askModel: askModel as never, model: { modelId: "deepseek-v4-flash", providerId: "together" } },
    });

    expect(client.messages.find((message) => "polished" in message)).toEqual({ polished: { text: "Привет, мир." } });
    expect(asked[0]).toMatchObject({ ownerId: "anna", chatId: "chat-42", source: "voice_polish", model: { modelId: "deepseek-v4-flash", providerId: "together" } });
    expect(String(asked[0]!.prompt)).toContain("ну э привет мир");
  });

  it("askModel отказал по лимиту — текст остаётся как сказал Soniox", async () => {
    const askModel = vi.fn(async () => {
      throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
    });
    const { client } = await polishRun({ polish: { askModel: askModel as never, model: { modelId: "m", providerId: "p" } } });
    expect(client.messages.find((message) => "polished" in message)).toEqual({ polished: { text: null } });
  });

  it("Together с ценой: токены ответа — расход voice_polish в журнал", async () => {
    const { service, recorded } = fakeService();
    const fetchStub = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: "Привет, мир." } }], usage: { prompt_tokens: 1_000, completion_tokens: 200 } }),
    );
    await polishRun({
      spending: { service, recognitionUsdPerHour: 0 },
      polish: { provider: "together", apiKey: "together-key", fetch: fetchStub as never, pricing: { inputPerMillion: 0.2, outputPerMillion: 0.8 } },
    });

    await vi.waitFor(() => expect(recorded.some((record) => record.source === "voice_polish")).toBe(true));
    const polish = recorded.find((record) => record.source === "voice_polish")!;
    expect(polish).toMatchObject({ ownerId: "anna", chatId: "chat-42", providerId: "together", inputTokens: 1_000, outputTokens: 200 });
    expect(polish.cost).toBeCloseTo((1_000 * 0.2 + 200 * 0.8) / 1_000_000, 12);
  });

  it("Together при учёте расходов без цены — ошибка при создании: чистка не должна идти мимо лимитов", () => {
    const { service } = fakeService();
    expect(() => relayWith({ spending: { service, recognitionUsdPerHour: 0 }, polish: { provider: "together", apiKey: "k" } })).toThrow(/pricing/);
  });

  it("лимит исчерпан к концу диктовки — чистку не зовём, текст остаётся", async () => {
    let overLimit = false;
    const recorded: RecordExternalUsageInput[] = [];
    const service: VoiceSpending["service"] = {
      async assertOwnChat() {},
      async assertWithinLimit() {
        if (overLimit) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      async recordUsage(input) {
        recorded.push(input);
      },
    };
    const clean = vi.fn(async () => ({ text: "Привет, мир.", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001, modelId: "own" } }));
    const setup = await dictate({ spending: { service, recognitionUsdPerHour: 0 }, polish: { clean } });
    overLimit = true;
    setup.connection.receive(JSON.stringify({ type: "finalize" }));
    setup.upstream().receive({ tokens: [{ text: "привет мир", is_final: true }, { text: "<fin>", is_final: true }] });
    await vi.waitFor(() => expect(setup.client.messages.some((message) => "polished" in message)).toBe(true));

    expect(clean).not.toHaveBeenCalled();
    expect(setup.client.messages.find((message) => "polished" in message)).toEqual({ polished: { text: null } });
  });

  it("своя чистка сообщает расход — он в журнале как voice_polish", async () => {
    const { service, recorded } = fakeService();
    const clean = vi.fn(async () => ({ text: "Привет, мир.", usage: { inputTokens: 30, outputTokens: 4, costUsd: 0.002, modelId: "own-model", providerId: "own" } }));
    await polishRun({ spending: { service, recognitionUsdPerHour: 0 }, polish: { clean } });
    await vi.waitFor(() => expect(recorded.some((record) => record.source === "voice_polish")).toBe(true));
    expect(recorded.find((record) => record.source === "voice_polish")).toMatchObject({ modelId: "own-model", providerId: "own", inputTokens: 30, outputTokens: 4, cost: 0.002 });
  });
});
