import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeAudioFile } from "../src/server";
import type { SonioxSessionOptions } from "../src/server";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.useRealTimers());

const KEY = "main-secret-key-0123456789";

function start(bytes: Uint8Array, options: Partial<SonioxSessionOptions> & { chunkBytes?: number } = {}) {
  FakeUpstream.instances = [];
  const log: string[] = [];
  const result = transcribeAudioFile({
    bytes,
    apiKey: KEY,
    model: "stt-async-v5",
    languageHints: ["ru"],
    websocketUrl: "wss://stt.test/transcribe",
    logError: (message) => log.push(message),
    connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
    ...options,
  });
  const upstream = FakeUpstream.instances.at(-1)!;
  return { result, upstream, log };
}

const audioChunks = (upstream: FakeUpstream) => upstream.sent.filter((item) => typeof item !== "string") as Uint8Array[];

describe("T049: transcribeAudioFile — готовый файл через живой поток Soniox", () => {
  it("формат auto, весь файл кусками сразу, без пауз реального времени, затем конец звука", () => {
    vi.useFakeTimers();
    const bytes = new Uint8Array(100_000).map((_, index) => index % 251);
    const { upstream } = start(bytes, { chunkBytes: 32_768 });
    upstream.open();

    expect(upstream.messages[0]).toMatchObject({ api_key: KEY, model: "stt-async-v5", audio_format: "auto", language_hints: ["ru"] });
    const chunks = audioChunks(upstream);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([32_768, 32_768, 32_768, 1_696]);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    expect(upstream.sent.at(-1)).toBe("");
  });

  it("возвращает итоговый текст, когда Soniox закончил", async () => {
    const { result, upstream } = start(new Uint8Array([1, 2, 3]));
    upstream.open();
    upstream.receive({ tokens: [{ text: "Привет", is_final: true }, { text: ", ми", is_final: false }] });
    upstream.receive({ tokens: [{ text: ", мир", is_final: true }] });
    upstream.receive({ tokens: [], finished: true });
    upstream.drop(1000);

    await expect(result).resolves.toBe("Привет, мир");
    expect(upstream.closed).toBe(true);
  });

  it("пустой файл — ошибка сразу, без соединения", async () => {
    FakeUpstream.instances = [];
    const { result } = start(new Uint8Array());
    await expect(result).rejects.toThrow(/пуст/);
  });

  it("ошибка Soniox — отказ с её текстом, ключ не попадает в сообщение", async () => {
    const { result, upstream } = start(new Uint8Array([1, 2, 3]));
    upstream.open();
    upstream.receive({ error_code: 400, error_message: `Bad audio for ${KEY}` });

    await expect(result).rejects.toThrow(/400/);
    await expect(result).rejects.not.toThrow(KEY);
    expect(upstream.closed).toBe(true);
  });

  it("обрыв соединения — отказ", async () => {
    const { result, upstream } = start(new Uint8Array([1, 2, 3]));
    upstream.open();
    upstream.drop(1006);
    await expect(result).rejects.toThrow(/dropped/);
  });

  it("Soniox не ответил вовремя — отказ", async () => {
    vi.useFakeTimers();
    const { result } = start(new Uint8Array([1, 2, 3]), { connectTimeoutMs: 1000 });
    const rejected = expect(result).rejects.toThrow(/failed/);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
  });
});
