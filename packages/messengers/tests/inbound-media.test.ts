import { describe, expect, it } from "vitest";
import { createInboundMedia, MAX_INBOUND_FILE_BYTES, oggDurationMs } from "../src/inbound-media";
import { DownloadTooLargeError } from "../src/messenger-files";
import { messengerTexts } from "../src/messenger-texts";
import type { AttachmentIngest, AudioTranscriber } from "../src/types";
import { createFakeAdapter, update } from "./support/fake-adapter";

/** Две страницы Ogg; у последней позиция — `seconds` × 48 000 (частота Opus). */
function oggOf(seconds: number): Uint8Array {
  const page = (granule: bigint) => {
    const bytes = new Uint8Array(40);
    bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
    new DataView(bytes.buffer).setBigInt64(6, granule, true);
    return bytes;
  };
  const result = new Uint8Array(80);
  result.set(page(0n), 0);
  result.set(page(BigInt(seconds * 48_000)), 40);
  return result;
}

function setup(options: { attachments?: AttachmentIngest; transcribe?: AudioTranscriber; files?: Record<string, Uint8Array> } = {}) {
  const fake = createFakeAdapter({ ...(options.files !== undefined && { files: options.files }) });
  const errors: unknown[] = [];
  const media = createInboundMedia({
    ...(options.attachments !== undefined && { attachments: options.attachments }),
    ...(options.transcribe !== undefined && { transcribe: options.transcribe }),
    logError: (error) => errors.push(error),
  });
  const prepare = (overrides: Parameters<typeof update>[0]) => media.toUserParts({ adapter: fake.adapter, update: update(overrides), ownerId: "anna", chatId: "chat-1" });
  return { fake, errors, prepare };
}

describe("файлы на входе", () => {
  it("текст — как есть", async () => {
    const { prepare } = setup();
    expect(await prepare({ text: "Привет" })).toEqual({ parts: [{ type: "text", text: "Привет" }], voice: false });
  });

  it("вложения не подключены — просим писать текстом", async () => {
    const { prepare, fake } = setup();
    expect(await prepare({ kind: "files", files: [{ fileId: "f1", size: 10 }] })).toEqual({ reply: messengerTexts.filesOff });
    expect(fake.downloads).toEqual([]);
  });

  it("файл → вложение чата: подпись первой, файл ссылкой attachment:<id>", async () => {
    const calls: unknown[] = [];
    const { prepare } = setup({
      files: { f1: new Uint8Array([7, 7]) },
      attachments: async (input) => {
        calls.push(input);
        return { ok: true, attachment: { id: "att-1", name: "отчёт.pdf", mediaType: "application/pdf", size: 2 } };
      },
    });
    const result = await prepare({ kind: "files", text: "Посмотри", files: [{ fileId: "f1", name: "отчёт.pdf", mediaType: "application/pdf", size: 2 }] });
    expect(result).toEqual({
      parts: [
        { type: "text", text: "Посмотри" },
        { type: "file", url: "attachment:att-1", mediaType: "application/pdf", filename: "отчёт.pdf" },
      ],
      voice: false,
    });
    expect(calls).toEqual([{ ownerId: "anna", chatId: "chat-1", name: "отчёт.pdf", mediaType: "application/pdf", bytes: new Uint8Array([7, 7]) }]);
  });

  it("файл больше предела — сообщение с пределом, не скачиваем; без размера — проверка после скачивания", async () => {
    const attachments: AttachmentIngest = async () => ({ ok: true, attachment: { id: "a", name: "x", mediaType: "x", size: 1 } });
    const big = setup({ attachments });
    expect(await big.prepare({ kind: "files", files: [{ fileId: "f1", size: MAX_INBOUND_FILE_BYTES + 1 }] })).toEqual({ reply: messengerTexts.fileTooBig(20) });
    expect(big.fake.downloads).toEqual([]);

    const unknownSize = setup({ attachments, files: { f2: new Uint8Array(MAX_INBOUND_FILE_BYTES + 1) } });
    expect(await unknownSize.prepare({ kind: "files", files: [{ fileId: "f2" }] })).toEqual({ reply: messengerTexts.fileTooBig(20) });
  });

  it("мессенджер отдаёт файл больше предела, хотя размер не сообщил — «слишком большой», а не «не вышло»", async () => {
    const attachments: AttachmentIngest = async () => ({ ok: true, attachment: { id: "a", name: "x", mediaType: "x", size: 1 } });
    const huge = setup({ attachments, transcribe: async () => ({ text: "не дойдёт" }) });
    huge.fake.adapter.downloadFile = async () => {
      throw new DownloadTooLargeError(MAX_INBOUND_FILE_BYTES);
    };
    expect(await huge.prepare({ kind: "files", files: [{ fileId: "f1" }] })).toEqual({ reply: messengerTexts.fileTooBig(20) });
    expect(await huge.prepare({ kind: "voice", files: [{ fileId: "v1" }] })).toEqual({ reply: messengerTexts.voiceTooLong });
  });

  it("вложение не принято или скачивание упало — человеку понятный ответ, ошибка в журнал", async () => {
    // Причина от `ingestFile` — код (как `error.kind` у адреса загрузки); человеку — словами.
    const refused = setup({ attachments: async () => ({ ok: false, reason: "unsupported_type" }) });
    expect(await refused.prepare({ kind: "files", files: [{ fileId: "f1", size: 3 }] })).toEqual({ reply: "Файл не принят: такой вид файла не поддерживается." });
    const unknown = setup({ attachments: async () => ({ ok: false, reason: "something_new" }) });
    expect(await unknown.prepare({ kind: "files", files: [{ fileId: "f1", size: 3 }] })).toEqual({ reply: "Файл не принят." });

    const broken = setup({ attachments: async () => ({ ok: true, attachment: { id: "a", name: "x", mediaType: "x", size: 1 } }) });
    broken.fake.adapter.downloadFile = async () => {
      throw new Error("timeout");
    };
    expect(await broken.prepare({ kind: "files", files: [{ fileId: "f1", size: 3 }] })).toEqual({ reply: messengerTexts.failed });
    expect(broken.errors).toHaveLength(1);
  });
});

describe("голос на входе", () => {
  it("готовая расшифровка из обновления — без скачивания и распознавания", async () => {
    let transcribed = 0;
    const { prepare, fake } = setup({
      transcribe: async () => {
        transcribed++;
        return { text: "не то" };
      },
    });
    expect(await prepare({ kind: "voice", files: [{ fileId: "v1", size: 100 }], transcription: "Купи хлеба" })).toEqual({
      parts: [{ type: "text", text: "[голосовое] Купи хлеба" }],
      voice: true,
    });
    expect(transcribed).toBe(0);
    expect(fake.downloads).toEqual([]);
  });

  it("распознавание: агенту уходит текст с пометкой «голосовое»", async () => {
    const calls: unknown[] = [];
    const audio = oggOf(30);
    const { prepare } = setup({
      files: { v1: audio },
      transcribe: async (input) => {
        calls.push(input);
        return { text: "Перезвони завтра" };
      },
    });
    expect(await prepare({ kind: "voice", files: [{ fileId: "v1", mediaType: "audio/ogg", size: audio.length }] })).toEqual({
      parts: [{ type: "text", text: "[голосовое] Перезвони завтра" }],
      voice: true,
    });
    expect(calls).toEqual([{ ownerId: "anna", chatId: "chat-1", audio, mediaType: "audio/ogg" }]);
  });

  it("распознавание не подключено — просим писать текстом", async () => {
    const { prepare } = setup();
    expect(await prepare({ kind: "voice", files: [{ fileId: "v1", size: 100 }] })).toEqual({ reply: messengerTexts.voiceOff });
  });

  it("больше 20 МБ или длиннее 10 минут — «слишком длинное», не распознаём", async () => {
    let transcribed = 0;
    const transcribe: AudioTranscriber = async () => {
      transcribed++;
      return { text: "x" };
    };
    const heavy = setup({ transcribe });
    expect(await heavy.prepare({ kind: "voice", files: [{ fileId: "v1", size: MAX_INBOUND_FILE_BYTES + 1 }] })).toEqual({ reply: messengerTexts.voiceTooLong });
    expect(heavy.fake.downloads).toEqual([]);

    // Длину сказал мессенджер — не скачиваем.
    const known = setup({ transcribe });
    expect(await known.prepare({ kind: "voice", files: [{ fileId: "v9", durationMs: 10 * 60_000 + 1 }] })).toEqual({ reply: messengerTexts.voiceTooLong });
    expect(known.fake.downloads).toEqual([]);

    const long = setup({ transcribe, files: { v2: oggOf(10 * 60 + 1) } });
    expect(await long.prepare({ kind: "voice", files: [{ fileId: "v2", mediaType: "audio/ogg" }] })).toEqual({ reply: messengerTexts.voiceTooLong });

    const exactlyTen = setup({ transcribe, files: { v3: oggOf(10 * 60) } });
    expect((await exactlyTen.prepare({ kind: "voice", files: [{ fileId: "v3", mediaType: "audio/ogg" }] })) as object).toHaveProperty("parts");
    expect(transcribed).toBe(1);
  });

  it("лимит распознавания, недоступность, пустой текст и сбой — понятный ответ", async () => {
    const answers = async (result: Awaited<ReturnType<AudioTranscriber>> | Error) => {
      const { prepare, errors } = setup({
        transcribe: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      });
      return { reply: await prepare({ kind: "voice", files: [{ fileId: "v1", size: 10 }] }), errors };
    };
    expect((await answers({ skipped: "limit" })).reply).toEqual({ reply: messengerTexts.voiceLimit });
    expect((await answers({ skipped: "unavailable" })).reply).toEqual({ reply: messengerTexts.voiceFailed });
    expect((await answers({ text: "  " })).reply).toEqual({ reply: messengerTexts.voiceFailed });
    const failed = await answers(new Error("soniox down"));
    expect(failed.reply).toEqual({ reply: messengerTexts.voiceFailed });
    expect(failed.errors).toHaveLength(1);
  });
});

describe("длина Ogg", () => {
  it("по позиции последней страницы; не Ogg — неизвестно", () => {
    expect(oggDurationMs(oggOf(90))).toBe(90_000);
    expect(oggDurationMs(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});
