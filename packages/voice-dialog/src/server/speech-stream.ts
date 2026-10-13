import { stripVoiceTags } from "@ykurilov/agent-chat-core";
import type { UpstreamSocket } from "@ykurilov/agent-chat-voice/server";

export type SpeechModel = "eleven_v4_turbo" | "eleven_v4";

export interface SpeechStreamOptions {
  /** Ключ ElevenLabs: только в заголовке соединения, дальше сервера не уходит и в журнал не попадает. */
  apiKey: string;
  voiceId: string;
  model: string;
  language: string;
  /** Адрес ElevenLabs или прокси (http/https превращаются в ws/wss). По умолчанию `https://api.elevenlabs.io`. */
  baseUrl?: string | undefined;
  /** Заголовки к соединению (например, токен прокси). */
  headers?: Record<string, string> | undefined;
  /** Сколько ждать открытия соединения, мс. По умолчанию 10 000. */
  connectTimeoutMs?: number | undefined;
  logError: (message: string) => void;
  /** Как соединиться; по умолчанию WebSocket платформы (Node 22+) с заголовками. Для тестов. */
  connect?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
}

export interface SpeechStreamEvents {
  /** Кусок звука PCM s16le 24 кГц моно, как пришёл. */
  onAudio(chunk: Uint8Array): void;
  /** Озвучка реплики закончилась: весь звук получен. Один раз. */
  onDone(): void;
  /** Озвучки не будет или она оборвалась сама. Один раз; после этого поток молчит. */
  onFailed(): void;
}

/** Сколько озвучено к моменту обрыва: число знаков и хвост (последние ≈ 60 знаков) для цитаты на экране. */
export interface SpokenPosition {
  spokenChars: number;
  spokenTail: string;
}

/** Озвучка одной реплики: одно соединение с ElevenLabs (WebSocket диалога), предложения по одному. */
export interface SpeechStream {
  /** Очередное предложение. До открытия соединения ждёт; после конца, отказа или обрыва не делает ничего. */
  speak(text: string): void;
  /** Текст реплики закончился: ElevenLabs дошлёт остаток и закроет соединение после последнего звука. */
  finish(): void;
  /** Позиция по проигранному времени; звук и метки, пришедшие к этому моменту, уже учтены. Работает и после конца. */
  positionAt(playedMs: number): SpokenPosition;
  /** Обрыв: соединение закрывается сразу, дальнейшие события игнорируются; возвращает позицию по `playedMs`. */
  cut(playedMs: number): SpokenPosition;
  /** Знаков, реально отправленных в ElevenLabs: именно за них берётся плата. */
  readonly sentChars: number;
  /** Закрыть молча, без событий. */
  close(): void;
}

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DIALOG_PATH = "/v1/text-to-dialogue/stream-input";
const OUTPUT_FORMAT = "pcm_24000";
/** PCM s16le 24 кГц моно: 48 000 байт в секунду. */
const BYTES_PER_MS = 48;
const TAIL_CHARS = 60;
const WEBSOCKET_OPEN = 1;
const NORMAL_CLOSE = 1000;
const ERROR_LOG_LIMIT = 200;
/**
 * ElevenLabs закрывает соединение, если 20 секунд ничего не приходит (документация WebSocket диалога: `keep_alive` сбрасывает этот срок).
 * Модель может замолчать надолго посреди реплики (вызов инструмента): в паузе шлём `keep_alive` вдвое чаще срока.
 */
const KEEP_ALIVE_INTERVAL_MS = 10_000;

function connectWithPlatformWebSocket(url: string, headers: Record<string, string>): UpstreamSocket {
  // WebSocket платформы (undici) принимает заголовки вторым параметром; в типах браузера этого нет.
  const Socket = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => UpstreamSocket;
  return new Socket(url, { headers });
}

function dialogUrl(options: SpeechStreamOptions): string {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/^http/, "ws");
  const query = new URLSearchParams({
    model_id: options.model,
    output_format: OUTPUT_FORMAT,
    sync_alignment: "true",
    language_code: options.language,
  });
  return `${base}${DIALOG_PATH}?${query}`;
}

interface Alignment {
  chars?: unknown;
  char_start_times_ms?: unknown;
}

interface SpeechMessage {
  audio?: unknown;
  alignment?: Alignment;
  is_final?: unknown;
  error?: unknown;
  message?: unknown;
}

/** В тексте есть буквы или цифры, не считая тегов голоса. */
function hasSpeakableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(stripVoiceTags(text));
}

export function openSpeech(options: SpeechStreamOptions, events: SpeechStreamEvents): SpeechStream {
  const { apiKey, logError } = options;
  const socket = (options.connect ?? connectWithPlatformWebSocket)(dialogUrl(options), { ...options.headers, "xi-api-key": apiKey });
  const pending: string[] = [];
  let opened = false;
  let flushed = false;
  let finishing = false;
  let closeSent = false;
  /** Соединение больше не обслуживается: конец, отказ, обрыв нами или закрытие владельцем. События игнорируются. */
  let over = false;
  let sentChars = 0;
  let audioBytes = 0;
  const spoken: string[] = [];
  const startTimes: number[] = [];

  const redact = (text: string) => (apiKey ? text.replaceAll(apiKey, "***") : text).slice(0, ERROR_LOG_LIMIT);

  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  function shutDown() {
    over = true;
    clearTimeout(connectTimer);
    clearInterval(keepAliveTimer);
    socket.close();
  }

  function fail() {
    if (over) return;
    shutDown();
    events.onFailed();
  }

  function done() {
    if (over) return;
    shutDown();
    events.onDone();
  }

  const connectTimer = setTimeout(() => {
    logError("Озвучка: ElevenLabs не ответил вовремя");
    fail();
  }, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

  function sendSentence(text: string) {
    sentChars += text.length;
    socket.send(JSON.stringify({ inputs: [{ text, voice_id: options.voiceId }], ...(!flushed && { flush: true }) }));
    flushed = true;
  }

  function sendClose() {
    if (closeSent) return;
    closeSent = true;
    clearInterval(keepAliveTimer);
    socket.send(JSON.stringify({ close_socket: true }));
  }

  function keepConnectionAlive() {
    keepAliveTimer = setInterval(() => {
      if (over || closeSent || socket.readyState !== WEBSOCKET_OPEN) return;
      socket.send(JSON.stringify({ keep_alive: true }));
    }, KEEP_ALIVE_INTERVAL_MS);
    // Таймер паузы не должен держать процесс сервера.
    (keepAliveTimer as { unref?: () => void }).unref?.();
  }

  function takeAlignment(alignment: Alignment | undefined, chunkStartMs: number) {
    if (!alignment || !Array.isArray(alignment.chars) || !Array.isArray(alignment.char_start_times_ms)) return;
    const chars = alignment.chars as unknown[];
    const starts = alignment.char_start_times_ms as unknown[];
    for (let index = 0; index < chars.length; index += 1) {
      const start = starts[index];
      if (typeof chars[index] !== "string" || typeof start !== "number") continue;
      spoken.push(chars[index] as string);
      startTimes.push(chunkStartMs + start);
    }
  }

  function receive(raw: string) {
    let message: SpeechMessage;
    try {
      message = JSON.parse(raw) as SpeechMessage;
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    if (message.error !== undefined) {
      logError(`Озвучка: ElevenLabs вернул ошибку: ${redact(String(message.error))}`);
      fail();
      return;
    }
    if (typeof message.audio === "string" && message.audio.length > 0) {
      const chunk = new Uint8Array(Buffer.from(message.audio, "base64"));
      takeAlignment(message.alignment, audioBytes / BYTES_PER_MS);
      audioBytes += chunk.length;
      events.onAudio(chunk);
    }
    if (message.is_final === true) done();
  }

  socket.addEventListener("open", () => {
    if (over) return;
    opened = true;
    clearTimeout(connectTimer);
    socket.send(JSON.stringify({ voices: [options.voiceId] }));
    for (const text of pending.splice(0)) sendSentence(text);
    if (finishing) sendClose();
    else keepConnectionAlive();
  });
  socket.addEventListener("message", ((message: { data: unknown }) => {
    if (over || typeof message.data !== "string") return;
    receive(message.data);
  }) as (event: never) => void);
  socket.addEventListener("error", () => {
    if (over) return;
    logError("Озвучка: ошибка соединения с ElevenLabs");
    fail();
  });
  socket.addEventListener("close", ((closing: { code?: number }) => {
    if (over) return;
    if (finishing && closing.code === NORMAL_CLOSE) return done();
    logError(`Озвучка: ElevenLabs оборвал соединение (код ${closing.code ?? "?"})`);
    fail();
  }) as (event: never) => void);

  function positionAt(playedMs: number): SpokenPosition {
    let count = 0;
    while (count < startTimes.length && startTimes[count]! < playedMs) count += 1;
    // Хвост показывается человеку: теги голоса в нём лишние, а обрыв посреди тега не оставляет его обрывка.
    const tail = stripVoiceTags(spoken.slice(0, count).join(""), { partialTail: true });
    return { spokenChars: count, spokenTail: tail.slice(-TAIL_CHARS).trimEnd() };
  }

  return {
    speak(text) {
      const sentence = text.trim();
      // Текст из одних тегов («[sighs]») ElevenLabs отвергает (input_text_empty, код 1008) и обрывает всю реплику.
      if (over || finishing || !hasSpeakableText(sentence)) return;
      // Предложения не склеиваются: каждое кончается пробелом.
      const piece = `${sentence} `;
      if (opened && socket.readyState === WEBSOCKET_OPEN) sendSentence(piece);
      else pending.push(piece);
    },
    finish() {
      if (over || finishing) return;
      finishing = true;
      if (opened) sendClose();
    },
    positionAt,
    cut(playedMs) {
      shutDown();
      return positionAt(playedMs);
    },
    get sentChars() {
      return sentChars;
    },
    close: shutDown,
  };
}
