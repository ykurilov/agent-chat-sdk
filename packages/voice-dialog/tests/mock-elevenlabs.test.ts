import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_MS_PER_CHAR, createMockElevenLabs } from "../../../apps/demo/server/mock-elevenlabs";
import { openSpeech } from "../src/server/speech-stream";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function speaking() {
  const audio: Uint8Array[] = [];
  const log = { done: 0, failed: 0 };
  const stream = openSpeech(
    { apiKey: "k", voiceId: "v", model: "eleven_v4_turbo", language: "ru", connect: () => createMockElevenLabs(), logError: () => {} },
    { onAudio: (chunk) => audio.push(chunk), onDone: () => (log.done += 1), onFailed: () => (log.failed += 1) },
  );
  return { stream, audio, log };
}

const totalBytes = (audio: Uint8Array[]) => audio.reduce((sum, chunk) => sum + chunk.length, 0);

describe("подмена ElevenLabs для демо и тестов", () => {
  it("на каждое предложение — короткие куски звука, длиной по числу знаков (PCM 24 кГц), и alignment, по которому считается позиция", () => {
    const { stream, audio, log } = speaking();
    vi.advanceTimersByTime(50);
    stream.speak("Привет, мир.");
    stream.finish();
    vi.advanceTimersByTime(2_000);
    const sent = stream.sentChars;
    expect(totalBytes(audio)).toBe(sent * MOCK_MS_PER_CHAR * 48);
    expect(audio.length).toBeGreaterThan(1);
    expect(log).toEqual({ done: 1, failed: 0 });
    // знак начинается через MOCK_MS_PER_CHAR после предыдущего: за 5 знаков — 5 × шаг
    expect(stream.positionAt(MOCK_MS_PER_CHAR * 5 - 1).spokenChars).toBe(5);
    expect(stream.positionAt(MOCK_MS_PER_CHAR * 5 + 1).spokenChars).toBe(6);
    expect(stream.positionAt(60_000).spokenChars).toBe(sent);
  });

  it("детерминирована: два прогона дают одинаковые байты", () => {
    const run = () => {
      const { stream, audio } = speaking();
      vi.advanceTimersByTime(50);
      stream.speak("Здравствуйте.");
      stream.finish();
      vi.advanceTimersByTime(2_000);
      return Buffer.concat(audio);
    };
    expect(run().equals(run())).toBe(true);
  });

  it("звук не тишина: есть ненулевые отсчёты", () => {
    const { stream, audio } = speaking();
    vi.advanceTimersByTime(50);
    stream.speak("Привет.");
    vi.advanceTimersByTime(2_000);
    expect(Buffer.concat(audio).some((byte) => byte !== 0)).toBe(true);
  });

  it("cut: после обрыва куски больше не приходят", () => {
    const { stream, audio } = speaking();
    vi.advanceTimersByTime(50);
    stream.speak("Очень длинное предложение для обрыва посреди звука.");
    vi.advanceTimersByTime(60);
    stream.cut(100);
    const before = audio.length;
    vi.advanceTimersByTime(5_000);
    expect(audio).toHaveLength(before);
  });
});
