import { assertPlatformWebSocket, createRateLimiter } from "@ykurilov/agent-chat-voice/server";
import type { RateLimit, SonioxContext, UpstreamSocket } from "@ykurilov/agent-chat-voice/server";
import { SpendingLimitReachedError, allowedUser } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ResolvedUser, SpendingLimits } from "@ykurilov/agent-chat-core";
import { DIALOG_CLOSE_CODES, parseClientCommand, parseStartMessage } from "../protocol";
import type { FillerCategory, ServerMessage } from "../protocol";
import { createDialogSession } from "./dialog-session";
import type { DialogSession, DialogSessionConfig, DialogSoundsConfig, DialogSpeechConfig } from "./dialog-session";
import { createFillerLibrary } from "./fillers";
import type { FillerLibrary } from "./fillers";
import { createSoundsUsage } from "./sounds-usage";
import type { SoundsUsage } from "./sounds-usage";
import { createSpeechUsage } from "./speech-usage";
import type { SpeechUsage } from "./speech-usage";
import { createVoiceCatalog } from "./voices";
import { createWindowBudget } from "./window-budget";
import type { DialogVoice, VoiceCatalog } from "./voices";

export type { DialogVoice };

/** Голоса: списком (каталог сделает режим сам) или готовым каталогом, который знает и чат (теги голоса для модели, FR-024). */
export type DialogVoiceChoice =
  | {
      /** Голоса приложения: человек выбирает из них. Хотя бы один. У голоса может быть свой набор тегов (`tags`). */
      voices: DialogVoice[];
      /** Голос, пока человек не выбрал; из списка. */
      defaultVoiceId: string;
      catalog?: undefined;
    }
  | {
      /** Каталог из `createVoiceCatalog`; тот же передают чату (`agent.voices`), чтобы пометки модели знали голос человека. */
      catalog: VoiceCatalog;
      voices?: undefined;
      defaultVoiceId?: undefined;
    };

export type DialogSpeechOptions = DialogVoiceChoice & {
  /** Модель озвучки. По умолчанию `eleven_v4_turbo`. */
  model?: "eleven_v4_turbo" | "eleven_v4" | undefined;
  /** Доллары за 1000 знаков; на используемую модель цена обязательна. */
  pricePerThousandChars: Record<string, number>;
  /** Ключ ElevenLabs. Не задан — `env.ELEVENLABS_API_KEY`; нет и его — озвучки нет, режим слушает и пишет. */
  apiKey?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  /** Адрес ElevenLabs или прокси. */
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  connectTimeoutMs?: number | undefined;
  /** Потолок знаков на реплику. По умолчанию 2000. */
  maxCharsPerReply?: number | undefined;
  /** Потолок знаков на минуту. По умолчанию 4000. */
  maxCharsPerMinute?: number | undefined;
  language?: string | undefined;
  /**
   * Фразы-заполнители («Хмм…», «Сейчас поищу…»): свои фразы по видам или `false` — заполнителей нет. Вид из списка заменяет
   * умолчание целиком. Звук фраз синтезируется один раз на голос и хранится в памяти сервера.
   */
  fillerPhrases?: Partial<Record<FillerCategory, string[]>> | false | undefined;
  /** Как соединиться; для тестов. */
  connect?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
};

/**
 * Звуки человека (смех, вздох): звук каждой фразы параллельно с распознаванием уходит в ElevenLabs Scribe, и модель узнаёт
 * о звуках пометкой в сообщении. Слова Scribe не использует: их по-прежнему даёт Soniox.
 */
export interface DialogSoundsOptions {
  /** Доллары за час звука, который уходит в Scribe; обязательна. Цену берите из прайса ElevenLabs для выбранной модели. */
  pricePerHour: number;
  /** Модель Scribe. По умолчанию `scribe_v2`. */
  model?: string | undefined;
  /** Ключ ElevenLabs. Не задан — `env.ELEVENLABS_API_KEY`; нет и его — звуки не ловятся, режим работает как раньше. */
  apiKey?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  /** Адрес ElevenLabs или прокси. */
  baseUrl?: string | undefined;
  /** Свои заголовки к запросу Scribe, например `{ "X-Proxy-Token": process.env.PROXY_TOKEN }`. */
  headers?: Record<string, string> | undefined;
  language?: string | undefined;
  /**
   * Сколько ждать на конце фразы ответ Scribe на хвост звука (и на куски, которые ещё не вернулись), мс. По умолчанию 1000:
   * по замеру Scribe отвечает на 1,5–2 с звука за 0,7–0,95 с. Не успел — звуки догонят отдельным сообщением и уйдут со следующей фразой.
   */
  waitMs?: number | undefined;
  /** Пока человек говорит, каждые столько секунд нового звука уходит в Scribe очередным куском. По умолчанию 1,5; `0` — звук уходит целиком на конце фразы. */
  chunkSeconds?: number | undefined;
  /** Сколько секунд прежнего звука повторяется в начале следующего куска (смех на стыке не разрезается). По умолчанию 0,5. */
  overlapSeconds?: number | undefined;
  /** Кусок тише этого (среднеквадратичный уровень от 0 до 1) считается тишиной и в Scribe не уходит. По умолчанию 0,01; `0` — не проверять. */
  silenceRms?: number | undefined;
  /** Сколько секунд звука уходит в Scribe за раз, не больше. По умолчанию 30. */
  maxWindowSeconds?: number | undefined;
  /** Дольше этого запрос к Scribe обрывается, мс. По умолчанию 5000. */
  timeoutMs?: number | undefined;
  /** Как звать Scribe; для тестов. */
  fetch?: typeof fetch | undefined;
}

export interface DialogRecognitionOptions {
  language?: string | undefined;
  model?: string | undefined;
  endpointLatencyLevel?: number | undefined;
  maxEndpointDelayMs?: number | undefined;
  /** Подсказка распознаванию: тема, термины, имена. Soniox берёт до 8000 токенов. */
  context?: SonioxContext | undefined;
  /** Главный ключ Soniox. Не задан — `env.SONIOX_API_KEY`. */
  apiKey?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  /** Адрес WebSocket Soniox или прокси. */
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  connectUpstream?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
}

export interface DialogRelayOptions {
  storage: ChatStorage;
  /** Тот же вход, что у чата: нет пользователя — доступа нет (4401). */
  resolveUser: (request: Request) => Promise<ResolvedUser>;
  spendingLimits?: SpendingLimits | undefined;
  /** Без настройки озвучки режим только слушает и пишет. */
  speech?: DialogSpeechOptions | undefined;
  recognition?: DialogRecognitionOptions | undefined;
  /** Звуки человека для модели. Не задано — звуки не ловятся. */
  sounds?: DialogSoundsOptions | undefined;
  /** Нет слов дольше этого — предупреждение, затем закрытие (4408). По умолчанию 180. */
  idleSeconds?: number | undefined;
  /** Самое долгое включение, секунд. По умолчанию 1800. */
  maxSessionSeconds?: number | undefined;
  /** Сколько раз человек может включить режим за окно. По умолчанию 10 в минуту; `false` — без ограничения. */
  rateLimit?: RateLimit | false | undefined;
  /** Одновременных включений на человека. По умолчанию 2; `false` — без ограничения. */
  maxConnectionsPerUser?: number | false | undefined;
  now?: (() => number) | undefined;
  logError: (message: string) => void;
}

/** Что ретранслятору нужно от сокета клиента. */
export interface DialogClientSocket {
  send(data: string | Uint8Array): void;
  close(code: number): void;
}

export interface DialogConnection {
  /** Сообщение клиента: текст (JSON) или кусок звука. Пока идёт допуск, сообщения ждут и обрабатываются по порядку. */
  receive(data: string | Uint8Array | ArrayBuffer): void;
  /** Клиент закрыл соединение или оно оборвалось. */
  closed(): void;
}

export interface DialogRelay {
  /**
   * Голоса приложения и выбор человека: единственный источник правды и для режима, и для HTTP (`mountDialogRelay` подключает
   * `GET …/voices`, `PUT …/voice` к этому же каталогу). `null` — озвучка не настроена.
   */
  readonly voices: VoiceCatalog | null;
  /** Заполнители и их звук (`GET …/fillers`). `null` — озвучки нет или заполнители выключены (`fillerPhrases: false`). */
  readonly fillers: FillerLibrary | null;
  /** Принять соединение: допуск решается здесь (пользователь, чат, лимит расходов, частота), отказ — закрытием с кодом. */
  accept(client: DialogClientSocket, request: Request): DialogConnection;
}

const DEFAULT_SPEECH_MODEL = "eleven_v4_turbo";
const DEFAULT_LANGUAGE = "ru";
const DEFAULT_RECOGNITION_MODEL = "stt-rt-v5";
const DEFAULT_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const DEFAULT_ENDPOINT_LATENCY_LEVEL = 2;
const DEFAULT_MAX_ENDPOINT_DELAY_MS = 1500;
const DEFAULT_SOUNDS_MODEL = "scribe_v2";
const DEFAULT_SOUNDS_WAIT_MS = 1000;
const DEFAULT_SOUNDS_CHUNK_SECONDS = 1.5;
const DEFAULT_SOUNDS_OVERLAP_SECONDS = 0.5;
const DEFAULT_SOUNDS_SILENCE_RMS = 0.01;
const DEFAULT_SOUNDS_WINDOW_SECONDS = 30;
const DEFAULT_SOUNDS_TIMEOUT_MS = 5000;
const DEFAULT_IDLE_SECONDS = 180;
const DEFAULT_MAX_SESSION_SECONDS = 1800;
const DEFAULT_MAX_CHARS_PER_REPLY = 2000;
const DEFAULT_MAX_CHARS_PER_MINUTE = 4000;
const DEFAULT_RATE_LIMIT: RateLimit = { maxSessions: 10, perSeconds: 60 };
const DEFAULT_MAX_CONNECTIONS = 2;
/** Код закрытия WebSocket «внутренний сбой сервера». */
const INTERNAL_ERROR_CLOSE = 1011;

/** Озвучки на сервере нет: сессия до неё не доходит, но зависимость нужна. */
const NO_SPEECH_USAGE: SpeechUsage = { assertCanSpeak: async () => "unavailable", record: async () => {} };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createDialogRelay(options: DialogRelayOptions): DialogRelay {
  if (!options.recognition?.connectUpstream || (options.speech && !options.speech.connect)) {
    assertPlatformWebSocket("Голосовому диалогу (createDialogRelay)");
  }
  const { storage, logError } = options;
  const now = options.now ?? (() => Date.now());
  const speechOptions = options.speech;
  let usage: SpeechUsage | null = null;
  // Каталог сам проверяет список голосов и голос по умолчанию: понятная ошибка при настройке, а не при первом включении.
  const catalog = speechOptions
    ? (speechOptions.catalog ??
      createVoiceCatalog({ voices: speechOptions.voices, defaultVoiceId: speechOptions.defaultVoiceId, storage, logError: (error) => logError(`Голос: сбой хранилища выбора голоса: ${describe(error)}`) }))
    : null;
  if (speechOptions) {
    usage = createSpeechUsage({
      storage,
      model: speechOptions.model ?? DEFAULT_SPEECH_MODEL,
      pricePerThousandChars: speechOptions.pricePerThousandChars,
      spendingLimits: options.spendingLimits,
      now,
      logError,
    });
  }
  const soundsOptions = options.sounds;
  // Цена проверяется при настройке: без неё расход звуков нечем считать.
  const soundsUsage: SoundsUsage | undefined = soundsOptions
    ? createSoundsUsage({ storage, model: soundsOptions.model ?? DEFAULT_SOUNDS_MODEL, pricePerHour: soundsOptions.pricePerHour, spendingLimits: options.spendingLimits, now, logError })
    : undefined;
  let soundsKeyMissingLogged = false;
  const limiter = options.rateLimit === false ? null : createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT, now);
  const maxConnections = options.maxConnectionsPerUser === false ? Infinity : (options.maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS);
  const connections = new Map<string, number>();
  // Потолок знаков озвучки в минуту — на человека, а не на соединение: иначе вкладки складываются.
  const minuteChars = createWindowBudget({ max: speechOptions?.maxCharsPerMinute ?? DEFAULT_MAX_CHARS_PER_MINUTE, windowMs: 60_000, now });
  let speechKeyMissingLogged = false;

  const speechKey = () => speechOptions?.apiKey ?? (speechOptions?.env ?? process.env).ELEVENLABS_API_KEY;
  const recognitionKey = () => options.recognition?.apiKey ?? (options.recognition?.env ?? process.env).SONIOX_API_KEY;

  /** Настройка озвучки для сессии; `null`, если озвучки на сервере нет. */
  function speechConfig(): DialogSpeechConfig | null {
    if (!speechOptions) return null;
    const apiKey = speechKey();
    if (!apiKey) {
      if (!speechKeyMissingLogged) {
        speechKeyMissingLogged = true;
        logError("Голос: не задан ключ ELEVENLABS_API_KEY, озвучки не будет");
      }
      return null;
    }
    return {
      apiKey,
      model: speechOptions.model ?? DEFAULT_SPEECH_MODEL,
      language: speechOptions.language ?? DEFAULT_LANGUAGE,
      baseUrl: speechOptions.baseUrl,
      headers: speechOptions.headers,
      connectTimeoutMs: speechOptions.connectTimeoutMs,
      connect: speechOptions.connect,
    };
  }

  /** Настройка звуков для сессии; `null`, если звуки не настроены или нет ключа. */
  function soundsConfig(): DialogSoundsConfig | null {
    if (!soundsOptions) return null;
    const apiKey = soundsOptions.apiKey ?? (soundsOptions.env ?? process.env).ELEVENLABS_API_KEY;
    if (!apiKey) {
      if (!soundsKeyMissingLogged) {
        soundsKeyMissingLogged = true;
        logError("Звуки: не задан ключ ELEVENLABS_API_KEY, звуки человека не ловятся");
      }
      return null;
    }
    return {
      apiKey,
      model: soundsOptions.model ?? DEFAULT_SOUNDS_MODEL,
      language: soundsOptions.language ?? DEFAULT_LANGUAGE,
      baseUrl: soundsOptions.baseUrl,
      headers: soundsOptions.headers,
      waitMs: soundsOptions.waitMs ?? DEFAULT_SOUNDS_WAIT_MS,
      chunkSeconds: soundsOptions.chunkSeconds ?? DEFAULT_SOUNDS_CHUNK_SECONDS,
      overlapSeconds: soundsOptions.overlapSeconds ?? DEFAULT_SOUNDS_OVERLAP_SECONDS,
      silenceRms: soundsOptions.silenceRms ?? DEFAULT_SOUNDS_SILENCE_RMS,
      maxWindowSeconds: soundsOptions.maxWindowSeconds ?? DEFAULT_SOUNDS_WINDOW_SECONDS,
      timeoutMs: soundsOptions.timeoutMs ?? DEFAULT_SOUNDS_TIMEOUT_MS,
      fetch: soundsOptions.fetch,
    };
  }

  const fillers =
    usage && speechOptions && speechOptions.fillerPhrases !== false
      ? createFillerLibrary({ phrases: speechOptions.fillerPhrases, speech: speechConfig, usage, now, logError })
      : null;

  return {
    voices: catalog,
    fillers,
    accept(client, request) {
      let session: DialogSession | null = null;
      let userId: string | null = null;
      let counted = false;
      let over = false;
      let started = false;
      let admittedChatId = "";

      const sendMessage = (message: ServerMessage) => client.send(JSON.stringify(message));

      function release() {
        if (!counted || userId === null) return;
        counted = false;
        const left = (connections.get(userId) ?? 1) - 1;
        if (left <= 0) connections.delete(userId);
        else connections.set(userId, left);
      }

      /** Отказ или конец по нашей причине: место освобождено, всё закрыто, клиент получает код. */
      function refuse(code: number, error?: ServerMessage) {
        if (over) return;
        over = true;
        release();
        session?.close();
        if (error) sendMessage(error);
        client.close(code);
      }

      async function admit(): Promise<void> {
        try {
          // Отказ словами приложения для голоса — тот же отказ входа: слов в закрытии соединения нет.
          const user = allowedUser(await options.resolveUser(request));
          if (!user) return refuse(DIALOG_CLOSE_CODES.noUser);
          const chatId = new URL(request.url).searchParams.get("chatId");
          const chat = chatId ? await storage.getChat(chatId) : null;
          if (!chatId || !chat || chat.ownerId !== user.id) return refuse(DIALOG_CLOSE_CODES.foreignChat);
          if (options.spendingLimits) {
            try {
              await options.spendingLimits.assertWithinLimit({ userId: user.id, chatId });
            } catch (error) {
              if (error instanceof SpendingLimitReachedError) return refuse(DIALOG_CLOSE_CODES.spendingLimit);
              throw error;
            }
          }
          if ((connections.get(user.id) ?? 0) >= maxConnections || limiter?.take(user.id) != null) {
            return refuse(DIALOG_CLOSE_CODES.tooMany, { type: "error", kind: "rate_limited" });
          }
          if (over) return;
          userId = user.id;
          admittedChatId = chatId;
          counted = true;
          connections.set(user.id, (connections.get(user.id) ?? 0) + 1);
        } catch (error) {
          logError(`Голос: не удалось допустить соединение: ${describe(error)}`);
          refuse(INTERNAL_ERROR_CLOSE, { type: "error", kind: "service_unavailable" });
        }
      }

      async function startSession(raw: string) {
        const start = parseStartMessage(raw);
        if (!start.ok) return refuse(DIALOG_CLOSE_CODES.invalidMessage);
        const apiKey = recognitionKey();
        if (!apiKey) {
          logError("Голос: не задан ключ SONIOX_API_KEY, режим недоступен");
          return refuse(DIALOG_CLOSE_CODES.recognitionUnavailable, { type: "error", kind: "service_unavailable" });
        }
        const recognition = options.recognition;
        const speech = speechConfig();
        const config: DialogSessionConfig = {
          recognition: {
            apiKey,
            model: recognition?.model ?? DEFAULT_RECOGNITION_MODEL,
            language: recognition?.language ?? DEFAULT_LANGUAGE,
            endpointLatencyLevel: recognition?.endpointLatencyLevel ?? DEFAULT_ENDPOINT_LATENCY_LEVEL,
            maxEndpointDelayMs: recognition?.maxEndpointDelayMs ?? DEFAULT_MAX_ENDPOINT_DELAY_MS,
            context: recognition?.context,
            websocketUrl: recognition?.baseUrl ?? DEFAULT_WEBSOCKET_URL,
            headers: recognition?.headers,
            connectUpstream: recognition?.connectUpstream,
          },
          speech,
          sounds: soundsConfig(),
          idleSeconds: options.idleSeconds ?? DEFAULT_IDLE_SECONDS,
          maxSessionSeconds: options.maxSessionSeconds ?? DEFAULT_MAX_SESSION_SECONDS,
          maxCharsPerReply: speechOptions?.maxCharsPerReply ?? DEFAULT_MAX_CHARS_PER_REPLY,
        };
        const owner = userId!;
        const voiceId = catalog ? await catalog.current(owner) : "";
        if (over) return;
        session = createDialogSession({
          userId: owner,
          chatId: admittedChatId,
          voiceId,
          config,
          storage,
          usage: usage ?? NO_SPEECH_USAGE,
          soundsUsage,
          takeMinuteChars: (length) => minuteChars.take(owner, length),
          send: sendMessage,
          sendAudio: (frame) => client.send(frame),
          close: (code) => {
            over = true;
            release();
            client.close(code);
          },
          voiceAllowed: (id) => Boolean(catalog?.voices.some((voice) => voice.id === id)),
          onVoice: (id) => {
            void catalog?.select(owner, id).catch((error: unknown) => logError(`Голос: не удалось запомнить выбранный голос: ${describe(error)}`));
          },
          now,
          logError,
        });
        session.start(start.message);
      }

      async function handle(data: string | Uint8Array | ArrayBuffer) {
        if (over) return;
        if (!started) {
          if (typeof data !== "string") return refuse(DIALOG_CLOSE_CODES.invalidMessage);
          started = true;
          return startSession(data);
        }
        if (typeof data !== "string") {
          session?.receiveAudio(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
          return;
        }
        const command = parseClientCommand(data);
        if (!command.ok) return refuse(DIALOG_CLOSE_CODES.invalidMessage);
        // Команду не ждём: сессия сама ставит команды в очередь (порядок цел), а звук и перебивание не должны стоять за ней.
        session?.command(command.message).catch((error: unknown) => {
          logError(`Голос: сбой обработки команды: ${describe(error)}`);
          refuse(INTERNAL_ERROR_CLOSE, { type: "error", kind: "service_unavailable" });
        });
      }

      // Сообщения, пришедшие до конца допуска, ждут его и идут по порядку.
      let chain: Promise<void> = admit();
      return {
        receive(data) {
          chain = chain.then(() =>
            handle(data).catch((error: unknown) => {
              logError(`Голос: сбой обработки сообщения: ${describe(error)}`);
              refuse(INTERNAL_ERROR_CLOSE, { type: "error", kind: "service_unavailable" });
            }),
          );
        },
        closed() {
          over = true;
          release();
          session?.close();
        },
      };
    },
  };
}
