import { HUMAN_SOUND_KINDS } from "../protocol";
import type { HumanSoundKind } from "../protocol";

/** Звук человека, найденный Scribe: вид и границы внутри отправленного звука (миллисекунды от его начала). */
export interface ScribeSound {
  kind: HumanSoundKind;
  startMs: number;
  endMs: number;
}

/**
 * Название звука у Scribe → наш вид. Название зависит от языка запроса: при `language_code=ru` Scribe пишет «[смешок]»,
 * без языка — «(laughter)»; поэтому знаем оба написания. Чужие звуки (шаги, музыка) вида не получают.
 */
const KIND_BY_NAME: Array<[RegExp, HumanSoundKind]> = [
  [/^(laugh|chuckl|giggl|смех|смеш|смея|хохот|хихик)/, "laughter"],
  [/^(sigh|вздох|вздых)/, "sigh"],
  [/^(cough|кашел|кашл|кхм)/, "cough"],
  [/^(sneez|чих|апчх)/, "sneeze"],
  [/^(gasp|резкийвдох|вдох|ахнул|ахан)/, "gasp"],
  [/^(cry|sob|weep|плач|рыда|всхлип)/, "crying"],
  [/^(yawn|зев)/, "yawn"],
  [/^(groan|стон|ворчан)/, "groan"],
];

function kindOfName(text: string): HumanSoundKind | null {
  const name = text.toLowerCase().replace(/[()[\]\s]/g, "");
  for (const [pattern, kind] of KIND_BY_NAME) if (pattern.test(name)) return kind;
  return null;
}

/** Из ответа Scribe берутся только звуки (`audio_event`) из нашего списка; слова распознавания не читаются вовсе. */
export function parseScribeSounds(body: unknown): ScribeSound[] {
  const words = typeof body === "object" && body !== null ? (body as { words?: unknown }).words : undefined;
  if (!Array.isArray(words)) return [];
  const sounds: ScribeSound[] = [];
  for (const word of words) {
    if (typeof word !== "object" || word === null) continue;
    const { type, text, start, end } = word as { type?: unknown; text?: unknown; start?: unknown; end?: unknown };
    if (type !== "audio_event" || typeof text !== "string") continue;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const kind = kindOfName(text);
    if (kind && HUMAN_SOUND_KINDS.includes(kind)) sounds.push({ kind, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
  }
  return sounds;
}

/** Звук микрофона (PCM s16le, моно) в WAV: Scribe принимает файл, а не сырой поток. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) wav[offset + index] = text.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

export interface ScribeSoundsOptions {
  apiKey: string;
  /** Модель Scribe: нужна только как детектор звуков. */
  model: string;
  language?: string | undefined;
  baseUrl?: string | undefined;
  /** Свои заголовки к запросу (например, `X-Proxy-Token` прокси); ключ ElevenLabs они не заменяют. */
  headers?: Record<string, string> | undefined;
  /** Дольше этого запрос обрывается. */
  timeoutMs: number;
  fetch?: typeof fetch | undefined;
}

/** Запрос оборван (не уложился во время или отменён снаружи) уже после отправки: ElevenLabs мог принять звук и списать. */
export class ScribeAbortedError extends Error {
  override readonly name = "ScribeAbortedError";
}

export interface ScribeSounds {
  /**
   * Звуки человека в куске звука; бросает при любом сбое (текст ошибки без ключа).
   * `onSent` вызывается, когда запрос со звуком уходит к Scribe: сбой после этого может стоить денег.
   */
  detect(pcm: Uint8Array, signal?: AbortSignal, onSent?: () => void): Promise<ScribeSound[]>;
}

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const SAMPLE_RATE = 16_000;

export function createScribeSounds(options: ScribeSoundsOptions): ScribeSounds {
  const doFetch = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/v1/speech-to-text`;

  return {
    async detect(pcm, signal, onSent) {
      const form = new FormData();
      form.set("model_id", options.model);
      form.set("tag_audio_events", "true");
      if (options.language) form.set("language_code", options.language);
      form.set("file", new File([pcmToWav(pcm, SAMPLE_RATE) as BlobPart], "speech.wav", { type: "audio/wav" }));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      const abortFromOutside = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener("abort", abortFromOutside, { once: true });
      try {
        let response: Awaited<ReturnType<typeof fetch>>;
        try {
          if (!controller.signal.aborted) onSent?.();
          response = await doFetch(url, { method: "POST", headers: { ...options.headers, "xi-api-key": options.apiKey }, body: form, signal: controller.signal });
        } catch (error) {
          // Текст исходной ошибки не пересказываем: в нём может оказаться адрес с ключом.
          if (controller.signal.aborted) throw new ScribeAbortedError("Scribe: запрос прерван или не уложился во время");
          throw new Error(`Scribe: запрос не удался (${error instanceof Error ? error.name : "ошибка"})`);
        }
        if (!response.ok) throw new Error(`Scribe: ответ ${response.status}`);
        return parseScribeSounds(await response.json());
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromOutside);
      }
    },
  };
}
