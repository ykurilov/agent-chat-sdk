import { requestSession } from "./request-session";
import type { VoiceSessionParameters } from "./request-session";
import { buildFinalizeMessage, buildStartMessage, createTranscript } from "./soniox-messages";
import type { DictatedText } from "./soniox-messages";
import { classifyMicrophoneError, VoiceError } from "./voice-errors";
import type { VoiceErrorKind } from "./voice-errors";

/** Кто слушает диктовку. После `onError` всегда приходит `onEnd`. */
export interface VoiceListener {
  /** Микрофон и соединение готовы, идёт запись. */
  onConnected(): void;
  /** Накопленный с начала диктовки текст целиком. */
  onText(text: DictatedText): void;
  onError(kind: VoiceErrorKind): void;
  /** Диктовка закончена, микрофон и соединение освобождены. */
  onEnd(): void;
  /** Только режим `relay` с чисткой: текст закреплён, сервер чистит его моделью. Дальше придёт `onPolished` или сразу `onEnd`. */
  onPolishing?(): void;
  /** Исправленный текст всей диктовки (только если чистка удалась; иначе остаётся то, что пришло в `onText`). Затем `onEnd`. */
  onPolished?(text: string): void;
}

export interface VoiceSession {
  /** Закончить запись, дождаться остатка речи; затем `onEnd`. */
  stop(): void;
  /** Оборвать сразу: ничего не ждать и слушателя больше не звать (смена чата, закрытие экрана). */
  cancel(): void;
}

export interface VoiceInput {
  start(listener: VoiceListener): VoiceSession;
}

export interface VoiceInputOptions {
  /** Адрес обработчика голоса на сервере приложения, например `/api/voice`. */
  api: string;
  /** Сколько ждать после остановки, пока Soniox закрепит остаток речи (ответ на «закрепи всё»). По умолчанию 3000 мс. */
  stopTimeoutMs?: number;
  /** Сколько ждать чистку текста после «стоп» (режим `relay`), мс. По умолчанию 7000; не пришла — остаётся текст Soniox. */
  polishTimeoutMs?: number;
  /** Длина куска записи. По умолчанию 120 мс. */
  chunkMs?: number;
  /**
   * `direct` (по умолчанию): браузер соединяется с Soniox сам по временному ключу.
   * `relay`: звук идёт на сервер приложения, а он пересылает его в Soniox: для тех, у кого браузер не достаёт до Soniox.
   */
  mode?: "direct" | "relay";
  /** Адрес WebSocket сервера приложения для режима `relay`. По умолчанию `{api}/stream` на адресе страницы. */
  relayUrl?: string;
  /** Подмены среды для тестов; по умолчанию — браузерные. `undefined` — «такого нет в браузере». */
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket | undefined;
  MediaRecorder?: typeof MediaRecorder | undefined;
  mediaDevices?: MediaDevices | undefined;
}

const DEFAULT_STOP_TIMEOUT_MS = 3000;
/** Чуть больше, чем ждёт сервер у модели (5 с): ответ «оставь как есть» должен успеть дойти. */
const DEFAULT_POLISH_TIMEOUT_MS = 7000;
const DEFAULT_CHUNK_MS = 120;
const DEFAULT_MAX_SESSION_SECONDS = 300;
/** Запас, чтобы остановить запись самим, а не получить обрыв от Soniox или сервера. */
const LIMIT_MARGIN_SECONDS = 2;
/** Форматы записи по порядку предпочтения: Chrome и Firefox — webm/opus, Safari — mp4/AAC. Soniox распознаёт все (`audio_format: auto`). */
const RECORDER_FORMATS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
/** Коды закрытия соединения с сервером приложения в режиме `relay` (см. contracts/voice.md). */
const RELAY_CLOSE_PROTOCOL = 4400;
const RELAY_CLOSE_UNAUTHORIZED = 4401;
const RELAY_CLOSE_TIME_LIMIT = 4408;
const RELAY_CLOSE_RATE_LIMITED = 4429;
const RELAY_CLOSE_UPSTREAM = 4502;
const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;
const NORMAL_CLOSE = 1000;

/** Голосовой ввод: микрофон браузера → Soniox по WebSocket с временным ключом от сервера приложения. */
export function createVoiceInput(options: VoiceInputOptions): VoiceInput {
  return { start: (listener) => startDictation(options, listener) };
}

function pickRecorderFormat(RecorderClass: typeof MediaRecorder): string | undefined {
  if (typeof RecorderClass.isTypeSupported !== "function") return undefined;
  return RECORDER_FORMATS.find((format) => RecorderClass.isTypeSupported(format));
}

/** Адрес WebSocket сервера приложения: явный, из абсолютного `api` или от адреса страницы. */
function relayAddress(options: VoiceInputOptions): string | undefined {
  if (options.relayUrl) return options.relayUrl;
  const base = options.api.replace(/\/+$/, "");
  if (/^https?:\/\//.test(base)) return `${base.replace(/^http/, "ws")}/stream`;
  const page = globalThis.location;
  return page ? `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.host}${base}/stream` : undefined;
}

function readReady(raw: string): { maxSessionSeconds: number; polish: boolean } | null {
  try {
    const message = JSON.parse(raw) as { ready?: unknown; max_session_seconds?: unknown; polish?: unknown };
    if (message.ready !== true) return null;
    return {
      maxSessionSeconds: typeof message.max_session_seconds === "number" ? message.max_session_seconds : DEFAULT_MAX_SESSION_SECONDS,
      polish: message.polish === true,
    };
  } catch {
    return null;
  }
}

/** Ответ сервера о чистке: `null` — «оставь как есть». Не чистка — `undefined`. */
function readPolished(raw: string): { text: string | null } | undefined {
  try {
    const message = JSON.parse(raw) as { polished?: { text?: unknown } };
    if (typeof message.polished !== "object" || message.polished === null) return undefined;
    return { text: typeof message.polished.text === "string" && message.polished.text.trim() ? message.polished.text : null };
  } catch {
    return undefined;
  }
}

function startDictation(options: VoiceInputOptions, listener: VoiceListener): VoiceSession {
  const mediaDevices = "mediaDevices" in options ? options.mediaDevices : globalThis.navigator?.mediaDevices;
  const RecorderClass = "MediaRecorder" in options ? options.MediaRecorder : globalThis.MediaRecorder;
  const SocketClass = "WebSocket" in options ? options.WebSocket : globalThis.WebSocket;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const polishTimeoutMs = options.polishTimeoutMs ?? DEFAULT_POLISH_TIMEOUT_MS;

  type Phase = "preparing" | "recording" | "stopping" | "ended";
  let phase: Phase = "preparing";
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let socket: WebSocket | undefined;
  let socketOpened = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let limitReached = false;
  /** Сервер сказал в «готово», что чистит текст после «стоп». */
  let polishOffered = false;
  let awaitingPolish = false;
  const relayed = options.mode === "relay";
  let sending: Promise<void> = Promise.resolve();
  const transcript = createTranscript();

  /** Фаза меняется из других обработчиков, пока идут `await`: узнаём её заново, а не по запомненной. */
  const isEnded = () => phase === "ended";

  function releaseMicrophone() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
  }

  /** Микрофон, запись, таймер и соединение — всё сразу и безопасно повторно. */
  function release() {
    clearTimeout(finishTimer);
    clearTimeout(limitTimer);
    releaseMicrophone();
    if (socket && (socket.readyState === WEBSOCKET_CONNECTING || socket.readyState === WEBSOCKET_OPEN)) socket.close();
  }

  /** Отдаёт наружу слова, которые Soniox не успел закрепить: с обрывом связи они уже в поле, теряться не должны. */
  function flushText() {
    if (transcript.current().interimText.length > 0) listener.onText(transcript.settle());
  }

  function complete() {
    if (phase === "ended") return;
    phase = "ended";
    flushText();
    release();
    // Дошли до предела записи: слова сохранены, человеку объясняем, почему запись остановилась.
    if (limitReached) listener.onError("time_limit");
    listener.onEnd();
  }

  /** Всё сказанное закреплено. Сервер чистит текст — ждём его ответ ограниченное время; нет чистки — заканчиваем. */
  function finalized() {
    if (!polishOffered) return complete();
    clearTimeout(finishTimer);
    awaitingPolish = true;
    finishTimer = setTimeout(complete, polishTimeoutMs);
    listener.onPolishing?.();
  }

  function fail(kind: VoiceErrorKind) {
    if (phase === "ended") return;
    phase = "ended";
    flushText();
    release();
    listener.onError(kind);
    listener.onEnd();
  }

  function enqueueSend(task: () => Promise<void> | void) {
    sending = sending.then(async () => {
      if (phase === "ended" || socket?.readyState !== WEBSOCKET_OPEN) return;
      await task();
    });
  }

  /** Закончить запись и дождаться остатка речи: и по нажатию, и по пределу. */
  function beginStopping() {
    phase = "stopping";
    releaseMicrophone();
    finishTimer = setTimeout(complete, stopTimeoutMs);
  }

  function startRecorder(maxSessionSeconds: number) {
    const activeSocket = socket!;
    const format = pickRecorderFormat(RecorderClass!);
    const activeRecorder = new RecorderClass!(stream!, format ? { mimeType: format } : undefined);
    recorder = activeRecorder;
    activeRecorder.addEventListener("dataavailable", (event) => {
      const chunk = event.data;
      if (chunk.size === 0) return;
      enqueueSend(async () => activeSocket.send(await chunk.arrayBuffer()));
    });
    // Запись закончена, последний кусок ушёл: просим Soniox закрепить всё сказанное. Ответ — закреплённые слова и метка `<fin>`.
    activeRecorder.addEventListener("stop", () => enqueueSend(() => activeSocket.send(JSON.stringify(buildFinalizeMessage()))));
    activeRecorder.addEventListener("error", () => fail("other"));
    activeRecorder.start(options.chunkMs ?? DEFAULT_CHUNK_MS);
    phase = "recording";
    limitTimer = setTimeout(() => {
      if (phase !== "recording") return;
      limitReached = true;
      beginStopping();
    }, Math.max(1, maxSessionSeconds - LIMIT_MARGIN_SECONDS) * 1000);
    listener.onConnected();
  }

  function beginRecording(session: VoiceSessionParameters) {
    socket!.send(JSON.stringify(buildStartMessage(session)));
    startRecorder(session.maxSessionSeconds ?? DEFAULT_MAX_SESSION_SECONDS);
  }

  /** Как понять закрытие соединения с сервером приложения (режим `relay`). */
  function closeKind(code: number): VoiceErrorKind {
    if (code === RELAY_CLOSE_RATE_LIMITED) return "rate_limited";
    if (code === RELAY_CLOSE_UNAUTHORIZED || code === RELAY_CLOSE_UPSTREAM) return "service_unavailable";
    if (code === RELAY_CLOSE_PROTOCOL) return "other";
    return "network";
  }

  /** `session` — параметры диктовки напрямую; в режиме `relay` их нет: сервер приложения знает всё сам. */
  function connect(address: string, session?: VoiceSessionParameters) {
    try {
      socket = new SocketClass!(address);
    } catch {
      fail("network");
      return;
    }
    socket.addEventListener("open", () => {
      if (phase !== "preparing") return;
      socketOpened = true;
      try {
        if (session) beginRecording(session);
        else socket!.send(JSON.stringify({ audio_format: "auto" }));
      } catch {
        fail("other");
      }
    });
    socket.addEventListener("message", (event) => {
      if (phase === "ended" || typeof event.data !== "string") return;
      if (phase === "preparing") {
        // Сервер приложения готов принимать звук: соединился с Soniox и назвал предел записи.
        const ready = relayed ? readReady(event.data) : null;
        if (ready) {
          try {
            polishOffered = ready.polish;
            startRecorder(ready.maxSessionSeconds);
          } catch {
            fail("other");
          }
        }
        return;
      }
      if (relayed && phase === "stopping" && awaitingPolish) {
        const polished = readPolished(event.data);
        if (polished) {
          if (polished.text !== null) listener.onPolished?.(polished.text);
          complete();
          return;
        }
      }
      const result = transcript.accept(event.data);
      if (result.type === "text") {
        listener.onText(result.text);
        // Метка `<fin>` приходит только в ответ на нашу команду после остановки: всё сказанное закреплено.
        if (result.finalized && phase === "stopping" && !awaitingPolish) finalized();
      } else if (result.type === "error") fail("service_unavailable");
      else if (result.type === "finished") {
        if (result.text) listener.onText(result.text);
        complete();
      }
    });
    socket.addEventListener("close", (event) => {
      if (phase === "ended") return;
      if (relayed && event.code === RELAY_CLOSE_TIME_LIMIT) {
        limitReached = true;
        complete();
      } else if (relayed && event.code >= 4000) fail(closeKind(event.code));
      else if (phase === "stopping" || (socketOpened && event.code === NORMAL_CLOSE)) complete();
      else fail(closeKind(event.code));
    });
  }

  async function prepare() {
    try {
      if (!mediaDevices?.getUserMedia || !RecorderClass || !SocketClass) throw new VoiceError("unsupported");
      stream = await mediaDevices.getUserMedia({ audio: true }).catch((error: unknown) => {
        throw new VoiceError(classifyMicrophoneError(error));
      });
      if (isEnded()) return releaseMicrophone();
      if (relayed) {
        const address = relayAddress(options);
        if (!address) throw new VoiceError("other");
        connect(address);
        return;
      }
      // Ключ живёт недолго, поэтому просим его только после разрешения на микрофон.
      const session = await requestSession(options.api, fetchImpl);
      if (isEnded()) return releaseMicrophone();
      connect(session.websocketUrl, session);
    } catch (error) {
      if (isEnded()) return releaseMicrophone();
      fail(error instanceof VoiceError ? error.kind : "other");
    }
  }

  void prepare();

  return {
    stop() {
      if (phase === "preparing") {
        phase = "ended";
        release();
        listener.onEnd();
        return;
      }
      if (phase !== "recording") return;
      beginStopping();
    },
    cancel() {
      if (phase === "ended") return;
      phase = "ended";
      release();
    },
  };
}
