/** Разбор Ogg/Opus для проверок: независимая от упаковщика проверка заголовков, страниц, контрольных сумм и позиции в звуке. */

export interface OggPage {
  version: number;
  flags: number;
  granule: bigint;
  serial: number;
  sequence: number;
  /** Контрольная сумма, записанная в странице, и пересчитанная по байтам. */
  checksum: number;
  computedChecksum: number;
  segmentTable: number[];
  body: Uint8Array;
  /** Пакеты, закончившиеся на этой странице. */
  packets: Uint8Array[];
  /** Последний пакет страницы не закончился (продолжается на следующей). */
  continuesOnNext: boolean;
}

export const OGG_FLAGS = { continued: 0x01, firstPage: 0x02, lastPage: 0x04 } as const;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit += 1) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function oggChecksum(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc >>> 0;
}

export function readOggPages(bytes: Uint8Array): OggPage[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages: OggPage[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const magic = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (magic !== "OggS") throw new Error(`Нет OggS на смещении ${offset}`);
    const segments = bytes[offset + 26]!;
    const segmentTable = [...bytes.subarray(offset + 27, offset + 27 + segments)];
    const bodyLength = segmentTable.reduce((sum, size) => sum + size, 0);
    const headerLength = 27 + segments;
    const end = offset + headerLength + bodyLength;
    if (end > bytes.length) throw new Error("Страница обрезана");
    const whole = bytes.slice(offset, end);
    const checksum = view.getUint32(offset + 22, true);
    whole.fill(0, 22, 26);
    const body = bytes.slice(offset + headerLength, end);
    const packets: Uint8Array[] = [];
    let from = 0;
    let packetStart = 0;
    for (const size of segmentTable) {
      from += size;
      if (size < 255) {
        packets.push(body.slice(packetStart, from));
        packetStart = from;
      }
    }
    pages.push({
      version: bytes[offset + 4]!,
      flags: bytes[offset + 5]!,
      granule: view.getBigUint64(offset + 6, true),
      serial: view.getUint32(offset + 14, true),
      sequence: view.getUint32(offset + 18, true),
      checksum,
      computedChecksum: oggChecksum(whole),
      segmentTable,
      body,
      packets,
      continuesOnNext: segmentTable.length > 0 && segmentTable.at(-1) === 255,
    });
    offset = end;
  }
  return pages;
}

export interface OpusStreamInfo {
  pages: OggPage[];
  head: { version: number; channels: number; preSkip: number; inputRate: number; outputGain: number; mapping: number };
  vendor: string;
  commentCount: number;
  audioPackets: Uint8Array[];
  /** Позиция в звуке из последней страницы минус preSkip, в отсчётах 48 кГц. */
  samples: number;
  durationMs: number;
}

export function readOggOpus(bytes: Uint8Array): OpusStreamInfo {
  const pages = readOggPages(bytes);
  const [headPage, tagsPage, ...audioPages] = pages;
  if (!headPage || !tagsPage) throw new Error("Нет заголовочных страниц");
  const head = headPage.packets[0]!;
  if (String.fromCharCode(...head.subarray(0, 8)) !== "OpusHead") throw new Error("Нет OpusHead");
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tags = tagsPage.packets[0]!;
  if (String.fromCharCode(...tags.subarray(0, 8)) !== "OpusTags") throw new Error("Нет OpusTags");
  const tagsView = new DataView(tags.buffer, tags.byteOffset, tags.byteLength);
  const vendorLength = tagsView.getUint32(8, true);
  const vendor = new TextDecoder().decode(tags.subarray(12, 12 + vendorLength));
  const commentCount = tagsView.getUint32(12 + vendorLength, true);
  const info = {
    version: head[8]!,
    channels: head[9]!,
    preSkip: headView.getUint16(10, true),
    inputRate: headView.getUint32(12, true),
    outputGain: headView.getInt16(16, true),
    mapping: head[18]!,
  };
  const lastGranule = pages.at(-1)!.granule;
  const samples = Number(lastGranule) - info.preSkip;
  return {
    pages,
    head: info,
    vendor,
    commentCount,
    audioPackets: audioPages.flatMap((page) => page.packets),
    samples,
    durationMs: Math.round((samples * 1000) / 48_000),
  };
}

/** Опознавательный тон: PCM s16le 24 кГц моно, синус `hz` длиной `ms`. */
export function sinePcm24k(ms: number, hz = 440, amplitude = 8000): Uint8Array {
  const samples = Math.round((24_000 * ms) / 1000);
  const pcm = new Uint8Array(samples * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < samples; index += 1) view.setInt16(index * 2, Math.round(Math.sin((2 * Math.PI * hz * index) / 24_000) * amplitude), true);
  return pcm;
}
