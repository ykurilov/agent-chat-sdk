import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, speechChunk } from "./support/fake-socket";
import { streamWith } from "./support/speech-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** ElevenLabs закрывает соединение после 20 с без входящих сообщений; `keep_alive` сбрасывает этот срок. */
const keepAlives = (socket: FakeSocket) => socket.messages.filter((message) => message.keep_alive === true);

describe("озвучка: соединение не засыпает в паузах (keep_alive)", () => {
  it("до открытия соединения keep_alive не шлётся", () => {
    const { socket } = streamWith();
    vi.advanceTimersByTime(9_000);
    expect(keepAlives(socket)).toHaveLength(0);
  });

  it("долгая пауза посреди реплики (вызов инструмента): keep_alive каждые 10 с, ни одного окна тишины больше 20 с", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("Сейчас посмотрю.");
    vi.advanceTimersByTime(9_999);
    expect(keepAlives(socket)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(keepAlives(socket)).toHaveLength(1);
    vi.advanceTimersByTime(50_000);
    expect(keepAlives(socket)).toHaveLength(6);
    expect(keepAlives(socket)[0]).toEqual({ keep_alive: true });
  });

  it("после паузы текст идёт как обычно: без flush и без повторного списка голосов", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("Сейчас посмотрю.");
    vi.advanceTimersByTime(30_000);
    stream.speak("Нашёл.");
    const last = socket.messages.at(-1)!;
    expect(last).toMatchObject({ inputs: [{ text: "Нашёл. " }] });
    expect(last.flush).toBeUndefined();
    expect(socket.messages.filter((message) => "voices" in message)).toHaveLength(1);
  });

  it("после finish (close_socket) keep_alive не шлётся", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("Коротко.");
    stream.finish();
    const sentBefore = socket.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(keepAlives(socket)).toHaveLength(0);
    expect(socket.sent).toHaveLength(sentBefore);
  });

  it("после конца, обрыва нами и отказа таймер снят: ничего не шлётся и в очереди таймеров пусто", () => {
    for (const end of ["done", "cut", "close", "fail"] as const) {
      const { stream, socket, log } = streamWith();
      socket.open();
      stream.speak("Привет.");
      socket.receive(speechChunk("Привет. ", 500));
      if (end === "done") socket.receive({ is_final: true });
      if (end === "cut") stream.cut(100);
      if (end === "close") stream.close();
      if (end === "fail") socket.fail();
      const sentBefore = socket.sent.length;
      vi.advanceTimersByTime(60_000);
      expect(keepAlives(socket), end).toHaveLength(0);
      expect(socket.sent, end).toHaveLength(sentBefore);
      expect(vi.getTimerCount(), end).toBe(0);
      expect(log.failed + log.done).toBeLessThanOrEqual(1);
    }
  });

  it("живой звук тоже считается: пока идёт звук, лишних keep_alive нет", () => {
    const { stream, socket } = streamWith();
    socket.open();
    stream.speak("Длинное предложение.");
    for (let step = 0; step < 5; step += 1) {
      vi.advanceTimersByTime(4_000);
      socket.receive(speechChunk("а", 100));
    }
    // 20 с прошло, звук приходил каждые 4 с: сервер и так не считает соединение спящим.
    expect(keepAlives(socket).length).toBeLessThanOrEqual(2);
  });
});
