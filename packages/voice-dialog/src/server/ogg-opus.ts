/**
 * Упаковка озвучки в голосовое сообщение: PCM s16le 24 кГц моно → 48 кГц → Opus (кадры по 20 мс, ~32 кбит/с) → Ogg.
 * Ogg по RFC 3533, Opus в Ogg по RFC 7845: страница OpusHead, страница OpusTags, дальше страницы со звуком;
 * позиция в звуке — число отсчётов 48 кГц (с учётом pre-skip), на последней странице — настоящий конец звука без добитой тишины.
 * Кодировщик (opusscript, WebAssembly) подгружается при первом вызове: без голосовых ответов он не грузится.
 */

export interface OggOpusAudio {
  /** Готовый файл Ogg/Opus. */
  audio: Uint8Array;
  /** Длительность звука, мс (по позиции в звуке, без pre-skip). */
  durationMs: number;
}

const INPUT_RATE = 24_000;
const OUTPUT_RATE = 48_000;
const FRAME_SAMPLES = (OUTPUT_RATE * 20) / 1000;
const BITRATE = 32_000;
/** Задержка кодировщика libopus на 48 кГц в режиме голоса (6,5 мс): первые отсчёты декодер выбрасывает. */
const PRE_SKIP = 312;
/** Примерно секунда звука на страницу: страниц немного, а потеря одной не губит весь файл. */
const PACKETS_PER_PAGE = 50;
const MAX_SEGMENTS = 255;
const VENDOR = "agent-chat-voice-dialog";

const FLAG_FIRST = 0x01 << 1;
const FLAG_LAST = 0x01 << 2;

interface OpusEncoder {
  setBitrate(bitrate: number): void;
  encode(buffer: Buffer, frameSize: number): Buffer;
  delete(): void;
}
type OpusEncoderClass = new (rate: 48000, channels: number, application: number) => OpusEncoder;

let encoderClass: Promise<OpusEncoderClass> | undefined;

async function loadEncoder(): Promise<OpusEncoderClass> {
  encoderClass ??= import("opusscript").then((module) => ((module as { default?: unknown }).default ?? module) as OpusEncoderClass);
  try {
    return await encoderClass;
  } catch (error) {
    encoderClass = undefined;
    throw error;
  }
}

/** Режим «голос» (VOIP) в libopus. */
const APPLICATION_VOIP = 2048;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit += 1) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** Контрольная сумма страницы Ogg: многочлен 0x04C11DB7, начальное значение 0, без разворота битов. */
function checksum(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc >>> 0;
}

/** Удвоение частоты: между соседними отсчётами — их среднее. */
function upsampleTwice(pcm: Int16Array): Int16Array {
  const out = new Int16Array(pcm.length * 2);
  for (let index = 0; index < pcm.length; index += 1) {
    const current = pcm[index]!;
    const next = index + 1 < pcm.length ? pcm[index + 1]! : current;
    out[index * 2] = current;
    out[index * 2 + 1] = (current + next) >> 1;
  }
  return out;
}

function lacing(size: number): number[] {
  const segments = new Array<number>(Math.floor(size / 255)).fill(255);
  segments.push(size % 255);
  return segments;
}

function buildPage(input: { flags: number; granule: bigint; serial: number; sequence: number; packets: Uint8Array[] }): Uint8Array {
  const table = input.packets.flatMap((packet) => lacing(packet.length));
  const bodyLength = input.packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = new Uint8Array(27 + table.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0; // версия
  page[5] = input.flags;
  view.setBigUint64(6, input.granule, true);
  view.setUint32(14, input.serial, true);
  view.setUint32(18, input.sequence, true);
  page[26] = table.length;
  page.set(table, 27);
  let offset = 27 + table.length;
  for (const packet of input.packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, checksum(page), true);
  return page;
}

function opusHead(): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1; // версия
  head[9] = 1; // канал
  view.setUint16(10, PRE_SKIP, true);
  view.setUint32(12, INPUT_RATE, true);
  view.setInt16(16, 0, true); // усиление
  head[18] = 0; // семейство каналов 0: моно или стерео
  return head;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode(VENDOR);
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(tags.buffer);
  tags.set(new TextEncoder().encode("OpusTags"), 0);
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true); // комментариев нет
  return tags;
}

/** PCM s16le 24 кГц моно целиком → файл Ogg/Opus. Пустой звук — ошибка. */
export async function encodePcmToOggOpus(pcm: Uint8Array): Promise<OggOpusAudio> {
  const inputSamples = Math.floor(pcm.length / 2);
  if (inputSamples === 0) throw new Error("Нет звука для упаковки: пустой PCM");
  const samples24 = new Int16Array(inputSamples);
  const reader = new DataView(pcm.buffer, pcm.byteOffset, inputSamples * 2);
  for (let index = 0; index < inputSamples; index += 1) samples24[index] = reader.getInt16(index * 2, true);
  const samples = upsampleTwice(samples24);

  const Encoder = await loadEncoder();
  const encoder = new Encoder(OUTPUT_RATE, 1, APPLICATION_VOIP);
  const packets: Uint8Array[] = [];
  try {
    encoder.setBitrate(BITRATE);
    const frame = new Int16Array(FRAME_SAMPLES);
    for (let start = 0; start < samples.length; start += FRAME_SAMPLES) {
      frame.fill(0);
      frame.set(samples.subarray(start, start + FRAME_SAMPLES));
      const encoded = encoder.encode(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength), FRAME_SAMPLES);
      packets.push(Uint8Array.from(encoded));
    }
  } finally {
    encoder.delete();
  }

  const serial = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const pages: Uint8Array[] = [];
  let sequence = 0;
  const add = (flags: number, granule: bigint, group: Uint8Array[]) => {
    pages.push(buildPage({ flags, granule, serial, sequence, packets: group }));
    sequence += 1;
  };
  add(FLAG_FIRST, 0n, [opusHead()]);
  add(0, 0n, [opusTags()]);

  let index = 0;
  while (index < packets.length) {
    const group: Uint8Array[] = [];
    let segments = 0;
    while (index < packets.length && group.length < PACKETS_PER_PAGE) {
      const needed = lacing(packets[index]!.length).length;
      if (segments + needed > MAX_SEGMENTS) break;
      group.push(packets[index]!);
      segments += needed;
      index += 1;
    }
    const last = index >= packets.length;
    // Позиция страницы — конец звука её последнего пакета; на последней странице — без тишины, добитой до кадра.
    const granule = last ? BigInt(PRE_SKIP + samples.length) : BigInt(PRE_SKIP + index * FRAME_SAMPLES);
    add(last ? FLAG_LAST : 0, granule, group);
  }

  const audio = new Uint8Array(pages.reduce((sum, page) => sum + page.length, 0));
  let offset = 0;
  for (const page of pages) {
    audio.set(page, offset);
    offset += page.length;
  }
  return { audio, durationMs: Math.round((samples.length * 1000) / OUTPUT_RATE) };
}
