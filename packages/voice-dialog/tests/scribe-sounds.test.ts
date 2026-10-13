import { describe, expect, it, vi } from "vitest";
import { VOICE_SOUNDS } from "@ykurilov/agent-chat-core";
import { HUMAN_SOUND_KINDS } from "../src/protocol";
import { createScribeSounds, parseScribeSounds, pcmToWav } from "../src/server/scribe-sounds";

const KEY = "eleven-secret-key-0123456789";

/** Ответ Scribe: слова человека и звуки (`audio_event`); слова нас не интересуют. */
const scribeBody = (...events: Array<{ text: string; start: number; end: number; type?: string }>) => ({
  language_code: "rus",
  text: "привет (laughter)",
  words: events.map((event) => ({ type: "audio_event", logprob: 0, ...event })),
});

describe("виды звука: список в голосовом пакете совпадает со списком ядра", () => {
  it("HUMAN_SOUND_KINDS равен VOICE_SOUNDS", () => {
    expect([...HUMAN_SOUND_KINDS]).toEqual([...VOICE_SOUNDS]);
  });
});

describe("parseScribeSounds: из ответа Scribe берутся только звуки", () => {
  it("audio_event «(laughter)» → смех с границами в миллисекундах", () => {
    expect(parseScribeSounds(scribeBody({ text: "(laughter)", start: 1.25, end: 2.5 }))).toEqual([{ kind: "laughter", startMs: 1250, endMs: 2500 }]);
  });

  it("слова (type: word) и пробелы не читаются, даже если похожи на звук", () => {
    const body = {
      words: [
        { type: "word", text: "(laughter)", start: 0, end: 1 },
        { type: "word", text: "ха-ха", start: 1, end: 2 },
        { type: "spacing", text: " ", start: 2, end: 2.1 },
      ],
    };
    expect(parseScribeSounds(body)).toEqual([]);
  });

  it.each([
    ["(laughter)", "laughter"],
    ["(laughs)", "laughter"],
    ["(chuckles)", "laughter"],
    ["(giggles)", "laughter"],
    ["(sigh)", "sigh"],
    ["(sighs)", "sigh"],
    ["(cough)", "cough"],
    ["(coughing)", "cough"],
    ["(sneeze)", "sneeze"],
    ["(gasp)", "gasp"],
    ["(gasps)", "gasp"],
    ["(crying)", "crying"],
    ["(sobbing)", "crying"],
    ["(yawn)", "yawn"],
    ["(yawning)", "yawn"],
    ["(groan)", "groan"],
    ["(groaning)", "groan"],
    ["(LAUGHTER)", "laughter"],
    ["[laughter]", "laughter"],
    ["laughter", "laughter"],
    // При language_code=ru Scribe называет звуки по-русски (снято живым вызовом: «[смешок]»).
    ["[смешок]", "laughter"],
    ["[смех]", "laughter"],
    ["[хохот]", "laughter"],
    ["[вздох]", "sigh"],
    ["[кашель]", "cough"],
    ["[чихание]", "sneeze"],
    ["[резкий вдох]", "gasp"],
    ["[плач]", "crying"],
    ["[зевок]", "yawn"],
    ["[стон]", "groan"],
  ])("название «%s» → %s", (text, kind) => {
    expect(parseScribeSounds(scribeBody({ text, start: 0, end: 1 }))).toEqual([{ kind, startMs: 0, endMs: 1000 }]);
  });

  it("живой ответ Scribe на смех с русским языком: звук «[смешок]» найден, слова рядом не читаются", () => {
    const live = {
      language_code: "rus",
      text: "[смешок] Ну вот, всё получилось. И я очень рад",
      words: [
        { type: "audio_event", text: "[смешок]", start: 0.06, end: 0.92 },
        { type: "spacing", text: " ", start: 0.92, end: 1.04 },
        { type: "word", text: "Ну", start: 1.04, end: 1.14 },
      ],
    };
    expect(parseScribeSounds(live)).toEqual([{ kind: "laughter", startMs: 60, endMs: 920 }]);
  });

  it("чужие звуки (шаги, музыка, аплодисменты) отбрасываются; порядок остальных сохраняется", () => {
    const events = [
      { text: "(footsteps)", start: 0, end: 1 },
      { text: "(sigh)", start: 1, end: 2 },
      { text: "(music)", start: 2, end: 3 },
      { text: "(laughter)", start: 3, end: 4 },
      { text: "(applause)", start: 4, end: 5 },
    ];
    expect(parseScribeSounds(scribeBody(...events)).map((sound) => sound.kind)).toEqual(["sigh", "laughter"]);
  });

  it("нет words, не объект, нет чисел во времени — пустой список, без исключений", () => {
    for (const body of [null, undefined, "строка", 5, [], {}, { words: "нет" }, { words: [null, 5, "x"] }, scribeBody({ text: "(laughter)", start: "a" as never, end: 1 })]) {
      expect(parseScribeSounds(body)).toEqual([]);
    }
  });

  it("слова с пропущенными start/end, но с названием звука: звук есть, времени нет → отбрасывается (не знаем, когда был)", () => {
    expect(parseScribeSounds({ words: [{ type: "audio_event", text: "(laughter)" }] })).toEqual([]);
  });
});

describe("pcmToWav: звук микрофона в WAV для Scribe", () => {
  it("заголовок RIFF/WAVE, 16 кГц, моно, 16 бит; длина данных сходится", () => {
    const pcm = new Uint8Array(32_000).fill(1);
    const wav = pcmToWav(pcm, 16_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (from: number, length: number) => String.fromCharCode(...wav.subarray(from, from + length));
    expect(wav.length).toBe(44 + 32_000);
    expect(text(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 32_000);
    expect(text(8, 8)).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(32_000);
    expect([...wav.subarray(44, 48)]).toEqual([1, 1, 1, 1]);
  });
});

function fetchReturning(response: { ok?: boolean; status?: number; body?: unknown }) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }));
}

describe("createScribeSounds: запрос к Scribe", () => {
  const pcm = new Uint8Array(64_000);

  it("POST {baseUrl}/v1/speech-to-text с ключом в заголовке, моделью, tag_audio_events и языком; звук — WAV-файлом", async () => {
    const fetch = fetchReturning({ body: scribeBody({ text: "(laughter)", start: 1, end: 2 }) });
    const scribe = createScribeSounds({ apiKey: KEY, model: "scribe_v2", language: "ru", baseUrl: "https://api.test", timeoutMs: 5000, fetch: fetch as never });

    const sounds = await scribe.detect(pcm);

    expect(sounds).toEqual([{ kind: "laughter", startMs: 1000, endMs: 2000 }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.test/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("true");
    expect(form.get("language_code")).toBe("ru");
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/wav");
    expect(file.size).toBe(44 + pcm.length);
  });

  it("через прокси: свои заголовки (X-Proxy-Token) идут вместе с ключом и не заменяют его", async () => {
    const fetch = fetchReturning({ body: {} });
    const scribe = createScribeSounds({
      apiKey: KEY,
      model: "scribe_v2",
      baseUrl: "https://proxy.example.com/elevenlabs",
      headers: { "X-Proxy-Token": "proxy-token-0123456789", "xi-api-key": "чужой" },
      timeoutMs: 5000,
      fetch: fetch as never,
    });

    await scribe.detect(pcm);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://proxy.example.com/elevenlabs/v1/speech-to-text");
    expect((init.headers as Record<string, string>)["X-Proxy-Token"]).toBe("proxy-token-0123456789");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
  });

  it("без языка поле language_code не посылается (Scribe определит сам); без baseUrl — api.elevenlabs.io", async () => {
    const fetch = fetchReturning({ body: {} });
    const scribe = createScribeSounds({ apiKey: KEY, model: "scribe_v2", timeoutMs: 5000, fetch: fetch as never });

    await scribe.detect(pcm);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init.body as FormData).has("language_code")).toBe(false);
  });

  it("ответ не 2xx — исключение без ключа в тексте", async () => {
    const scribe = createScribeSounds({ apiKey: KEY, model: "scribe_v2", timeoutMs: 5000, fetch: fetchReturning({ ok: false, status: 401 }) as never });
    const failure = await scribe.detect(pcm).catch((error: unknown) => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("401");
    expect((failure as Error).message).not.toContain(KEY);
  });

  it("сеть упала — исключение без ключа", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed ${KEY}`);
    });
    const scribe = createScribeSounds({ apiKey: KEY, model: "scribe_v2", timeoutMs: 5000, fetch: fetch as never });
    const failure = await scribe.detect(pcm).catch((error: unknown) => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(KEY);
  });

  it("отмена снаружи прерывает запрос: сигнал уходит в fetch", async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      seen.push(init.signal);
      return new Promise<never>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    const scribe = createScribeSounds({ apiKey: KEY, model: "scribe_v2", timeoutMs: 5000, fetch: fetch as never });
    const controller = new AbortController();

    const pending = scribe.detect(pcm, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(seen[0]?.aborted).toBe(true);
  });

  it("не отвечает дольше timeoutMs — запрос обрывается", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<never>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
      const scribe = createScribeSounds({ apiKey: KEY, model: "scribe_v2", timeoutMs: 3000, fetch: fetch as never });
      const pending = scribe.detect(pcm).catch((error: unknown) => error as Error);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await pending).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });
});
