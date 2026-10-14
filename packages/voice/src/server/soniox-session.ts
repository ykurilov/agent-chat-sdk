import { buildFinalizeMessage, buildStartMessage, createTranscript } from "../soniox-messages";
import type { DictatedText, SonioxContext, SonioxEvent } from "../soniox-messages";

/** Что сервер знает о соединении с Soniox. */
export interface UpstreamSocket {
  readyState: number;
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", handler: (event: never) => void): void;
}

/** Формат звука в первом сообщении: `auto` (Soniox определяет контейнер сам) или сырой PCM с частотой и числом каналов. */
export type SonioxAudioFormat =
  | { audio_format: "auto" }
  | { audio_format: "pcm_s16le"; sample_rate: number; num_channels: number };

export interface SonioxSessionOptions {
  /** Главный ключ Soniox: дальше сервера он не уходит и из ответов вычищается. */
  apiKey: string;
  model: string;
  languageHints: string[];
  context?: SonioxContext | undefined;
  /** Адрес WebSocket Soniox. С российского сервера — адрес прокси. */
  websocketUrl: string;
  /** Заголовки к соединению с Soniox (например, `X-Proxy-Token` прокси). */
  headers?: Record<string, string> | undefined;
  /** Сколько ждать соединения, мс. По умолчанию 10 000. */
  connectTimeoutMs?: number | undefined;
  /** Самая долгая сессия, секунд, от «готово». Без значения — без своего предела. */
  maxSessionSeconds?: number | undefined;
  /** Уровень задержки конца фразы Soniox (`endpoint_latency_adjustment_level`). Не задан — по умолчанию Soniox. */
  endpointLatencyLevel?: number | undefined;
  /** Самая долгая пауза до конца фразы, мс (`max_endpoint_delay_ms`). Не задан — по умолчанию Soniox. */
  maxEndpointDelayMs?: number | undefined;
  /** Выдавать закончившиеся фразы (`endedPhrases` в событиях). Нужно голосовому диалогу. */
  phraseEnds?: boolean | undefined;
  /**
   * Держать соединение в тишине: Soniox закрывает сессию без звука, поэтому раз в 15 секунд (или `intervalMs`) без звука
   * уходит `{"type":"keepalive"}`. Не задан — не посылать.
   */
  keepalive?: boolean | { intervalMs: number } | undefined;
  logError: (message: string) => void;
  /** Как соединиться; по умолчанию WebSocket платформы (Node 22+) с заголовками. Для тестов. */
  connectUpstream?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
}

/** Почему сессия закончилась сама (закрытие владельцем через `close()` сюда не попадает). */
export type SonioxCloseReason =
  /** Soniox дослал всё и закрыл соединение: обычный конец. */
  | "finished"
  /** Не соединились с Soniox или он не ответил вовремя. */
  | "failed"
  /** Soniox оборвал соединение посреди работы. */
  | "dropped"
  /** Вышел `maxSessionSeconds`. */
  | "time_limit";

export interface SonioxSessionEvents {
  /** Первое сообщение отправлено, звук принимается. */
  onReady(): void;
  /** Ответ Soniox: исходный текст без главного ключа и его разбор. */
  onMessage(raw: string, event: SonioxEvent): void;
  onClosed(reason: SonioxCloseReason): void;
}

/**
 * Сессия Soniox на стороне сервера: соединение со своим ключом, первое сообщение, звук, «закрепи всё» (`finalize`),
 * конец звука и разбор ответов. Ничего не знает ни о браузере, ни о поле ввода: ретранслятор диктовки и будущий
 * голосовой режим надстраиваются над ней.
 */
export interface SonioxSession {
  /**
   * Начать: как только соединение открыто, уходит первое сообщение с настройками и форматом звука. `languageHints` —
   * язык этой записи вместо заданного при создании (уже проверенный).
   */
  begin(audio: SonioxAudioFormat, overrides?: { languageHints?: string[] }): void;
  sendAudio(chunk: Uint8Array): void;
  /** Закрепить всё сказанное: закреплённые слова и метка `<fin>` придут ответом; соединение остаётся. */
  finalize(): void;
  /** Звука больше не будет: Soniox закрепит остаток и пришлёт `finished`. */
  endAudio(): void;
  /** Что сказано с начала сессии по ответам Soniox. */
  text(): DictatedText;
  /** Закрыть соединение и снять таймеры. После этого сессия молчит: ни команд, ни событий. Повторный вызов безвреден. */
  close(): void;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** Soniox закрывает сессию, если ≈20 секунд нет ни звука, ни keepalive. */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000;
const WEBSOCKET_OPEN = 1;
const NORMAL_CLOSE = 1000;

function connectWithPlatformWebSocket(url: string, headers: Record<string, string>): UpstreamSocket {
  // WebSocket платформы (undici) принимает заголовки вторым параметром; в типах браузера этого нет.
  const Socket = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => UpstreamSocket;
  return new Socket(url, { headers });
}

export function createSonioxSession(options: SonioxSessionOptions, events: SonioxSessionEvents): SonioxSession {
  const { apiKey, logError } = options;
  const upstream = (options.connectUpstream ?? connectWithPlatformWebSocket)(options.websocketUrl, options.headers ?? {});
  const transcript = createTranscript({ phraseEnds: options.phraseEnds });
  let audio: SonioxAudioFormat | null = null;
  let upstreamOpen = false;
  let ready = false;
  let finished = false;
  let ended = false;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let keepaliveTimer: ReturnType<typeof setTimeout> | undefined;
  const keepaliveIntervalMs =
    typeof options.keepalive === "object" ? options.keepalive.intervalMs : options.keepalive ? DEFAULT_KEEPALIVE_INTERVAL_MS : undefined;

  /** Закрывает один раз; таймеры и соединение не остаются висеть. `reason` — что сказать владельцу (`null` — он закрыл сам). */
  function end(reason: SonioxCloseReason | null) {
    if (ended) return;
    ended = true;
    clearTimeout(connectTimer);
    clearTimeout(limitTimer);
    clearTimeout(keepaliveTimer);
    upstream.close();
    if (reason) events.onClosed(reason);
  }

  const connectTimer = setTimeout(() => {
    logError("Голос: Soniox не ответил вовремя");
    end("failed");
  }, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

  /** Тишина длится с этого момента: звук или keepalive отодвигают следующий keepalive. */
  function armKeepalive() {
    if (keepaliveIntervalMs === undefined || ended) return;
    clearTimeout(keepaliveTimer);
    keepaliveTimer = setTimeout(() => {
      if (!canSend()) return;
      upstream.send(JSON.stringify({ type: "keepalive" }));
      armKeepalive();
    }, keepaliveIntervalMs);
  }

  let languageHints: string[] | undefined;

  function startIfReady() {
    if (!audio || !upstreamOpen || ready || ended) return;
    ready = true;
    clearTimeout(connectTimer);
    upstream.send(
      JSON.stringify({
        ...buildStartMessage({
          apiKey,
          model: options.model,
          languageHints: languageHints ?? options.languageHints,
          context: options.context,
          endpointLatencyLevel: options.endpointLatencyLevel,
          maxEndpointDelayMs: options.maxEndpointDelayMs,
        }),
        ...audio,
      }),
    );
    if (options.maxSessionSeconds !== undefined) limitTimer = setTimeout(() => end("time_limit"), options.maxSessionSeconds * 1000);
    armKeepalive();
    events.onReady();
  }

  const canSend = () => ready && !ended && upstream.readyState === WEBSOCKET_OPEN;

  upstream.addEventListener("open", () => {
    upstreamOpen = true;
    startIfReady();
  });
  upstream.addEventListener("message", ((message: { data: unknown }) => {
    if (ended || typeof message.data !== "string") return;
    const event = transcript.accept(message.data);
    if (event.type === "finished") finished = true;
    // Пустой ключ заменять нельзя: `replaceAll("", …)` вставил бы замену между всеми знаками.
    events.onMessage(apiKey ? message.data.replaceAll(apiKey, "***") : message.data, event);
  }) as (event: never) => void);
  upstream.addEventListener("error", () => {
    if (ended) return;
    logError("Голос: ошибка соединения с Soniox");
    end("failed");
  });
  upstream.addEventListener("close", ((closing: { code?: number }) => {
    if (ended) return;
    const normal = finished || closing.code === NORMAL_CLOSE;
    if (!normal) logError(`Голос: Soniox оборвал соединение (код ${closing.code ?? "?"})`);
    end(normal ? "finished" : "dropped");
  }) as (event: never) => void);

  return {
    begin(format, overrides) {
      audio = format;
      languageHints = overrides?.languageHints;
      startIfReady();
    },
    sendAudio(chunk) {
      if (!canSend()) return;
      upstream.send(chunk);
      armKeepalive();
    },
    finalize() {
      if (canSend()) upstream.send(JSON.stringify(buildFinalizeMessage()));
    },
    endAudio() {
      if (canSend()) upstream.send("");
    },
    text: transcript.current,
    close: () => end(null),
  };
}
