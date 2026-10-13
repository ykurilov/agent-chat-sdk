import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { bytesFor, speechChunk } from "./support/fake-socket";
import { ELEVEN_KEY, sessionWith } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Сессия, в которой агент начал реплику: соединение с ElevenLabs открыто. */
async function replying(overrides: Parameters<typeof sessionWith>[0] = {}) {
  const setup = sessionWith(overrides);
  setup.begin();
  await setup.command({ type: "prepare", replyId: 7 });
  const socket = setup.speech()[0]!;
  socket.open();
  return { ...setup, socket };
}

const usageSums = (setup: { storage: ChatStorage }) => setup.storage.sumUsage({});
const sentTexts = (socket: { messages: Array<Record<string, unknown>> }) =>
  socket.messages.flatMap((message) => (message.inputs as Array<{ text: string }> | undefined)?.map((input) => input.text) ?? []);

describe("реплика: prepare и озвучка", () => {
  it("prepare открывает соединение с ElevenLabs до первого текста: ключ в заголовке, голос из сессии", async () => {
    const setup = sessionWith();
    setup.begin();
    await setup.command({ type: "prepare", replyId: 7 });
    expect(setup.speech()).toHaveLength(1);
    expect(setup.speech()[0]!.headers["xi-api-key"]).toBe(ELEVEN_KEY);
    setup.speech()[0]!.open();
    expect(setup.speech()[0]!.messages).toEqual([{ voices: ["voice-1"] }]);
  });

  it("звук уходит кадрами [replyId][PCM]; перед первым кадром — speech_started с меткой времени сервера, один раз", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const { socket, ...setup } = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет." });
    socket.receive(speechChunk("Привет. ", 800));
    socket.receive(speechChunk("Ещё. ", 300));
    expect(setup.of("speech_started")).toEqual([{ type: "speech_started", replyId: 7, serverTimeMs: 1_700_000_000_000 }]);
    expect(setup.frames.map((frame) => [frame.replyId, frame.audio.length])).toEqual([
      [7, bytesFor(800)],
      [7, bytesFor(300)],
    ]);
  });

  it("speak без prepare тоже открывает озвучку", async () => {
    const setup = sessionWith();
    setup.begin();
    await setup.command({ type: "speak", replyId: 3, text: "Привет." });
    expect(setup.speech()).toHaveLength(1);
    setup.speech()[0]!.open();
    expect(setup.speech()[0]!.messages.map((message) => Object.keys(message)[0])).toEqual(["voices", "inputs"]);
  });

  it("end_reply: озвучка закрывается после последнего звука; speech_done с числом знаков; расход записан", async () => {
    const { socket, ...setup } = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет.", messageId: "m-1" });
    await setup.command({ type: "end_reply", replyId: 7 });
    expect(socket.messages.at(-1)).toEqual({ close_socket: true });
    expect(setup.of("speech_done")).toHaveLength(0);
    socket.receive(speechChunk("Привет. ", 800));
    socket.receive({ is_final: true });
    expect(setup.of("speech_done")).toEqual([{ type: "speech_done", replyId: 7, spokenChars: sentTexts(socket).join("").length }]);
    expect(socket.closed).toBe(true);
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
    expect((await usageSums(setup))[0]!.inputTokens).toBe(sentTexts(socket).join("").length);
  });

  it("новая реплика закрывает прежнюю, не дошедшую до конца: расход прежней записан по отправленному", async () => {
    const { socket, ...setup } = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Долго рассказываю." });
    await setup.command({ type: "prepare", replyId: 8 });
    expect(socket.closed).toBe(true);
    expect(setup.speech()).toHaveLength(2);
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
  });

  it("сообщение и звук чужой (уже закрытой) реплики не доходят до клиента", async () => {
    const { socket, ...setup } = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет." });
    await setup.command({ type: "prepare", replyId: 8 });
    const before = setup.frames.length;
    socket.receive(speechChunk("Привет. ", 800));
    expect(setup.frames).toHaveLength(before);
  });

  it("смена голоса действует со следующей реплики", async () => {
    const { socket, ...setup } = await replying();
    await setup.command({ type: "voice", voiceId: "voice-2" });
    expect(socket.messages[0]).toEqual({ voices: ["voice-1"] });
    await setup.command({ type: "prepare", replyId: 8 });
    setup.speech()[1]!.open();
    expect(setup.speech()[1]!.messages[0]).toEqual({ voices: ["voice-2"] });
  });

  it("озвучка на сервере недоступна: prepare — speech_failed(unavailable), соединений нет, режим слушает", async () => {
    const setup = sessionWith({ speech: null });
    setup.begin();
    await setup.command({ type: "prepare", replyId: 1 });
    await setup.command({ type: "speak", replyId: 1, text: "Привет." });
    expect(setup.of("speech_failed")).toEqual([{ type: "speech_failed", replyId: 1, kind: "unavailable" }]);
    expect(setup.speech()).toHaveLength(0);
    expect(setup.closes).toEqual([]);
  });
});

describe("реплика: перебивание", () => {
  async function playing() {
    const setup = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет, мир." });
    await setup.command({ type: "speak", replyId: 7, text: "Как дела?" });
    setup.socket.receive(speechChunk("Привет, мир. ", 1300, 100));
    setup.socket.receive(speechChunk("Как дела? ", 1000, 100));
    return setup;
  }

  it("interrupt: озвучка закрывается сразу, speech_cut с озвученными знаками и хвостом", async () => {
    const setup = await playing();
    await setup.command({ type: "interrupt", replyId: 7, playedMs: 1350 });
    expect(setup.socket.closed).toBe(true);
    expect(setup.of("speech_cut")).toEqual([{ type: "speech_cut", replyId: 7, spokenChars: 14, spokenTail: "Привет, мир. К" }]);
    expect(setup.of("speech_done")).toHaveLength(0);
  });

  it("расход пишется по знакам, реально отправленным в ElevenLabs (не по озвученным), один раз", async () => {
    const setup = await playing();
    await setup.command({ type: "interrupt", replyId: 7, playedMs: 1350 });
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
    expect((await usageSums(setup))[0]!.inputTokens).toBe(sentTexts(setup.socket).join("").length);
    setup.session.close();
    await Promise.resolve();
    expect(await usageSums(setup)).toHaveLength(1);
    expect((await usageSums(setup))[0]!.inputTokens).toBe(sentTexts(setup.socket).join("").length);
  });

  it("interrupt после того, как сервер уже закончил реплику: позиция считается, расход не удваивается", async () => {
    const setup = await playing();
    await setup.command({ type: "end_reply", replyId: 7 });
    setup.socket.receive({ is_final: true });
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
    await setup.command({ type: "interrupt", replyId: 7, playedMs: 1350 });
    expect(setup.of("speech_cut")).toEqual([{ type: "speech_cut", replyId: 7, spokenChars: 14, spokenTail: "Привет, мир. К" }]);
    await Promise.resolve();
    expect(await usageSums(setup)).toHaveLength(1);
  });

  it("interrupt чужой реплики или до звука: speech_cut с нулём, ничего не падает", async () => {
    const setup = sessionWith();
    setup.begin();
    await setup.command({ type: "interrupt", replyId: 99, playedMs: 500 });
    expect(setup.of("speech_cut")).toEqual([{ type: "speech_cut", replyId: 99, spokenChars: 0, spokenTail: "" }]);
  });

  it("закрытие режима посреди реплики записывает расход по отправленному", async () => {
    const setup = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет, мир." });
    setup.session.close();
    expect(setup.socket.closed).toBe(true);
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
  });

  it("два перебивания подряд: второе не ломает и не задваивает", async () => {
    const setup = await playing();
    await setup.command({ type: "interrupt", replyId: 7, playedMs: 1350 });
    await setup.command({ type: "interrupt", replyId: 7, playedMs: 1350 });
    expect(setup.of("speech_cut")).toHaveLength(2);
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
  });
});

describe("реплика: отказ ElevenLabs", () => {
  it("соединение оборвалось: speech_failed(unavailable), режим слушает дальше, расход — за отправленное", async () => {
    const setup = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет." });
    setup.socket.drop(1006);
    expect(setup.of("speech_failed")).toEqual([{ type: "speech_failed", replyId: 7, kind: "unavailable" }]);
    expect(setup.closes).toEqual([]);
    await vi.waitFor(async () => expect(await usageSums(setup)).toHaveLength(1));
    setup.soniox().receive({ tokens: [{ text: "Да", is_final: true }, { text: "<end>", is_final: true }] });
    expect(setup.of("phrase_end")).toHaveLength(1);
  });

  it("ключ и текст ошибки ElevenLabs не попадают ни клиенту, ни в журнал", async () => {
    const setup = await replying();
    await setup.command({ type: "speak", replyId: 7, text: "Привет." });
    setup.socket.receive({ error: `invalid key ${ELEVEN_KEY}` });
    expect(JSON.stringify(setup.sent)).not.toContain(ELEVEN_KEY);
    for (const line of setup.logged) expect(line).not.toContain(ELEVEN_KEY);
    expect(setup.of("speech_failed")).toHaveLength(1);
  });

  it("после отказа реплики текст и end_reply не порождают новых сообщений", async () => {
    const setup = await replying();
    setup.socket.drop(1006);
    const count = setup.sent.length;
    await setup.command({ type: "speak", replyId: 7, text: "Ещё." });
    await setup.command({ type: "end_reply", replyId: 7 });
    expect(setup.sent).toHaveLength(count);
  });
});

describe("реплика: потолки знаков", () => {
  it("выше потолка на реплику: speech_failed(cap), лишний текст не уходит, уже отправленное дозвучивается", async () => {
    const setup = await replying({ maxCharsPerReply: 30 });
    await setup.command({ type: "speak", replyId: 7, text: "Это первое предложение." });
    await setup.command({ type: "speak", replyId: 7, text: "Это второе предложение, оно уже лишнее." });
    await setup.command({ type: "speak", replyId: 7, text: "И третье." });
    expect(setup.of("speech_failed")).toEqual([{ type: "speech_failed", replyId: 7, kind: "cap" }]);
    expect(sentTexts(setup.socket)).toEqual(["Это первое предложение. "]);
    await setup.command({ type: "end_reply", replyId: 7 });
    expect(setup.socket.messages.at(-1)).toEqual({ close_socket: true });
  });

  it("выше потолка на минуту: speech_failed(cap); через минуту снова можно", async () => {
    const setup = await replying({ maxCharsPerMinute: 50 });
    await setup.command({ type: "speak", replyId: 7, text: "Первое предложение на двадцать девять." });
    await setup.command({ type: "end_reply", replyId: 7 });
    setup.socket.receive({ is_final: true });

    await setup.command({ type: "prepare", replyId: 8 });
    const second = setup.speech()[1]!;
    second.open();
    await setup.command({ type: "speak", replyId: 8, text: "Второе предложение, которое не влезает." });
    expect(setup.of("speech_failed")).toEqual([{ type: "speech_failed", replyId: 8, kind: "cap" }]);
    expect(sentTexts(second)).toEqual([]);

    vi.advanceTimersByTime(61_000);
    await setup.command({ type: "prepare", replyId: 9 });
    const third = setup.speech()[2]!;
    third.open();
    await setup.command({ type: "speak", replyId: 9, text: "Третье предложение." });
    expect(sentTexts(third)).toHaveLength(1);
  });
});
