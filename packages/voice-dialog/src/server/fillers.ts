import { FILLER_CATEGORIES } from "../protocol";
import type { FillerCategory, FillerManifest, FillerManifestPhrase } from "../protocol";
import type { DialogSpeechConfig } from "./dialog-session";
import { openSpeech } from "./speech-stream";
import type { SpeechUsage } from "./speech-usage";

/** Короткие фразы, которыми голос заполняет паузу. Приложение может заменить любой вид своими (`fillerPhrases`). */
export const DEFAULT_FILLER_PHRASES: Record<FillerCategory, string[]> = {
  thinking: ["Хмм…", "Так…", "Дай-ка подумаю…"],
  reasoning: ["Секунду, дай-ка подумаю.", "Тут надо подумать."],
  web: ["Сейчас поищу в интернете.", "Гляну, что пишут."],
  page: ["Открываю страницу, читаю.", "Сейчас прочту, что там."],
  memory: ["Дай-ка вспомню.", "Загляну в наши прошлые разговоры."],
  tool: ["Сейчас гляну.", "Минутку, проверю."],
  long: ["Ещё чуть-чуть…", "Почти готово…"],
};

export type FillerAudioResult = { ok: true; pcm: Uint8Array } | { ok: false; reason: "unknown" | "limit" | "unavailable" };

export interface FillerLibraryOptions {
  /** Свои фразы по видам: вид из списка заменяет умолчание целиком, пустой список убирает вид. */
  phrases?: Partial<Record<FillerCategory, string[]>> | undefined;
  /** Настройка озвучки; `null` — озвучки нет (ключа нет). Спрашивается при каждом синтезе. */
  speech: () => DialogSpeechConfig | null;
  usage: SpeechUsage;
  /** Сколько синтезов идёт одновременно. По умолчанию 3: у ElevenLabs предел одновременных запросов зависит от тарифа. */
  maxParallel?: number | undefined;
  /** Сколько после сбоя не пробовать ту же фразу заново, мс. По умолчанию 30 000. */
  failureCooldownMs?: number | undefined;
  /** Сколько ждать звук одной фразы, мс. По умолчанию 15 000. */
  synthesisTimeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  logError: (message: string) => void;
}

/** Фразы-заполнители и их звук по голосам: синтез один раз на (голос, фраза), дальше — из памяти сервера. */
export interface FillerLibrary {
  manifest(): FillerManifest;
  /**
   * Звук фразы выбранным голосом (PCM s16le 24 кГц). Нового синтеза нет, пока звук в кэше; первый синтез проверяет лимит расходов
   * того, кто спросил, и пишет расход на него и его чат: см. README, раздел «Заполнители».
   */
  audio(request: { userId: string; chatId: string; voiceId: string; phraseId: string }): Promise<FillerAudioResult>;
}

const DEFAULT_MAX_PARALLEL = 3;
const DEFAULT_FAILURE_COOLDOWN_MS = 30_000;
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 15_000;

function buildManifest(custom: FillerLibraryOptions["phrases"]): FillerManifestPhrase[] {
  return FILLER_CATEGORIES.flatMap((category) => {
    const texts = custom?.[category] ?? DEFAULT_FILLER_PHRASES[category];
    return texts.filter((text) => text.trim().length > 0).map((text, index) => ({ id: `${category}-${index}`, category, text: text.trim() }));
  });
}

export function createFillerLibrary(options: FillerLibraryOptions): FillerLibrary {
  const { usage, logError } = options;
  const now = options.now ?? (() => Date.now());
  const maxParallel = options.maxParallel ?? DEFAULT_MAX_PARALLEL;
  const cooldownMs = options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;
  const timeoutMs = options.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;
  const phrases = buildManifest(options.phrases);
  const byId = new Map(phrases.map((phrase) => [phrase.id, phrase]));

  const cache = new Map<string, Uint8Array>();
  const inFlight = new Map<string, Promise<FillerAudioResult>>();
  const failedUntil = new Map<string, number>();
  const waiting: Array<() => void> = [];
  let running = 0;

  /** Место в очереди синтезов: не больше `maxParallel` соединений с ElevenLabs разом. */
  async function takeSlot(): Promise<void> {
    if (running < maxParallel) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function releaseSlot() {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }

  function synthesize(speech: DialogSpeechConfig, voiceId: string, text: string, owner: { userId: string; chatId: string }): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const chunks: Uint8Array[] = [];
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (pcm: Uint8Array | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stream.close();
        // Расход — за знаки, реально ушедшие в ElevenLabs, как у озвучки ответа.
        void usage.record({ ownerId: owner.userId, chatId: owner.chatId, messageId: null, chars: stream.sentChars });
        resolve(pcm);
      };
      const stream = openSpeech(
        { ...speech, voiceId, logError },
        {
          onAudio: (chunk) => void chunks.push(chunk),
          onDone() {
            const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            if (total === 0) return settle(null);
            const pcm = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
              pcm.set(chunk, offset);
              offset += chunk.length;
            }
            settle(pcm);
          },
          onFailed: () => settle(null),
        },
      );
      timer = setTimeout(() => {
        logError("Заполнители: ElevenLabs не успел озвучить фразу");
        settle(null);
      }, timeoutMs);
      stream.speak(text);
      stream.finish();
    });
  }

  async function produce(key: string, phrase: FillerManifestPhrase, request: { userId: string; chatId: string; voiceId: string }): Promise<FillerAudioResult> {
    const speech = options.speech();
    if (!speech) return { ok: false, reason: "unavailable" };
    if ((failedUntil.get(key) ?? 0) > now()) return { ok: false, reason: "unavailable" };
    const verdict = await usage.assertCanSpeak({ userId: request.userId, chatId: request.chatId });
    if (verdict !== "ok") return { ok: false, reason: verdict };
    await takeSlot();
    try {
      const pcm = await synthesize(speech, request.voiceId, phrase.text, request);
      if (!pcm) {
        failedUntil.set(key, now() + cooldownMs);
        return { ok: false, reason: "unavailable" };
      }
      cache.set(key, pcm);
      return { ok: true, pcm };
    } finally {
      releaseSlot();
    }
  }

  return {
    manifest: () => ({ phrases: phrases.map((phrase) => ({ ...phrase })) }),

    async audio(request) {
      const phrase = byId.get(request.phraseId);
      if (!phrase) return { ok: false, reason: "unknown" };
      const key = `${request.voiceId}\n${phrase.id}\n${phrase.text}`;
      const cached = cache.get(key);
      if (cached) return { ok: true, pcm: cached };
      const running = inFlight.get(key);
      if (running) return running;
      const started = produce(key, phrase, request).finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
  };
}
