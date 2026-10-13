import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, speechChunk } from "./support/fake-socket";
import { KEY, streamWith } from "./support/speech-harness";

beforeEach(() => {
  FakeSocket.instances = [];
});

afterEach(() => vi.useRealTimers());

describe("озвучка: соединение с ElevenLabs", () => {
  it("открывается по адресу WebSocket диалога с моделью, форматом, метками и языком; ключ — в заголовке", () => {
    const { socket } = streamWith();
    const url = new URL(socket.url);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: "eleven_v4_turbo",
      output_format: "pcm_24000",
      sync_alignment: "true",
      language_code: "ru",
    });
    expect(socket.headers["xi-api-key"]).toBe(KEY);
    expect(socket.url).not.toContain(KEY);
  });

  it("eleven_v4 выбирается настройкой", () => {
    const { socket } = streamWith({ model: "eleven_v4" });
    expect(new URL(socket.url).searchParams.get("model_id")).toBe("eleven_v4");
  });

  it("baseUrl (прокси) заменяет адрес, заголовки прокси добавляются, http превращается в ws", () => {
    const { socket } = streamWith({ baseUrl: "https://proxy.test/eleven", headers: { "X-Proxy-Token": "t" } });
    expect(socket.url.startsWith("wss://proxy.test/eleven/v1/text-to-dialogue/stream-input?")).toBe(true);
    expect(socket.headers["X-Proxy-Token"]).toBe("t");
    expect(socket.headers["xi-api-key"]).toBe(KEY);
  });

  it("prepare: после открытия уходит только список голосов, текста ещё нет", () => {
    const { socket } = streamWith();
    socket.open();
    expect(socket.messages).toEqual([{ voices: ["voice-1"] }]);
  });

  it("текст, пришедший до открытия соединения, ждёт и уходит после списка голосов", () => {
    const { stream, socket } = streamWith();
    stream.speak("Привет.");
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.messages.map((message) => Object.keys(message)[0])).toEqual(["voices", "inputs"]);
  });
});

describe("озвучка: предложения", () => {
  it("первое предложение уходит с flush, следующие — без", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("Первое предложение.");
    stream.speak("Второе предложение.");
    const [, first, second] = socket.messages;
    expect(first).toMatchObject({ inputs: [{ voice_id: "voice-1" }], flush: true });
    expect(second).toMatchObject({ inputs: [{ voice_id: "voice-1" }] });
    expect(second).not.toHaveProperty("flush");
  });

  it("предложения не склеиваются: каждое заканчивается пробелом; счёт знаков — по реально отправленному", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("Привет.");
    stream.speak("Как дела?");
    const texts = socket.messages.flatMap((message) => (message.inputs as Array<{ text: string }> | undefined)?.map((input) => input.text) ?? []);
    expect(texts.every((text) => text.endsWith(" "))).toBe(true);
    expect(stream.sentChars).toBe(texts.join("").length);
  });

  it("пустое и из одних пробелов предложение не отправляется", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("   ");
    expect(socket.messages).toHaveLength(1);
    expect(stream.sentChars).toBe(0);
  });

  it("текст из одних тегов не отправляется: ElevenLabs отвергает его (input_text_empty, 1008) и обрывает всю реплику", () => {
    const { stream, socket, log } = streamWith();
    socket.open();
    stream.speak("[sighs]");
    stream.speak("  [laughs] [whispers]  ");
    stream.speak("[warm, quiet voice].");
    expect(socket.messages).toEqual([{ voices: ["voice-1"] }]);
    expect(stream.sentChars).toBe(0);
    expect(log).toEqual({ done: 0, failed: 0 });
  });

  it("тег одиночкой до открытия соединения тоже не уходит, а следующее предложение уходит с flush как первое", () => {
    const { stream, socket } = streamWith();
    stream.speak("[sighs]");
    stream.speak("[sighs] Ладно.");
    socket.open();
    const inputs = socket.messages.filter((message) => "inputs" in message);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ inputs: [{ text: "[sighs] Ладно. " }], flush: true });
  });

  it("тег со словами уходит как есть и считается знаками (оплата и позиция обрыва идут по отправленному)", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("[laughs] Привет.");
    expect(socket.messages[1]).toMatchObject({ inputs: [{ text: "[laughs] Привет. " }] });
    expect(stream.sentChars).toBe("[laughs] Привет. ".length);
  });

  it("цифры и слова рядом с тегом — это текст: «[sighs] 5» уходит", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("[sighs] 5");
    expect(socket.messages).toHaveLength(2);
  });

  it("end_reply: {close_socket: true} после последнего текста, даже если соединение ещё открывается", () => {
    const { stream, socket } = streamWith();
    stream.speak("Привет.");
    stream.finish();
    socket.open();
    expect(socket.messages.map((message) => Object.keys(message)[0])).toEqual(["voices", "inputs", "close_socket"]);
  });
});

describe("озвучка: звук", () => {
  it("куски звука отдаются как есть, по порядку", () => {
    const { stream, socket, audio } = streamWith();
    socket.open();
    stream.speak("Привет.");
    socket.receive(speechChunk("Привет.", 500));
    socket.receive(speechChunk(" ", 100));
    expect(audio.map((chunk) => chunk.length)).toEqual([24_000, 4_800]);
    expect([...audio[0]!.subarray(0, 3)]).toEqual([1, 1, 1]);
  });

  it("закрытие после последнего звука: is_final → onDone один раз, соединение закрыто нами", () => {
    const { stream, socket, log } = streamWith();
    socket.open();
    stream.speak("Привет.");
    stream.finish();
    socket.receive(speechChunk("Привет.", 500));
    expect(log.done).toBe(0);
    socket.receive({ is_final: true });
    expect(log.done).toBe(1);
    expect(socket.closed).toBe(true);
    socket.drop(1000);
    expect(log).toEqual({ done: 1, failed: 0 });
  });

  it("соединение закрыто сервером после нашего close_socket без is_final — тоже конец реплики", () => {
    const { stream, socket, log } = streamWith();
    socket.open();
    stream.speak("Привет.");
    stream.finish();
    socket.drop(1000);
    expect(log).toEqual({ done: 1, failed: 0 });
  });
});

describe("озвучка: отказы", () => {
  it("соединение не открылось (ошибка) — onFailed один раз", () => {
    const { socket, log } = streamWith();
    socket.fail();
    expect(log).toEqual({ done: 0, failed: 1 });
  });

  it("обрыв посреди реплики — onFailed; после этого текст и звук игнорируются", () => {
    const { stream, socket, log, audio } = streamWith();
    socket.open();
    stream.speak("Привет.");
    socket.drop(1006);
    expect(log.failed).toBe(1);
    stream.speak("Ещё.");
    socket.receive(speechChunk("Привет.", 500));
    expect(audio).toHaveLength(0);
    expect(log.failed).toBe(1);
  });

  it("сообщение об ошибке от ElevenLabs — onFailed, ключ и текст ошибки в журнал без ключа", () => {
    const { stream, socket, log, logged } = streamWith();
    socket.open();
    stream.speak("Привет.");
    socket.receive({ error: `bad request for ${KEY}` });
    expect(log.failed).toBe(1);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain(KEY);
  });

  it("не открылось за отведённое время — onFailed", () => {
    vi.useFakeTimers();
    const { log, socket } = streamWith({ connectTimeoutMs: 3_000 });
    vi.advanceTimersByTime(2_999);
    expect(log.failed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(log.failed).toBe(1);
    expect(socket.closed).toBe(true);
  });

  it("открылось вовремя — таймер отказа не срабатывает", () => {
    vi.useFakeTimers();
    const { log, socket } = streamWith({ connectTimeoutMs: 3_000 });
    socket.open();
    vi.advanceTimersByTime(10_000);
    expect(log.failed).toBe(0);
  });
});
