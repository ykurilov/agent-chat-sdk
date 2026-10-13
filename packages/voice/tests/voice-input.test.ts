import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceInput } from "../src/index";
import { createHarness, fakeResponse, FakeMediaRecorder, FakeWebSocket, sessionResponse, settle } from "./support/fakes";
import type { Harness } from "./support/fakes";

afterEach(() => vi.useRealTimers());

/** Диктовка доведена до идущей записи: микрофон открыт, ключ получен, сокет открыт. */
async function startListening(harness: Harness) {
  const session = createVoiceInput(harness.options).start(harness.listener);
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  harness.socket().open();
  await settle();
  return session;
}

const decoded = async (sent: string | ArrayBuffer | Blob) => (typeof sent === "string" ? sent : Array.from(new Uint8Array(await new Blob([sent]).arrayBuffer())));

describe("диктовка: путь от микрофона до текста", () => {
  it("микрофон → ключ у сервера приложения → сокет → первое сообщение → куски записи", async () => {
    const harness = createHarness();
    const order: string[] = [];
    harness.getUserMedia.mockImplementation(async () => {
      order.push("microphone");
      return harness.stream;
    });
    harness.fetch.mockImplementation(async () => {
      order.push("session");
      return fakeResponse(sessionResponse);
    });

    await startListening(harness);

    expect(order).toEqual(["microphone", "session"]);
    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true });
    const [url, init] = harness.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice/session");
    expect(init.method).toBe("POST");
    expect(harness.socket().url).toBe("wss://stt.test/transcribe");
    expect(JSON.parse(harness.socket().sent[0] as string)).toEqual({
      api_key: "temp:1",
      model: "stt-rt-v5",
      audio_format: "auto",
      language_hints: ["ru"],
      enable_endpoint_detection: true,
    });
    expect(harness.recorder().startedWithChunkMs).toBe(120);
    expect(harness.events).toEqual(["connected"]);

    harness.recorder().produceChunk(1, 2);
    harness.recorder().produceChunk(3);
    await settle();
    expect(await Promise.all(harness.socket().sent.slice(1).map(decoded))).toEqual([[1, 2], [3]]);
  });

  it("слова идут наружу по ходу речи: накопленный текст целиком", async () => {
    const harness = createHarness();
    await startListening(harness);

    harness.socket().receive({ tokens: [{ text: "При", is_final: false }] });
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });

    expect(harness.texts).toEqual([
      { finalText: "", interimText: "При" },
      { finalText: "Привет", interimText: " ми" },
    ]);
  });

  it("остановка: запись закончена, микрофон свободен, Soniox получил команду «закрепи всё», дождались метки <fin>, сокет закрыт", async () => {
    const harness = createHarness();
    const session = await startListening(harness);
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });

    session.stop();
    await settle();

    expect(harness.recorder().state).toBe("inactive");
    expect(harness.stream.released).toBe(true);
    // последний кусок записи ушёл раньше команды «закрепи всё»
    expect(await Promise.all(harness.socket().sent.slice(1).map(decoded))).toEqual([[9, 9], JSON.stringify({ type: "finalize" })]);
    expect(harness.events.at(-1)).not.toBe("end");

    harness.socket().receive({ tokens: [{ text: " мир", is_final: true }, { text: "<fin>", is_final: true }] });
    await settle();

    expect(harness.events.slice(-2)).toEqual(["text:Привет мир|", "end"]);
    expect(harness.socket().closedByClient).toBe(true);
    expect(harness.events.filter((event) => event === "end")).toHaveLength(1);
  });

  it("остановка: пока метка <fin> не пришла, слова, которые Soniox закрепляет, доходят до поля", async () => {
    const harness = createHarness();
    const session = await startListening(harness);
    session.stop();
    await settle();

    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });
    await settle();
    expect(harness.events.at(-1)).toBe("text:Привет| ми");

    harness.socket().receive({ tokens: [{ text: ", мир", is_final: true }, { text: "<fin>", is_final: true }] });
    await settle();
    expect(harness.events.slice(-2)).toEqual(["text:Привет, мир|", "end"]);
  });

  it("остановка: метка конца фразы <end> не считается ответом на «закрепи всё»", async () => {
    const harness = createHarness();
    const session = await startListening(harness);
    session.stop();
    await settle();

    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<end>", is_final: true }] });
    await settle();

    expect(harness.events).not.toContain("end");
  });

  it("остановка: команда «закрепи всё» уходит один раз", async () => {
    const harness = createHarness();
    const session = await startListening(harness);

    session.stop();
    session.stop();
    await settle();

    const finalizations = (await Promise.all(harness.socket().sent.map(decoded))).filter((item) => item === JSON.stringify({ type: "finalize" }));
    expect(finalizations).toHaveLength(1);
  });

  it("остановка: Soniox сам закончил поток (finished) — это тоже конец", async () => {
    const harness = createHarness();
    const session = await startListening(harness);
    session.stop();
    await settle();

    harness.socket().receive({ tokens: [{ text: "Всё", is_final: true }], finished: true });
    await settle();

    expect(harness.events.slice(-2)).toEqual(["text:Всё|", "end"]);
  });

  it("остановка: метка <fin> не пришла за 3 секунды — заканчиваем без неё, промежуточный текст становится окончательным", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const session = createVoiceInput(harness.options).start(harness.listener);
    await vi.advanceTimersByTimeAsync(0);
    harness.socket().open();
    await vi.advanceTimersByTimeAsync(0);
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });

    session.stop();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(harness.events).not.toContain("end");
    await vi.advanceTimersByTimeAsync(2);

    expect(harness.events.slice(-2)).toEqual(["text:Привет ми|", "end"]);
    expect(harness.socket().closedByClient).toBe(true);
  });

  it("остановка: срок ожидания метки <fin> настраивается (stopTimeoutMs)", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const session = createVoiceInput({ ...harness.options, stopTimeoutMs: 500 }).start(harness.listener);
    await vi.advanceTimersByTimeAsync(0);
    harness.socket().open();
    await vi.advanceTimersByTimeAsync(0);

    session.stop();
    await vi.advanceTimersByTimeAsync(501);

    expect(harness.events.at(-1)).toBe("end");
  });

  it("остановка: сокет закрылся сам после конца звука — это обычное завершение", async () => {
    const harness = createHarness();
    const session = await startListening(harness);

    session.stop();
    await settle();
    harness.socket().dropConnection(1000);
    await settle();

    expect(harness.events).toEqual(["connected", "end"]);
  });

  it("отмена: всё освобождено сразу, слушатель больше не зовётся", async () => {
    const harness = createHarness();
    const session = await startListening(harness);
    const before = harness.events.length;

    session.cancel();
    harness.socket().receive({ tokens: [{ text: "поздно", is_final: true }] });
    await settle();

    expect(harness.stream.released).toBe(true);
    expect(harness.recorder().state).toBe("inactive");
    expect(harness.socket().closedByClient).toBe(true);
    expect(harness.events).toHaveLength(before);
  });

  it("сокет закрыт сервером с кодом 1000 посреди записи (лимит длины) — обычный конец без ошибки, текст остаётся", async () => {
    const harness = createHarness();
    await startListening(harness);
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }] });

    harness.socket().dropConnection(1000);
    await settle();

    expect(harness.events.slice(-2)).toEqual(["text:Привет|", "end"]);
    expect(harness.stream.released).toBe(true);
  });
});

describe("диктовка: отмена в любой момент подготовки", () => {
  it("пока браузер спрашивает разрешение: дорожки освобождаются, ключ не запрашивается", async () => {
    let grant!: (stream: unknown) => void;
    const harness = createHarness({ getUserMedia: () => new Promise((resolve) => (grant = resolve)) });
    const session = createVoiceInput(harness.options).start(harness.listener);

    session.cancel();
    grant(harness.stream);
    await settle();

    expect(harness.stream.released).toBe(true);
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
  });

  it("пока идёт запрос ключа: микрофон освобождён, сокет не создаётся", async () => {
    let answer!: (response: Response) => void;
    const harness = createHarness({ fetch: () => new Promise((resolve) => (answer = resolve)) });
    const session = createVoiceInput(harness.options).start(harness.listener);
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalled());

    session.cancel();
    answer(fakeResponse(sessionResponse));
    await settle();

    expect(harness.stream.released).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(harness.events).toEqual([]);
  });

  it("остановка до готовности записи — тихое завершение с onEnd, микрофон освобождён", async () => {
    const harness = createHarness();
    const session = createVoiceInput(harness.options).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    session.stop();
    await settle();

    expect(harness.stream.released).toBe(true);
    expect(harness.socket().closedByClient).toBe(true);
    expect(harness.events).toEqual(["end"]);
  });

  it("пока сокет подключается: отмена закрывает его", async () => {
    const harness = createHarness();
    const session = createVoiceInput(harness.options).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    session.cancel();
    harness.socket().open();
    await settle();

    expect(harness.socket().closedByClient).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(harness.stream.released).toBe(true);
  });
});

describe("диктовка: ошибки", () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it("браузер отказал в микрофоне: permission_denied, ключ не запрашивался", async () => {
    const harness = createHarness({ getUserMedia: async () => Promise.reject(named("NotAllowedError")) });

    createVoiceInput(harness.options).start(harness.listener);
    await settle();

    expect(harness.events).toEqual(["error:permission_denied", "end"]);
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("микрофона нет: no_microphone", async () => {
    const harness = createHarness({ getUserMedia: async () => Promise.reject(named("NotFoundError")) });

    createVoiceInput(harness.options).start(harness.listener);
    await settle();

    expect(harness.events).toEqual(["error:no_microphone", "end"]);
  });

  it("браузер не умеет записывать (нет getUserMedia или MediaRecorder): unsupported", async () => {
    const noDevices = createHarness();
    createVoiceInput({ ...noDevices.options, mediaDevices: undefined }).start(noDevices.listener);
    await settle();
    expect(noDevices.events).toEqual(["error:unsupported", "end"]);

    const noRecorder = createHarness();
    createVoiceInput({ ...noRecorder.options, MediaRecorder: undefined }).start(noRecorder.listener);
    await settle();
    expect(noRecorder.events).toEqual(["error:unsupported", "end"]);
    expect(noRecorder.getUserMedia).not.toHaveBeenCalled();
  });

  it("сеть до сервера приложения упала: network, микрофон освобождён", async () => {
    const harness = createHarness({ fetch: async () => Promise.reject(new TypeError("Failed to fetch")) });

    createVoiceInput(harness.options).start(harness.listener);
    await settle();

    expect(harness.events).toEqual(["error:network", "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it.each([401, 403, 502, 503, 500])("сервер приложения ответил %s: service_unavailable, микрофон освобождён", async (status) => {
    const harness = createHarness({ fetch: async () => fakeResponse({ error: { kind: "service_unavailable" } }, status) });

    createVoiceInput(harness.options).start(harness.listener);
    await settle();

    expect(harness.events).toEqual(["error:service_unavailable", "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it("сервер приложения вернул неожиданное тело: service_unavailable", async () => {
    const harness = createHarness({ fetch: async () => fakeResponse({ hello: 1 }) });

    createVoiceInput(harness.options).start(harness.listener);
    await settle();

    expect(harness.events).toEqual(["error:service_unavailable", "end"]);
  });

  it("сокет не подключился: network, всё освобождено", async () => {
    const harness = createHarness();
    createVoiceInput(harness.options).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    harness.socket().failToConnect();
    await settle();

    expect(harness.events).toEqual(["error:network", "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it("соединение оборвалось посреди диктовки: network, распознанное уже в поле, всё освобождено", async () => {
    const harness = createHarness();
    await startListening(harness);
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }] });

    harness.socket().dropConnection(1006);
    await settle();

    expect(harness.events.slice(-3)).toEqual(["text:Привет|", "error:network", "end"]);
    expect(harness.stream.released).toBe(true);
    expect(harness.recorder().state).toBe("inactive");
  });

  it("Soniox прислал ошибку: service_unavailable, запись остановлена, сокет закрыт", async () => {
    const harness = createHarness();
    await startListening(harness);

    harness.socket().receive({ error_code: 402, error_message: "Balance exhausted" });
    await settle();

    expect(harness.events).toEqual(["connected", "error:service_unavailable", "end"]);
    expect(harness.stream.released).toBe(true);
    expect(harness.socket().closedByClient).toBe(true);
  });

  it("запись сломалась: other, всё освобождено", async () => {
    const harness = createHarness();
    await startListening(harness);

    harness.recorder().fail();
    await settle();

    expect(harness.events).toEqual(["connected", "error:other", "end"]);
    expect(harness.stream.released).toBe(true);
    expect(harness.socket().closedByClient).toBe(true);
  });

  it("после ошибки слушатель больше не зовётся", async () => {
    const harness = createHarness();
    await startListening(harness);
    harness.socket().receive({ error_code: 500, error_message: "boom" });
    await settle();
    const before = harness.events.length;

    harness.socket().receive({ tokens: [{ text: "эхо", is_final: true }] });
    harness.socket().dropConnection(1006);
    await settle();

    expect(harness.events).toHaveLength(before);
  });
});
