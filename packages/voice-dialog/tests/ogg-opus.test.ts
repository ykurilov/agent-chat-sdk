import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePcmToOggOpus } from "../src/server/ogg-opus";
import { OGG_FLAGS, readOggOpus, readOggPages, sinePcm24k } from "./support/ogg-reader";

const FRAME_SAMPLES = 960;

describe("упаковка PCM 24 кГц в Ogg/Opus", () => {
  it("файл начинается с OggS, первая страница — OpusHead (начало потока), вторая — OpusTags", async () => {
    const { audio } = await encodePcmToOggOpus(sinePcm24k(1000));
    expect(String.fromCharCode(...audio.subarray(0, 4))).toBe("OggS");
    const stream = readOggOpus(audio);
    const [head, tags] = stream.pages;
    expect(head!.flags & OGG_FLAGS.firstPage).toBe(OGG_FLAGS.firstPage);
    expect(head!.granule).toBe(0n);
    expect(head!.packets).toHaveLength(1);
    expect(head!.packets[0]).toHaveLength(19);
    expect(tags!.flags & OGG_FLAGS.firstPage).toBe(0);
    expect(tags!.granule).toBe(0n);
    expect(tags!.packets).toHaveLength(1);
  });

  it("OpusHead: версия 1, один канал, частота 48 кГц, pre-skip в пределах кадра, без усиления, семейство 0", async () => {
    const stream = readOggOpus((await encodePcmToOggOpus(sinePcm24k(500))).audio);
    expect(stream.head.version).toBe(1);
    expect(stream.head.channels).toBe(1);
    expect(stream.head.inputRate).toBe(24_000);
    expect(stream.head.preSkip).toBeGreaterThan(0);
    expect(stream.head.preSkip).toBeLessThan(FRAME_SAMPLES);
    expect(stream.head.outputGain).toBe(0);
    expect(stream.head.mapping).toBe(0);
  });

  it("OpusTags: имя кодировщика и ни одного комментария", async () => {
    const stream = readOggOpus((await encodePcmToOggOpus(sinePcm24k(500))).audio);
    expect(stream.vendor.length).toBeGreaterThan(0);
    expect(stream.commentCount).toBe(0);
  });

  it("контрольная сумма каждой страницы верна, номера страниц идут подряд с нуля, серийный номер один", async () => {
    const { pages } = readOggOpus((await encodePcmToOggOpus(sinePcm24k(5000))).audio);
    expect(pages.length).toBeGreaterThan(3);
    pages.forEach((page, index) => {
      expect(page.version).toBe(0);
      expect(page.checksum).toBe(page.computedChecksum);
      expect(page.sequence).toBe(index);
      expect(page.serial).toBe(pages[0]!.serial);
    });
  });

  it("последняя страница помечена концом потока, остальные — нет", async () => {
    const { pages } = readOggOpus((await encodePcmToOggOpus(sinePcm24k(5000))).audio);
    pages.forEach((page, index) => {
      const last = (page.flags & OGG_FLAGS.lastPage) !== 0;
      expect(last).toBe(index === pages.length - 1);
    });
  });

  it("позиция в звуке не убывает от страницы к странице, а на последней равна pre-skip + число отсчётов 48 кГц", async () => {
    const { audio, durationMs } = await encodePcmToOggOpus(sinePcm24k(2500));
    const stream = readOggOpus(audio);
    const granules = stream.pages.slice(2).map((page) => page.granule);
    expect(granules.every((value, index) => index === 0 || value >= granules[index - 1]!)).toBe(true);
    expect(stream.samples).toBe(2500 * 48);
    expect(durationMs).toBe(2500);
    expect(stream.durationMs).toBe(durationMs);
  });

  it("длительность по позиции совпадает со звуком, когда он не кратен кадру (20 мс): хвост не придумывается", async () => {
    const { audio, durationMs } = await encodePcmToOggOpus(sinePcm24k(1013));
    expect(durationMs).toBe(1013);
    expect(readOggOpus(audio).samples).toBe(1013 * 48);
  });

  it("кадров на 20 мс: 1 с звука — 50 пакетов, неполный кадр добивается тишиной", async () => {
    expect(readOggOpus((await encodePcmToOggOpus(sinePcm24k(1000))).audio).audioPackets).toHaveLength(50);
    expect(readOggOpus((await encodePcmToOggOpus(sinePcm24k(1005))).audio).audioPackets).toHaveLength(51);
  });

  it("битрейт около 32 кбит/с: 2 минуты речи — меньше 600 КБ и больше 300 КБ", async () => {
    const { audio } = await encodePcmToOggOpus(sinePcm24k(120_000, 300));
    expect(audio.length).toBeGreaterThan(300_000);
    expect(audio.length).toBeLessThan(600_000);
  });

  it("страниц больше одной на звук, но не по странице на пакет", async () => {
    const stream = readOggOpus((await encodePcmToOggOpus(sinePcm24k(10_000))).audio);
    expect(stream.pages.length - 2).toBeLessThan(stream.audioPackets.length);
    expect(stream.pages.length - 2).toBeGreaterThan(1);
    for (const page of stream.pages) expect(page.segmentTable.length).toBeLessThanOrEqual(255);
  });

  it("каждый пакет — настоящий Opus-кадр на 20 мс, моно (TOC-байт)", async () => {
    const stream = readOggOpus((await encodePcmToOggOpus(sinePcm24k(500))).audio);
    for (const packet of stream.audioPackets) {
      const toc = packet[0]!;
      expect((toc >> 2) & 1).toBe(0); // моно
      expect(toc & 3).toBe(0); // один кадр в пакете
    }
  });

  it("серийный номер разный от файла к файлу (потоки не слипаются при склейке)", async () => {
    const serials = new Set<number>();
    for (let index = 0; index < 6; index += 1) serials.add(readOggOpus((await encodePcmToOggOpus(sinePcm24k(200))).audio).pages[0]!.serial);
    expect(serials.size).toBeGreaterThan(1);
  });

  it("пустой звук и звук короче отсчёта — ошибка, а не пустой файл", async () => {
    await expect(encodePcmToOggOpus(new Uint8Array(0))).rejects.toThrow(/пуст|нет звука/i);
    await expect(encodePcmToOggOpus(new Uint8Array(1))).rejects.toThrow(/пуст|нет звука/i);
  });

  it("лишний нечётный байт в конце PCM отбрасывается", async () => {
    const even = sinePcm24k(100);
    const odd = new Uint8Array(even.length + 1);
    odd.set(even);
    const a = await encodePcmToOggOpus(even);
    const b = await encodePcmToOggOpus(odd);
    expect(b.durationMs).toBe(a.durationMs);
  });

  it("звук со смещением в буфере (subarray) читается правильно", async () => {
    const source = sinePcm24k(400);
    const padded = new Uint8Array(source.length + 10);
    padded.set(source, 6);
    const { durationMs } = await encodePcmToOggOpus(padded.subarray(6, 6 + source.length));
    expect(durationMs).toBe(400);
  });

  it("кодировщик подгружается при первом вызове, а не при подключении модуля", async () => {
    const modulePath = new URL("../src/server/ogg-opus.ts", import.meta.url);
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(modulePath, "utf8");
    expect(source).not.toMatch(/^import[^;]*from\s+["']opusscript["']/m);
    expect(source).toMatch(/import\(\s*["']opusscript["']\s*\)/);
  });
});

describe("расшифровка файла декодером", () => {
  it("декодирование своих же пакетов даёт тон нужной частоты и громкости", async () => {
    const { default: OpusScript } = await import("opusscript");
    const { audio } = await encodePcmToOggOpus(sinePcm24k(1000, 440));
    const stream = readOggOpus(audio);
    const decoder = new OpusScript(48_000, 1, OpusScript.Application.VOIP);
    const pcm = Buffer.concat(stream.audioPackets.map((packet) => decoder.decode(Buffer.from(packet))));
    decoder.delete();
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    const middle = samples.subarray(48_000 / 4, (48_000 * 3) / 4);
    let crossings = 0;
    let peak = 0;
    for (let index = 1; index < middle.length; index += 1) {
      if (middle[index - 1]! < 0 && middle[index]! >= 0) crossings += 1;
      peak = Math.max(peak, Math.abs(middle[index]!));
    }
    // за полсекунды ~220 периодов 440 Гц
    expect(crossings).toBeGreaterThan(200);
    expect(crossings).toBeLessThan(240);
    expect(peak).toBeGreaterThan(4000);
    expect(readOggPages(audio)).toHaveLength(stream.pages.length);
  });
});

const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasFfprobe)("проверка настоящим ffprobe (локально, если установлен)", () => {
  it("ffprobe видит Opus 48 кГц моно, длительность совпадает, без ошибок разбора", async () => {
    const { audio, durationMs } = await encodePcmToOggOpus(sinePcm24k(3000));
    const folder = mkdtempSync(join(tmpdir(), "ogg-opus-"));
    try {
      const file = join(folder, "voice.ogg");
      writeFileSync(file, audio);
      const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration,format_name", "-of", "json", file], { encoding: "utf8" });
      const info = JSON.parse(output) as { streams: Array<{ codec_name: string; sample_rate: string; channels: number }>; format: { duration: string; format_name: string } };
      expect(info.format.format_name).toBe("ogg");
      expect(info.streams[0]).toMatchObject({ codec_name: "opus", sample_rate: "48000", channels: 1 });
      expect(Math.abs(Number(info.format.duration) * 1000 - durationMs)).toBeLessThan(25);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
