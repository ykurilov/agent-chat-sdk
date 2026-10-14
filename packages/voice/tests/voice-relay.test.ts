import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRelay } from "../src/server";
import type { RelayClientSocket, RelayConnection, VoiceRelayOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.useRealTimers());

const MAIN_KEY = "main-secret-key-0123456789";
const UPSTREAM_URL = "wss://stt.test/transcribe";

class FakeClient implements RelayClientSocket {
  readonly sent: string[] = [];
  closedWith: { code: number } | undefined;
  send(data: string) {
    this.sent.push(data);
  }
  close(code: number) {
    this.closedWith = { code };
  }
  get messages() {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }
}

function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  FakeUpstream.instances = [];
  const logged: string[] = [];
  const relay = createVoiceRelay({
    resolveUser: async () => ({ id: "anna" }),
    apiKey: MAIN_KEY,
    websocketUrl: UPSTREAM_URL,
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    logError: (message) => logged.push(message),
    ...options,
  });
  return { relay, logged, upstream: () => FakeUpstream.instances.at(-1)! };
}

const upgradeRequest = () => new Request("http://app.test/api/voice/stream");

async function connect(options: Partial<VoiceRelayOptions> = {}, hello: unknown = { audio_format: "auto" }) {
  const setup = relayWith(options);
  const decision = await setup.relay.authorize(upgradeRequest());
  if (!("user" in decision)) throw new Error("ожидали допуск");
  const client = new FakeClient();
  const connection = setup.relay.accept(client, decision.user);
  connection.receive(JSON.stringify(hello));
  return { ...setup, client, connection, decision };
}

async function ready(options: Partial<VoiceRelayOptions> = {}, hello?: unknown) {
  const setup = await connect(options, hello);
  setup.upstream().open();
  return setup;
}

describe("ретранслятор голоса: допуск", () => {
  it("отказ resolveUser словами приложения — отказ подъёма с их кодом", async () => {
    const denied = await relayWith({ resolveUser: async () => ({ refused: { code: "no_course", message: "Нужен доступ к курсу" } }) }).relay.authorize(upgradeRequest());
    expect("refusal" in denied && denied.refusal.status).toBe(403);
    expect("refusal" in denied && (await denied.refusal.json())).toEqual({ error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" } });
  });

  it("вошедшему — допуск; нет пользователя — 401", async () => {
    const { relay } = relayWith();
    expect(await relay.authorize(upgradeRequest())).toEqual({ user: { id: "anna" }, chatId: "voice" });

    const denied = await relayWith({ resolveUser: async () => null }).relay.authorize(upgradeRequest());
    expect("refusal" in denied && denied.refusal.status).toBe(401);
  });

  it("нет ключа Soniox на сервере — 503, причина в журнале", async () => {
    const { relay, logged } = relayWith({ apiKey: undefined, env: {} });

    const decision = await relay.authorize(upgradeRequest());

    expect("refusal" in decision && decision.refusal.status).toBe(503);
    expect(logged.join("\n")).toContain("SONIOX_API_KEY");
  });

  it("resolveUser упал — 503, не голый сбой", async () => {
    const { relay, logged } = relayWith({
      resolveUser: async () => {
        throw new Error("сессии недоступны");
      },
    });

    const decision = await relay.authorize(upgradeRequest());

    expect("refusal" in decision && decision.refusal.status).toBe(503);
    expect(logged.join("\n")).toContain("сессии недоступны");
  });

  it("частота соединений на пользователя ограничена: сверх лимита — 429", async () => {
    const { relay } = relayWith({ rateLimit: { maxSessions: 2, perSeconds: 60 } });

    await relay.authorize(upgradeRequest());
    await relay.authorize(upgradeRequest());
    const third = await relay.authorize(upgradeRequest());

    expect("refusal" in third && third.refusal.status).toBe(429);
    expect("refusal" in third && third.refusal.headers.get("cache-control")).toBe("no-store");
  });
});

describe("ретранслятор голоса: путь звука", () => {
  it("после приветствия и соединения с Soniox: первое сообщение с главным ключом уходит Soniox, браузеру — «готово»", async () => {
    const { client, upstream } = await ready({
      model: "stt-rt-v5",
      languageHints: ["ru"],
      context: { general: [{ key: "тема", value: "магазин" }] },
      upstreamHeaders: { "X-Proxy-Token": "proxy-token" },
    });

    expect(upstream().url).toBe(UPSTREAM_URL);
    expect(upstream().headers).toEqual({ "X-Proxy-Token": "proxy-token" });
    expect(JSON.parse(upstream().sent[0] as string)).toEqual({
      api_key: MAIN_KEY,
      model: "stt-rt-v5",
      audio_format: "auto",
      language_hints: ["ru"],
      context: { general: [{ key: "тема", value: "магазин" }] },
      enable_endpoint_detection: true,
    });
    expect(client.messages).toEqual([{ ready: true, max_session_seconds: 300 }]);
  });

  it("браузер не получает главного ключа ни в каком виде", async () => {
    const { client, upstream } = await ready();
    upstream().receive({ tokens: [{ text: "Привет", is_final: true }] });
    upstream().receive({ error_code: 401, error_message: `bad key ${MAIN_KEY}` });

    expect(client.sent.join("\n")).not.toContain(MAIN_KEY);
  });

  it("звук и конец звука идут в Soniox как есть", async () => {
    const { connection, upstream } = await ready();

    connection.receive(new Uint8Array([1, 2, 3]));
    connection.receive(new Uint8Array([4]).buffer);
    connection.receive("");

    expect(upstream().sent.slice(1)).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([4]), ""]);
  });

  it("команда «закрепить всё сказанное» от браузера доходит до Soniox; метка <fin> возвращается браузеру", async () => {
    const { client, connection, upstream } = await ready();

    connection.receive(JSON.stringify({ type: "finalize" }));
    upstream().receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<fin>", is_final: true }] });

    expect(upstream().sent.slice(1)).toEqual([JSON.stringify({ type: "finalize" })]);
    expect(client.messages.at(-1)).toEqual({ tokens: [{ text: "Привет", is_final: true }, { text: "<fin>", is_final: true }] });
  });

  it.each([
    ["чужая команда", JSON.stringify({ type: "shutdown" })],
    ["непустой текст", "привет"],
    ["второе приветствие", JSON.stringify({ audio_format: "auto" })],
  ])("лишнее текстовое сообщение (%s) — нарушение порядка, 4400", async (_name, message) => {
    const { client, connection } = await ready();

    connection.receive(message);

    expect(client.closedWith?.code).toBe(4400);
  });

  it("слова Soniox идут браузеру теми же сообщениями", async () => {
    const { client, upstream } = await ready();

    upstream().receive({ tokens: [{ text: "При", is_final: false }] });
    upstream().receive({ tokens: [{ text: "Привет", is_final: true }], finished: true });

    expect(client.messages.slice(1)).toEqual([
      { tokens: [{ text: "При", is_final: false }] },
      { tokens: [{ text: "Привет", is_final: true }], finished: true },
    ]);
  });

  it("формат PCM из приветствия попадает в первое сообщение", async () => {
    const { upstream } = await ready({}, { audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 });

    expect(JSON.parse(upstream().sent[0] as string)).toMatchObject({ audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 });
  });

  it.each([
    ["чужой формат", { audio_format: "exe" }],
    ["странная частота", { audio_format: "pcm_s16le", sample_rate: 1, num_channels: 1 }],
    ["не объект", "[]"],
  ])("плохое приветствие (%s) — закрываем 4400, в Soniox ничего не уходит", async (_name, hello) => {
    const { client, upstream } = await connect({}, hello);
    upstream().open();

    expect(client.closedWith?.code).toBe(4400);
    expect(upstream().sent).toEqual([]);
  });

  it("звук раньше «готово» — нарушение порядка, 4400", async () => {
    const { client, connection } = await connect();

    connection.receive(new Uint8Array([1]));

    expect(client.closedWith?.code).toBe(4400);
  });
});

describe("ретранслятор голоса: сбои и завершение", () => {
  it("Soniox не соединился — браузеру 4502, причина в журнале", async () => {
    const { client, upstream, logged } = await connect();

    upstream().fail();

    expect(client.closedWith?.code).toBe(4502);
    expect(logged.join("\n")).toContain("Soniox");
  });

  it("Soniox не ответил за отведённое время — 4502 и соединение с Soniox закрыто", async () => {
    vi.useFakeTimers();
    const { client, upstream } = await connect({ upstreamConnectTimeoutMs: 5_000 });

    await vi.advanceTimersByTimeAsync(5_001);

    expect(client.closedWith?.code).toBe(4502);
    expect(upstream().closed).toBe(true);
  });

  it("Soniox закончил (finished) и закрыл — браузеру нормальное закрытие 1000", async () => {
    const { client, upstream } = await ready();
    upstream().receive({ tokens: [], finished: true });

    upstream().drop(1000);

    expect(client.closedWith?.code).toBe(1000);
  });

  it("Soniox оборвал посреди записи — 4502", async () => {
    const { client, upstream } = await ready();

    upstream().drop(1006);

    expect(client.closedWith?.code).toBe(4502);
  });

  it("браузер ушёл — соединение с Soniox закрывается", async () => {
    const { connection, upstream } = await ready();

    connection.closed();

    expect(upstream().closed).toBe(true);
  });

  it("предел записи: по истечении сервер закрывает обоих (браузеру 4408)", async () => {
    vi.useFakeTimers();
    const { client, upstream } = await ready({ maxSessionSeconds: 10 });

    await vi.advanceTimersByTimeAsync(10_001);

    expect(client.closedWith?.code).toBe(4408);
    expect(upstream().closed).toBe(true);
  });

  it("после закрытия сообщения браузера больше никуда не уходят", async () => {
    const { connection, upstream } = await ready();
    connection.closed();

    connection.receive(new Uint8Array([1]));

    expect(upstream().sent).toHaveLength(1);
  });
});

describe("ретранслятор голоса: чистка текста", () => {
  const dirty = "ну э-э привет как бы мир";
  const finalizeAndFin = (upstream: FakeUpstream, connection: RelayConnection, text = dirty) => {
    connection.receive(JSON.stringify({ type: "finalize" }));
    upstream.receive({ tokens: [{ text, is_final: true }, { text: "<fin>", is_final: true }] });
  };
  const polishWith = (clean: (text: string) => Promise<string | null>) => ({ polish: { clean } });

  it("чистка не настроена — в «готово» нет polish, после <fin> ничего лишнего", async () => {
    const { client, connection, upstream } = await ready();

    finalizeAndFin(upstream(), connection);
    await Promise.resolve();

    expect(client.messages[0]).toEqual({ ready: true, max_session_seconds: 300 });
    expect(client.messages.some((message) => "polished" in message)).toBe(false);
  });

  it("чистка настроена — «готово» сообщает polish: true", async () => {
    const { client } = await ready(polishWith(async (text) => text));

    expect(client.messages[0]).toEqual({ ready: true, max_session_seconds: 300, polish: true });
  });

  it("после <fin> сервер сам берёт закреплённый текст (клиент его не присылает), чистит и присылает polished", async () => {
    const seen: string[] = [];
    const { client, connection, upstream } = await ready(
      polishWith(async (text) => {
        seen.push(text);
        return "Привет, мир.";
      }),
    );
    upstream().receive({ tokens: [{ text: "ну э-э", is_final: true }] });

    finalizeAndFin(upstream(), connection, " привет как бы мир");
    await vi.waitFor(() => expect(client.messages.at(-1)).toEqual({ polished: { text: "Привет, мир." } }));

    expect(seen).toEqual(["ну э-э привет как бы мир"]);
    // Сначала метка <fin> (закреплено), потом чистка.
    const marks = client.messages.map((message) => ("polished" in message ? "polished" : "tokens" in message ? "tokens" : "ready"));
    expect(marks.at(-2)).toBe("tokens");
  });

  it("чистка пришла с null (сбой, тишина, подозрительный ответ) — браузеру polished: null", async () => {
    const { client, connection, upstream } = await ready(polishWith(async () => null));

    finalizeAndFin(upstream(), connection);

    await vi.waitFor(() => expect(client.messages.at(-1)).toEqual({ polished: { text: null } }));
  });

  it("сама чистка упала — тоже polished: null, соединение живо", async () => {
    const { client, connection, upstream, logged } = await ready(
      polishWith(async () => {
        throw new Error("модель упала");
      }),
    );

    finalizeAndFin(upstream(), connection);

    await vi.waitFor(() => expect(client.messages.at(-1)).toEqual({ polished: { text: null } }));
    expect(client.closedWith).toBeUndefined();
    expect(logged.join("\n")).toContain("модель упала");
  });

  it("ничего не надиктовано — модель не зовётся, сразу polished: null", async () => {
    const clean = vi.fn(async (text: string) => text);
    const { client, connection, upstream } = await ready(polishWith(clean));

    finalizeAndFin(upstream(), connection, "  ");

    await vi.waitFor(() => expect(client.messages.at(-1)).toEqual({ polished: { text: null } }));
    expect(clean).not.toHaveBeenCalled();
  });

  it("без команды finalize метка <fin> (или её подделка) чистку не запускает", async () => {
    const clean = vi.fn(async (text: string) => text);
    const { connection, upstream } = await ready(polishWith(clean));

    upstream().receive({ tokens: [{ text: dirty, is_final: true }, { text: "<fin>", is_final: true }] });
    await Promise.resolve();

    expect(clean).not.toHaveBeenCalled();
    void connection;
  });

  it("чистка идёт один раз за соединение", async () => {
    const clean = vi.fn(async (text: string) => text);
    const { client, connection, upstream } = await ready(polishWith(clean));

    finalizeAndFin(upstream(), connection);
    await vi.waitFor(() => expect(client.messages.at(-1)).toEqual({ polished: { text: dirty } }));
    finalizeAndFin(upstream(), connection);
    await Promise.resolve();

    expect(clean).toHaveBeenCalledTimes(1);
  });

  it("браузер ушёл во время чистки — ему ничего не шлём, ошибок нет", async () => {
    let finish: (text: string) => void = () => undefined;
    const { client, connection, upstream } = await ready(polishWith(() => new Promise<string>((resolve) => (finish = resolve))));
    finalizeAndFin(upstream(), connection);
    const before = client.sent.length;

    connection.closed();
    finish("Привет.");
    await Promise.resolve();

    expect(client.sent).toHaveLength(before);
  });

  it("Soniox закончил (finished), пока идёт чистка, — соединение закрывается после ответа чистки, не раньше", async () => {
    let finish: (text: string) => void = () => undefined;
    const { client, connection, upstream } = await ready(polishWith(() => new Promise<string>((resolve) => (finish = resolve))));
    finalizeAndFin(upstream(), connection);

    upstream().receive({ tokens: [], finished: true });
    upstream().drop(1000);
    expect(client.closedWith).toBeUndefined();

    finish("Привет, мир.");
    await vi.waitFor(() => expect(client.closedWith?.code).toBe(1000));
    expect(client.messages.at(-1)).toEqual({ polished: { text: "Привет, мир." } });
  });

  it("настройка провайдера Together без ключа — чистка выключена, диктовка работает, причина в журнале", async () => {
    const { client, logged } = await ready({ polish: { provider: "together", env: {} } });

    expect(client.messages[0]).toEqual({ ready: true, max_session_seconds: 300 });
    expect(logged.join("\n")).toContain("TOGETHER_API_KEY");
  });

  it("ключ модели чистки не попадает браузеру", async () => {
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Привет, мир." } }] }) }) as unknown as Response);
    const { client, connection, upstream } = await ready({ polish: { provider: "together", apiKey: "together-secret-key-42", fetch: fetchStub as unknown as typeof fetch } });

    finalizeAndFin(upstream(), connection);
    await vi.waitFor(() => expect(client.messages.at(-1)).toEqual({ polished: { text: "Привет, мир." } }));

    expect(client.sent.join("\n")).not.toContain("together-secret-key-42");
  });
});

describe("ретранслятор голоса: лимиты", () => {
  const dirty = "ну э-э привет как бы мир";
  const cleaned = "Привет, мир.";

  /** Одно соединение пользователя на общем ретрансляторе: до «готово». */
  async function open(setup: ReturnType<typeof relayWith>, userId = "anna") {
    const decision = await setup.relay.authorize(upgradeRequest());
    const client = new FakeClient();
    const connection = "user" in decision ? setup.relay.accept(client, { id: userId }) : null;
    connection?.receive(JSON.stringify({ audio_format: "auto" }));
    if (connection) setup.upstream().open();
    return { decision, client, connection: connection!, upstream: setup.upstream() };
  }

  /** Соединение говорит «стоп» и получает ответ чистки (или отказ от неё). */
  async function dictate(setup: ReturnType<typeof relayWith>, userId = "anna") {
    const session = await open(setup, userId);
    session.connection.receive(JSON.stringify({ type: "finalize" }));
    session.upstream.receive({ tokens: [{ text: dirty, is_final: true }, { text: "<fin>", is_final: true }] });
    await vi.waitFor(() => expect(session.client.messages.at(-1)).toHaveProperty("polished"));
    const answer = session.client.messages.find((message) => "polished" in message);
    session.upstream.receive({ tokens: [], finished: true });
    session.upstream.drop(1000);
    return { ...session, answer };
  }

  describe("чистка", () => {
    it("больше лимита чистки за окно модель не зовётся: браузеру polished: null, диктовка не ломается", async () => {
      const clean = vi.fn(async () => cleaned);
      const setup = relayWith({ polish: { clean }, polishRateLimit: { maxSessions: 2, perSeconds: 60 }, rateLimit: false });

      const answers = [];
      for (let index = 0; index < 3; index++) answers.push((await dictate(setup)).answer);

      expect(answers).toEqual([{ polished: { text: cleaned } }, { polished: { text: cleaned } }, { polished: { text: null } }]);
      expect(clean).toHaveBeenCalledTimes(2);
    });

    it("лимит чистки работает и при rateLimit: false, и по умолчанию (6 в минуту)", async () => {
      const clean = vi.fn(async () => cleaned);
      const setup = relayWith({ polish: { clean }, rateLimit: false });

      for (let index = 0; index < 7; index++) await dictate(setup);

      expect(clean).toHaveBeenCalledTimes(6);
    });

    it("лимит у каждого пользователя свой", async () => {
      const clean = vi.fn(async () => cleaned);
      const setup = relayWith({ polish: { clean }, polishRateLimit: { maxSessions: 1, perSeconds: 60 }, rateLimit: false });

      await dictate(setup, "anna");
      const boris = await dictate(setup, "boris");

      expect(boris.answer).toEqual({ polished: { text: cleaned } });
    });

    it("окно проходит — чистка снова работает", async () => {
      let now = 0;
      const clean = vi.fn(async () => cleaned);
      const setup = relayWith({ polish: { clean }, polishRateLimit: { maxSessions: 1, perSeconds: 60 }, rateLimit: false, now: () => now });

      await dictate(setup);
      now = 61_000;
      const later = await dictate(setup);

      expect(later.answer).toEqual({ polished: { text: cleaned } });
    });

    it("polishRateLimit: false — без ограничения", async () => {
      const clean = vi.fn(async () => cleaned);
      const setup = relayWith({ polish: { clean }, polishRateLimit: false, rateLimit: false });

      for (let index = 0; index < 8; index++) await dictate(setup);

      expect(clean).toHaveBeenCalledTimes(8);
    });

    it("ничего не надиктовано — попытка чистки в лимит не засчитывается", async () => {
      const clean = vi.fn(async () => cleaned);
      const setup = relayWith({ polish: { clean }, polishRateLimit: { maxSessions: 1, perSeconds: 60 }, rateLimit: false });
      const silent = await open(setup);
      silent.connection.receive(JSON.stringify({ type: "finalize" }));
      silent.upstream.receive({ tokens: [{ text: " ", is_final: true }, { text: "<fin>", is_final: true }] });
      await vi.waitFor(() => expect(silent.client.messages.at(-1)).toHaveProperty("polished"));
      silent.connection.closed();

      const spoken = await dictate(setup);

      expect(spoken.answer).toEqual({ polished: { text: cleaned } });
    });
  });

  describe("одновременные соединения", () => {
    it("по умолчанию у человека не больше двух: третье — 429, даже при rateLimit: false", async () => {
      const setup = relayWith({ rateLimit: false });
      await open(setup);
      await open(setup);

      const third = await setup.relay.authorize(upgradeRequest());

      expect("refusal" in third && third.refusal.status).toBe(429);
      expect("refusal" in third && third.refusal.headers.get("cache-control")).toBe("no-store");
    });

    it("закрыл браузер — место освобождается", async () => {
      const setup = relayWith({ rateLimit: false });
      const first = await open(setup);
      await open(setup);

      first.connection.closed();
      const third = await setup.relay.authorize(upgradeRequest());

      expect(third).toEqual({ user: { id: "anna" }, chatId: "voice" });
    });

    it("закончил сервер (Soniox отвалился) — место тоже освобождается, и один раз", async () => {
      const setup = relayWith({ rateLimit: false, maxConnectionsPerUser: 1 });
      const first = await open(setup);

      first.upstream.drop(1006);
      first.connection.closed();
      await open(setup);
      const again = await setup.relay.authorize(upgradeRequest());

      expect("refusal" in again && again.refusal.status).toBe(429);
    });

    it("предел настраивается, а false — без предела", async () => {
      const three = relayWith({ rateLimit: false, maxConnectionsPerUser: 3 });
      for (let index = 0; index < 3; index++) await open(three);
      const fourth = await three.relay.authorize(upgradeRequest());
      expect("refusal" in fourth && fourth.refusal.status).toBe(429);

      const free = relayWith({ rateLimit: false, maxConnectionsPerUser: false });
      for (let index = 0; index < 5; index++) await open(free);
      expect(await free.relay.authorize(upgradeRequest())).toEqual({ user: { id: "anna" }, chatId: "voice" });
    });

    it("предел у каждого человека свой", async () => {
      const setup = relayWith({ rateLimit: false, maxConnectionsPerUser: 1, resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }) });
      await open(setup, "anna");

      const boris = await setup.relay.authorize(new Request("http://app.test/api/voice/stream", { headers: { "x-user": "boris" } }));

      expect("user" in boris).toBe(true);
    });

    it("два подъёма соединения одновременно, до принятия первого: лишнее закрывается кодом 4429", async () => {
      const setup = relayWith({ rateLimit: false, maxConnectionsPerUser: 1 });
      const [first, second] = await Promise.all([setup.relay.authorize(upgradeRequest()), setup.relay.authorize(upgradeRequest())]);
      expect("user" in first && "user" in second).toBe(true);

      const firstClient = new FakeClient();
      const secondClient = new FakeClient();
      setup.relay.accept(firstClient, { id: "anna" });
      setup.relay.accept(secondClient, { id: "anna" });

      expect(firstClient.closedWith).toBeUndefined();
      expect(secondClient.closedWith).toEqual({ code: 4429 });
    });
  });
});

export type { RelayConnection };
