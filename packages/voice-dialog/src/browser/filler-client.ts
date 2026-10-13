import { SPEECH_SAMPLE_RATE } from "../protocol";
import type { FillerCategory, FillerManifest, FillerManifestPhrase } from "../protocol";
import type { FillerPhrase } from "./filler-scheduler";

export interface FillerClientOptions {
  /** Общий путь режима, например `/api/voice-dialog`. */
  basePath: string;
  fetch?: typeof fetch;
  /** Сколько фраз качается разом. По умолчанию 3, как и синтезов на сервере. */
  maxParallel?: number;
}

export interface FillerClient {
  /**
   * Подгрузить фразы голоса: список и звук. Уже загруженное и идущее не качается заново; что не вышло, догружается при следующем вызове.
   * Не бросает ошибок: заполнитель не загрузился — его просто не будет.
   */
  load(voiceId: string, chatId: string): Promise<void>;
  /** Загруженные фразы вида этого голоса. */
  phrases(voiceId: string, category: FillerCategory): readonly FillerPhrase[];
  /** Звук загруженной фразы (PCM s16le 24 кГц). */
  audio(voiceId: string, phraseId: string): Uint8Array | undefined;
}

const DEFAULT_MAX_PARALLEL = 3;
const BYTES_PER_SAMPLE = 2;

function isManifest(value: unknown): value is FillerManifest {
  if (typeof value !== "object" || value === null) return false;
  const { phrases } = value as Partial<FillerManifest>;
  return Array.isArray(phrases) && phrases.every((phrase) => typeof phrase?.id === "string" && typeof phrase?.category === "string" && typeof phrase?.text === "string");
}

/** Сначала по одной фразе каждого вида, потом вторые: к первому заполнителю успевают звуки всех видов. */
function roundRobin(phrases: FillerManifestPhrase[]): FillerManifestPhrase[] {
  const byCategory = new Map<string, FillerManifestPhrase[]>();
  for (const phrase of phrases) byCategory.set(phrase.category, [...(byCategory.get(phrase.category) ?? []), phrase]);
  const lists = [...byCategory.values()];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_, round) => lists.flatMap((list) => list[round] ?? [])).flat();
}

/** Звук фраз-заполнителей по голосам: список с сервера, потом PCM каждой фразы; всё хранится в памяти страницы. */
export function createFillerClient(options: FillerClientOptions): FillerClient {
  const base = options.basePath.replace(/\/+$/, "");
  const request = (input: string) => (options.fetch ?? globalThis.fetch)(input);
  const maxParallel = options.maxParallel ?? DEFAULT_MAX_PARALLEL;

  let manifest: Promise<FillerManifestPhrase[] | null> | null = null;
  /** Сервер сказал, что заполнителей у него нет: больше не спрашиваем. */
  let absent = false;
  const loaded = new Map<string, Map<string, { phrase: FillerPhrase; pcm: Uint8Array }>>();
  const inFlight = new Map<string, Promise<void>>();

  function loadManifest(): Promise<FillerManifestPhrase[] | null> {
    manifest ??= (async () => {
      try {
        const response = await request(`${base}/fillers`);
        if (response.status === 404) {
          absent = true;
          return null;
        }
        if (!response.ok) return null;
        const body: unknown = await response.json();
        return isManifest(body) ? roundRobin(body.phrases) : null;
      } catch {
        return null;
      }
    })().then((phrases) => {
      // Сбой списка не запоминается: следующий вызов спросит заново.
      if (phrases === null) manifest = null;
      return phrases;
    });
    return manifest;
  }

  async function loadPhrase(phrase: FillerManifestPhrase, voiceId: string, chatId: string): Promise<void> {
    const key = `${voiceId}\n${phrase.id}`;
    const running = inFlight.get(key);
    if (running) return running;
    const started = (async () => {
      try {
        const query = `voiceId=${encodeURIComponent(voiceId)}&chatId=${encodeURIComponent(chatId)}`;
        const response = await request(`${base}/fillers/${encodeURIComponent(phrase.id)}?${query}`);
        if (!response.ok) return;
        const pcm = new Uint8Array(await response.arrayBuffer());
        const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
        if (samples === 0) return;
        const byId = loaded.get(voiceId) ?? new Map<string, { phrase: FillerPhrase; pcm: Uint8Array }>();
        loaded.set(voiceId, byId);
        const durationMs = (samples / SPEECH_SAMPLE_RATE) * 1000;
        byId.set(phrase.id, { phrase: { id: phrase.id, category: phrase.category as FillerCategory, text: phrase.text, durationMs }, pcm });
      } catch {
        // не загрузилась — этой фразы не будет
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, started);
    return started;
  }

  return {
    async load(voiceId, chatId) {
      if (absent) return;
      const phrases = await loadManifest();
      if (!phrases) return;
      const queue = phrases.filter((phrase) => !loaded.get(voiceId)?.has(phrase.id));
      const worker = async () => {
        for (let phrase = queue.shift(); phrase; phrase = queue.shift()) await loadPhrase(phrase, voiceId, chatId);
      };
      await Promise.all(Array.from({ length: Math.min(maxParallel, queue.length) }, worker));
    },

    phrases(voiceId, category) {
      return [...(loaded.get(voiceId)?.values() ?? [])].map((item) => item.phrase).filter((phrase) => phrase.category === category);
    },

    audio: (voiceId, phraseId) => loaded.get(voiceId)?.get(phraseId)?.pcm,
  };
}
