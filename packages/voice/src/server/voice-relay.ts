import type { SonioxContext } from "../soniox-messages";
import { DEFAULT_POLISH_RATE_LIMIT, createAccessGuard, createRateLimiter, refusal, resolveMainKey } from "./access";
import type { AccessOptions, RateLimit } from "./access";
import { assertPlatformWebSocket } from "./platform-websocket";
import { createTextPolisher } from "./polish";
import type { PolishOptions } from "./polish";
import { createSonioxSession } from "./soniox-session";
import type { SonioxAudioFormat, SonioxCloseReason, UpstreamSocket } from "./soniox-session";

/** Коды закрытия соединения браузера, по которым он понимает, что случилось. */
export const RELAY_CLOSE = {
  normal: 1000,
  protocol: 4400,
  unauthorized: 4401,
  timeLimit: 4408,
  rateLimited: 4429,
  upstream: 4502,
} as const;

export interface VoiceRelayOptions {
  /** Тот же вход, что у чата: нет пользователя — соединение не принимается. */
  resolveUser: AccessOptions["resolveUser"];
  /** Главный ключ Soniox. Не задан — `env.SONIOX_API_KEY`. Дальше сервера он не уходит. */
  apiKey?: string;
  env?: Record<string, string | undefined>;
  /** Адрес WebSocket Soniox, к которому подключается сервер. С российского сервера — адрес прокси. */
  websocketUrl?: string;
  /** Заголовки к соединению с Soniox (например, `X-Proxy-Token` прокси). */
  upstreamHeaders?: Record<string, string>;
  model?: string;
  languageHints?: string[];
  context?: SonioxContext;
  /** Самая долгая диктовка, секунд. По умолчанию 300. */
  maxSessionSeconds?: number;
  /** Сколько ждать соединения с Soniox, мс. По умолчанию 10 000. */
  upstreamConnectTimeoutMs?: number;
  /**
   * Чистка надиктованного текста моделью после «стоп» (убрать «э-э» и повторы, расставить знаки). Не задана — чистки нет.
   * Сервер сам копит текст от Soniox и сам зовёт модель: ключ модели и текст дальше сервера не уходят.
   * Лимиты расходов (`packages/limits`) чистку не учитывают.
   */
  polish?: PolishOptions;
  /** Сколько сессий диктовки один пользователь может начать за окно. По умолчанию 10 в минуту; `false` — без ограничения. */
  rateLimit?: RateLimit | false;
  /**
   * Сколько чисток текста моделью один пользователь может получить за окно. По умолчанию 6 в минуту; `false` — без ограничения.
   * Не зависит от `rateLimit`. Сверх лимита текст остаётся как сказал Soniox, без ошибки.
   */
  polishRateLimit?: RateLimit | false;
  /** Сколько соединений одновременно может держать один пользователь. По умолчанию 2; `false` — без ограничения. */
  maxConnectionsPerUser?: number | false;
  /**
   * Чужие страницы, которым можно пользоваться голосом с куками человека, например `["https://school.getcourse.ru"]`.
   * Своя страница проходит всегда; запрос с чужой — ответ 403 `forbidden_origin`. Запрос не из браузера проходит.
   */
  allowedOrigins?: string[];
  now?: () => number;
  logError?: (message: string) => void;
  /** Как соединиться с Soniox; по умолчанию WebSocket платформы (Node 22+) с заголовками. Для тестов. */
  connectUpstream?: (url: string, headers: Record<string, string>) => UpstreamSocket;
}

/** Соединение браузера с сервером приложения: как его отдаёт вебсокет вашего фреймворка. */
export interface RelayClientSocket {
  send(data: string): void;
  close(code: number, reason?: string): void;
}

export interface RelayConnection {
  /** Сообщение браузера: приветствие (текст JSON), кусок звука, `{"type":"finalize"}` или пустой текст — конец звука. */
  receive(data: string | ArrayBuffer | Uint8Array): void;
  /** Браузер закрыл соединение. */
  closed(): void;
}

export type RelayAccess = { user: { id: string } } | { refusal: Response };

export interface VoiceRelay {
  /** До подъёма WebSocket: допуск пользователя или готовый отказ (401, 429, 503). */
  authorize(request: Request): Promise<RelayAccess>;
  /** Соединение браузера принято: дальше звук идёт в Soniox, слова возвращаются. */
  accept(client: RelayClientSocket, user: { id: string }): RelayConnection;
}

const DEFAULT_MAX_CONNECTIONS_PER_USER = 2;
const DEFAULT_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const DEFAULT_MODEL = "stt-rt-v5";
const CLOSE_CODE_BY_REASON: Record<SonioxCloseReason, number> = {
  finished: RELAY_CLOSE.normal,
  failed: RELAY_CLOSE.upstream,
  dropped: RELAY_CLOSE.upstream,
  time_limit: RELAY_CLOSE.timeLimit,
};

/** Приветствие браузера: только известные форматы звука, без чужих полей. */
function parseHello(text: string): SonioxAudioFormat | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { audio_format: format, sample_rate: sampleRate, num_channels: channels } = parsed as Record<string, unknown>;
  if (format === "auto") return { audio_format: "auto" };
  if (format === "pcm_s16le") {
    const validRate = typeof sampleRate === "number" && Number.isInteger(sampleRate) && sampleRate >= 8000 && sampleRate <= 48000;
    if (!validRate || (channels !== 1 && channels !== 2)) return null;
    return { audio_format: format, sample_rate: sampleRate, num_channels: channels };
  }
  return null;
}

/** Команда браузера «закрепи всё сказанное» — единственное служебное сообщение, кроме приветствия и конца звука. */
function isFinalizeCommand(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { type?: unknown };
    return typeof parsed === "object" && parsed !== null && Object.keys(parsed).length === 1 && parsed.type === "finalize";
  } catch {
    return false;
  }
}

/**
 * Режим «звук через наш сервер» (contracts/voice.md): браузер шлёт звук по WebSocket на сервер приложения,
 * сервер пересылает его в Soniox со своим ключом и возвращает слова. Нужен там, где браузер не достаёт до Soniox
 * (из России), потому что сервер ходит через прокси. Фреймворк-независим: вебсокет поднимает приложение.
 */
export function createVoiceRelay(options: VoiceRelayOptions): VoiceRelay {
  if (!options.connectUpstream) assertPlatformWebSocket("Голосовому серверу (createVoiceRelay)");
  const logError = options.logError ?? ((message: string) => console.error(message));
  const maxSessionSeconds = options.maxSessionSeconds ?? 300;
  const polisher = options.polish ? createTextPolisher(options.polish, logError) : null;
  const polishLimit = options.polishRateLimit === undefined ? DEFAULT_POLISH_RATE_LIMIT : options.polishRateLimit;
  const polishLimiter = polishLimit ? createRateLimiter(polishLimit, options.now ?? Date.now) : null;
  const maxConnections = options.maxConnectionsPerUser === undefined ? DEFAULT_MAX_CONNECTIONS_PER_USER : options.maxConnectionsPerUser;
  /** Открытые соединения по пользователям: память процесса, как и остальное состояние модуля. */
  const openConnections = new Map<string, number>();
  const hasRoom = (userId: string) => maxConnections === false || (openConnections.get(userId) ?? 0) < maxConnections;
  const guard = createAccessGuard({
    resolveUser: options.resolveUser,
    allowedOrigins: options.allowedOrigins,
    apiKey: options.apiKey,
    env: options.env,
    rateLimit: options.rateLimit,
    now: options.now,
    logError,
  });

  return {
    async authorize(request) {
      const access = await guard(request);
      if ("refusal" in access) return access;
      if (!hasRoom(access.user.id)) return { refusal: refusal(429, "rate_limited") };
      return { user: access.user };
    },

    accept(client, user) {
      // Два подъёма могли пройти допуск до того, как первый принят: предел держим и здесь.
      if (!hasRoom(user.id)) {
        client.close(RELAY_CLOSE.rateLimited);
        return { receive: () => undefined, closed: () => undefined };
      }
      openConnections.set(user.id, (openConnections.get(user.id) ?? 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const left = (openConnections.get(user.id) ?? 1) - 1;
        if (left > 0) openConnections.set(user.id, left);
        else openConnections.delete(user.id);
      };
      let hello: SonioxAudioFormat | null = null;
      let ready = false;
      let ended = false;
      let finalizeRequested = false;
      let polishStarted = false;
      let polishing = false;
      /** Soniox закончил, пока шла чистка: закрываем браузера, когда чистка ответит. */
      let closeAfterPolish: number | undefined;

      /** Закрывает обоих один раз; таймеры и соединение с Soniox не остаются висеть. */
      function end(code: number) {
        if (ended) return;
        ended = true;
        release();
        client.close(code);
        session.close();
      }

      const session = createSonioxSession(
        {
          apiKey: resolveMainKey(options) ?? "",
          model: options.model ?? DEFAULT_MODEL,
          languageHints: options.languageHints ?? ["ru"],
          context: options.context,
          websocketUrl: options.websocketUrl ?? DEFAULT_WEBSOCKET_URL,
          headers: options.upstreamHeaders,
          connectTimeoutMs: options.upstreamConnectTimeoutMs,
          maxSessionSeconds,
          logError,
          connectUpstream: options.connectUpstream,
        },
        {
          onReady() {
            ready = true;
            client.send(JSON.stringify({ ready: true, max_session_seconds: maxSessionSeconds, ...(polisher ? { polish: true } : {}) }));
          },
          onMessage(raw, event) {
            if (ended) return;
            client.send(raw);
            // Чистим только после нашей команды «закрепи всё» и только раз: метку <fin> браузер сам вызвать не может.
            if (polisher && event.type === "text" && event.finalized && finalizeRequested && !polishStarted) {
              polishStarted = true;
              void polish(polisher, event.text.finalText);
            }
          },
          onClosed(reason) {
            const code = CLOSE_CODE_BY_REASON[reason];
            if (polishing && reason === "finished") closeAfterPolish = code;
            else end(code);
          },
        },
      );

      function withinPolishLimit(): boolean {
        if (!polishLimiter || polishLimiter.take(user.id) === null) return true;
        logError("Голос: чистка пропущена, превышен лимит чисток на пользователя");
        return false;
      }

      /** Чистка закреплённого текста: результат или `null` («оставь как есть») уходит браузеру, если он ещё тут. */
      async function polish(clean: (text: string) => Promise<string | null>, text: string) {
        polishing = true;
        const polished = text.trim() && withinPolishLimit() ? await clean(text) : null;
        polishing = false;
        if (ended) return;
        client.send(JSON.stringify({ polished: { text: polished } }));
        if (closeAfterPolish !== undefined) end(closeAfterPolish);
      }

      return {
        receive(data) {
          if (ended) return;
          if (!hello) {
            hello = typeof data === "string" ? parseHello(data) : null;
            if (!hello) return end(RELAY_CLOSE.protocol);
            return session.begin(hello);
          }
          // До «готово» браузер звук не шлёт; приветствие второй раз тоже не принимаем.
          if (!ready) return end(RELAY_CLOSE.protocol);
          if (typeof data !== "string") return session.sendAudio(data instanceof Uint8Array ? data : new Uint8Array(data));
          if (data === "") return session.endAudio();
          if (isFinalizeCommand(data)) {
            finalizeRequested = true;
            return session.finalize();
          }
          end(RELAY_CLOSE.protocol);
        },
        closed() {
          if (ended) return;
          ended = true;
          release();
          session.close();
        },
      };
    },
  };
}
