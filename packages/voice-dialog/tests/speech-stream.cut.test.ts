import { describe, expect, it } from "vitest";
import { speechChunk } from "./support/fake-socket";
import { streamWith } from "./support/speech-harness";

/** Два куска: «Привет, мир. » (13 знаков, 1300 мс) и «Как дела? » (10 знаков, 1000 мс); знак — по 100 мс. */
function withTwoChunks() {
  const setup = streamWith();
  setup.socket.open();
  setup.stream.speak("Привет, мир.");
  setup.stream.speak("Как дела?");
  setup.socket.receive(speechChunk("Привет, мир. ", 1300, 100));
  setup.socket.receive(speechChunk("Как дела? ", 1000, 100));
  return setup;
}

describe("озвучка: обрыв по проигранному времени", () => {
  it("позиция — последний знак, начавшийся раньше playedMs; время второго куска сдвигается на длину первого", () => {
    const { stream } = withTwoChunks();
    expect(stream.positionAt(1350)).toEqual({ spokenChars: 14, spokenTail: "Привет, мир. К" });
  });

  it("знак, начинающийся ровно в playedMs, ещё не озвучен", () => {
    const { stream } = withTwoChunks();
    expect(stream.positionAt(1300).spokenChars).toBe(13);
    expect(stream.positionAt(1301).spokenChars).toBe(14);
  });

  it("до первого знака — ничего; после последнего — всё, что пришло по alignment", () => {
    const { stream } = withTwoChunks();
    expect(stream.positionAt(0)).toEqual({ spokenChars: 0, spokenTail: "" });
    expect(stream.positionAt(60_000).spokenChars).toBe(23);
  });

  it("хвост — последние ≈ 60 озвученных знаков", () => {
    const { stream, socket } = streamWith();
    socket.open();
    const long = "слово ".repeat(30);
    stream.speak(long);
    socket.receive(speechChunk(long, 9000, 50));
    const { spokenChars, spokenTail } = stream.positionAt(60_000);
    expect(spokenChars).toBe(long.length);
    expect(spokenTail.length).toBeLessThanOrEqual(60);
    expect(long.trim().endsWith(spokenTail)).toBe(true);
  });

  it("cut: соединение закрывается сразу, вернулась позиция; дальнейший звук и события игнорируются", () => {
    const { stream, socket, audio, log } = withTwoChunks();
    const before = audio.length;
    const position = stream.cut(1350);
    expect(socket.closed).toBe(true);
    expect(position).toEqual({ spokenChars: 14, spokenTail: "Привет, мир. К" });
    socket.receive(speechChunk("Ещё.", 300));
    socket.receive({ is_final: true });
    socket.drop(1006);
    expect(audio).toHaveLength(before);
    expect(log).toEqual({ done: 0, failed: 0 });
  });

  it("cut до открытия соединения: закрывается, текста не было", () => {
    const { stream, socket } = streamWith();
    expect(stream.cut(0)).toEqual({ spokenChars: 0, spokenTail: "" });
    expect(socket.closed).toBe(true);
    expect(stream.sentChars).toBe(0);
  });

  it("после cut позиция по-прежнему считается (перебивание пришло, когда сервер уже закончил)", () => {
    const { stream } = withTwoChunks();
    stream.cut(500);
    expect(stream.positionAt(1350).spokenChars).toBe(14);
  });

  it("счёт отправленных знаков не меняется от обрыва: он остаётся тем, что реально ушло в ElevenLabs", () => {
    const { stream } = withTwoChunks();
    const sent = stream.sentChars;
    stream.cut(100);
    stream.speak("Это уже не уйдёт.");
    expect(stream.sentChars).toBe(sent);
  });
});

describe("озвучка: теги голоса при обрыве", () => {
  function withTags() {
    const setup = streamWith();
    setup.socket.open();
    setup.stream.speak("[laughs] Привет, мир.");
    setup.socket.receive(speechChunk("[laughs] Привет, мир. ", 2200, 100));
    return setup;
  }

  it("знаки тегов входят в счёт озвученного: позиция в тексте ответа считается по ним", () => {
    const { stream } = withTags();
    expect(stream.positionAt(60_000).spokenChars).toBe("[laughs] Привет, мир. ".length);
    expect(stream.positionAt(1050).spokenChars).toBe(11);
  });

  it("в хвосте для экрана тегов нет", () => {
    const { stream } = withTags();
    expect(stream.positionAt(60_000).spokenTail).toBe("Привет, мир.");
    expect(stream.positionAt(1050).spokenTail).toBe("Пр");
  });

  it("обрыв посреди тега: недописанный тег в хвост не попадает", () => {
    const { stream } = withTags();
    expect(stream.positionAt(350)).toEqual({ spokenChars: 4, spokenTail: "" });
    expect(stream.positionAt(550).spokenTail).toBe("");
  });

  it("хвост в 60 знаков не начинается обрывком тега из середины", () => {
    const { stream, socket } = streamWith();
    socket.open();
    const text = `Начало. [laughs harder] ${"слово ".repeat(9)}`;
    stream.speak(text);
    socket.receive(speechChunk(text, 9000, 50));
    const { spokenTail } = stream.positionAt(60_000);
    expect(spokenTail).not.toMatch(/[\[\]]|laughs|harder/);
    expect(spokenTail.length).toBeLessThanOrEqual(60);
  });
});
