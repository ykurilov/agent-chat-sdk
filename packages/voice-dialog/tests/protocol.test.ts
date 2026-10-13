import { describe, expect, it } from "vitest";
import {
  DIALOG_CLOSE_CODES,
  encodeSpeechFrame,
  decodeSpeechFrame,
  parseClientCommand,
  parseStartMessage,
} from "../src/protocol";

const start = { type: "start", audio: { format: "pcm_s16le", sampleRate: 16000, channels: 1 } };

describe("первое сообщение клиента (start)", () => {
  it("принимает start с форматом звука; язык необязателен", () => {
    expect(parseStartMessage(JSON.stringify(start))).toEqual({ ok: true, message: start });
    expect(parseStartMessage(JSON.stringify({ ...start, language: "ru" }))).toEqual({ ok: true, message: { ...start, language: "ru" } });
  });

  it.each([
    ["не JSON", "не json"],
    ["не объект", "42"],
    ["null", "null"],
    ["другой тип первым", JSON.stringify({ type: "ping" })],
    ["нет звука", JSON.stringify({ type: "start" })],
    ["другой формат звука", JSON.stringify({ ...start, audio: { format: "opus", sampleRate: 16000, channels: 1 } })],
    ["не 16 кГц", JSON.stringify({ ...start, audio: { format: "pcm_s16le", sampleRate: 44100, channels: 1 } })],
    ["не моно", JSON.stringify({ ...start, audio: { format: "pcm_s16le", sampleRate: 16000, channels: 2 } })],
    ["язык не строка", JSON.stringify({ ...start, language: 5 })],
  ])("отклоняет: %s", (_name, raw) => {
    expect(parseStartMessage(raw)).toEqual({ ok: false });
  });
});

describe("команды клиента", () => {
  const good: Array<[string, unknown]> = [
    ["prepare", { type: "prepare", replyId: 1 }],
    ["speak", { type: "speak", replyId: 1, text: "Привет." }],
    ["speak с id сообщения", { type: "speak", replyId: 1, text: "Привет.", messageId: "m1" }],
    ["end_reply", { type: "end_reply", replyId: 1 }],
    ["interrupt", { type: "interrupt", replyId: 1, playedMs: 1234 }],
    ["mark_cut", { type: "mark_cut", replyId: 1, messageId: "m1", partIndex: 0, charOffset: 12, spokenTail: "хвост" }],
    ["voice", { type: "voice", voiceId: "anna" }],
    ["ping", { type: "ping" }],
  ];

  it.each(good)("принимает %s", (_name, command) => {
    expect(parseClientCommand(JSON.stringify(command))).toEqual({ ok: true, message: command });
  });

  it.each([
    ["неизвестная команда", { type: "explode" }],
    ["второй start", start],
    ["нет типа", { replyId: 1 }],
    ["prepare без replyId", { type: "prepare" }],
    ["replyId дробный", { type: "prepare", replyId: 1.5 }],
    ["replyId отрицательный", { type: "prepare", replyId: -1 }],
    ["speak без текста", { type: "speak", replyId: 1 }],
    ["speak с пустым текстом", { type: "speak", replyId: 1, text: "" }],
    ["speak: messageId не строка", { type: "speak", replyId: 1, text: "a", messageId: 3 }],
    ["interrupt без playedMs", { type: "interrupt", replyId: 1 }],
    ["interrupt: playedMs отрицательный", { type: "interrupt", replyId: 1, playedMs: -5 }],
    ["mark_cut без сообщения", { type: "mark_cut", replyId: 1, partIndex: 0, charOffset: 0, spokenTail: "" }],
    ["mark_cut: charOffset отрицательный", { type: "mark_cut", replyId: 1, messageId: "m", partIndex: 0, charOffset: -1, spokenTail: "" }],
    ["mark_cut: partIndex дробный", { type: "mark_cut", replyId: 1, messageId: "m", partIndex: 0.5, charOffset: 0, spokenTail: "" }],
    ["voice с пустым id", { type: "voice", voiceId: "" }],
  ])("отклоняет: %s", (_name, command) => {
    expect(parseClientCommand(JSON.stringify(command))).toEqual({ ok: false });
  });

  it("не JSON и не объект — отказ", () => {
    expect(parseClientCommand("{")).toEqual({ ok: false });
    expect(parseClientCommand("[]")).toEqual({ ok: false });
    expect(parseClientCommand("null")).toEqual({ ok: false });
  });

  it("лишние поля отбрасываются: наружу идёт только договорное", () => {
    const parsed = parseClientCommand(JSON.stringify({ type: "prepare", replyId: 2, apiKey: "секрет" }));
    expect(parsed).toEqual({ ok: true, message: { type: "prepare", replyId: 2 } });
  });
});

describe("кадр озвучки", () => {
  it("4 байта replyId (big-endian) и затем звук", () => {
    const frame = encodeSpeechFrame(258, new Uint8Array([1, 2, 3]));
    expect([...frame]).toEqual([0, 0, 1, 2, 1, 2, 3]);
    expect(decodeSpeechFrame(frame)).toEqual({ replyId: 258, audio: new Uint8Array([1, 2, 3]) });
  });

  it("кадр короче 4 байт — не кадр", () => {
    expect(decodeSpeechFrame(new Uint8Array([0, 0, 1]))).toBeNull();
  });

  it("большой replyId не переполняется", () => {
    expect(decodeSpeechFrame(encodeSpeechFrame(4_000_000_000, new Uint8Array([9])))?.replyId).toBe(4_000_000_000);
  });
});

describe("коды закрытия", () => {
  it("совпадают с договором contracts/dialog.md", () => {
    expect(DIALOG_CLOSE_CODES).toEqual({
      normal: 1000,
      invalidMessage: 4400,
      noUser: 4401,
      spendingLimit: 4402,
      foreignChat: 4403,
      idle: 4408,
      audioTooLarge: 4413,
      tooMany: 4429,
      recognitionUnavailable: 4502,
    });
  });
});
