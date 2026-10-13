import { createSonioxSession } from "@ykurilov/agent-chat-voice/server";
import type { SonioxCloseReason, SonioxContext, SonioxEvent, UpstreamSocket } from "@ykurilov/agent-chat-voice/server";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { DIALOG_CLOSE_CODES, MIC_SAMPLE_RATE, encodeSpeechFrame } from "../protocol";
import type { ClientCommand, DialogErrorKind, HeardSound, HeardWord, HumanSoundKind, ServerMessage, SpeechFailure, StartMessage } from "../protocol";
import { createScribeSounds, ScribeAbortedError } from "./scribe-sounds";
import type { ScribeSound, ScribeSounds } from "./scribe-sounds";
import { createSoundDedupe } from "./sound-dedupe";
import { createSoundWindow } from "./sound-window";
import type { SoundSlice } from "./sound-window";
import type { SoundsUsage } from "./sounds-usage";
import { openSpeech } from "./speech-stream";
import type { SpeechStream } from "./speech-stream";
import type { SpeechUsage } from "./speech-usage";
import { createWindowBudget } from "./window-budget";

export interface DialogRecognitionConfig {
  apiKey: string;
  model: string;
  language: string;
  endpointLatencyLevel?: number | undefined;
  maxEndpointDelayMs?: number | undefined;
  context?: SonioxContext | undefined;
  websocketUrl: string;
  headers?: Record<string, string> | undefined;
  connectUpstream?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
}

export interface DialogSpeechConfig {
  apiKey: string;
  model: string;
  language: string;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  connectTimeoutMs?: number | undefined;
  connect?: ((url: string, headers: Record<string, string>) => UpstreamSocket) | undefined;
}

/** Звуки человека (Scribe): звук фразы уходит на распознавание звуков параллельно с Soniox. */
export interface DialogSoundsConfig {
  apiKey: string;
  model: string;
  language?: string | undefined;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  /** Сколько ждать на конце фразы ответ Scribe на хвост и на не вернувшиеся куски; не успел — фраза уходит без них, а звуки догоняют отдельным сообщением. */
  waitMs: number;
  /** Каждые столько секунд нового звука во время фразы уходит кусок; `0` — звук уходит целиком на конце фразы. */
  chunkSeconds: number;
  /** Сколько секунд прежнего звука повторяется в начале следующего куска. */
  overlapSeconds: number;
  /** Кусок тише этого (RMS от 0 до 1) в Scribe не отправляется; `0` — не проверять. */
  silenceRms: number;
  /** Не больше стольких секунд звука уходит в Scribe за раз: старое отбрасывается. */
  maxWindowSeconds: number;
  /** Дольше этого запрос к Scribe обрывается. */
  timeoutMs: number;
  fetch?: typeof fetch | undefined;
}

export interface DialogSessionConfig {
  recognition: DialogRecognitionConfig;
  /** `null` или не задано — звуки человека не ловятся. */
  sounds?: DialogSoundsConfig | null | undefined;
  /** `null` — озвучка на сервере недоступна: режим слушает и пишет. */
  speech: DialogSpeechConfig | null | undefined;
  idleSeconds: number;
  maxSessionSeconds: number;
  maxCharsPerReply: number;
}

export interface DialogSessionDeps {
  userId: string;
  chatId: string;
  /** Голос, которым начнётся озвучка. */
  voiceId: string;
  config: DialogSessionConfig;
  storage: ChatStorage;
  usage: SpeechUsage;
  /** Расход и лимит Scribe; нужен вместе с `config.sounds`. */
  soundsUsage?: SoundsUsage | undefined;
  /**
   * Берёт знаки в счёт потолка «в минуту»; `false` — потолок. Счёт общий для всех соединений человека,
   * поэтому ведёт его тот, кто знает о соединениях (ретранслятор), а не сессия.
   */
  takeMinuteChars: (length: number) => boolean;
  send: (message: ServerMessage) => void;
  sendAudio: (frame: Uint8Array) => void;
  /** Закрыть соединение с клиентом. Зовётся, когда сессия закончилась сама; на `close()` владельца не зовётся. */
  close: (code: number) => void;
  /** Можно ли выбрать этот голос. Не задано — любой. */
  voiceAllowed?: ((voiceId: string) => boolean) | undefined;
  /** Человек выбрал голос (уже проверенный). */
  onVoice?: ((voiceId: string) => void) | undefined;
  now?: (() => number) | undefined;
  logError: (message: string) => void;
}

/**
 * Одно включение голосового режима: распознавание (Soniox) идёт всё время, озвучка (ElevenLabs) — по репликам.
 * Ничего не знает о сокете клиента и о том, откуда пришёл запрос: сообщения уходят через `send`/`sendAudio`.
 */
export interface DialogSession {
  /** Первое сообщение клиента принято: открыть распознавание. */
  start(message: StartMessage): void;
  /** Кусок звука с микрофона. */
  receiveAudio(chunk: Uint8Array): void;
  /** Команда клиента после `start`. Команды выполняются по очереди; сбой одной не рушит режим. */
  command(command: ClientCommand): Promise<void>;
  /** Закрыть всё молча: распознавание, озвучку, таймеры; расход незаконченной реплики записывается. */
  close(): void;
}

const IDLE_WARNING_SECONDS = 15;
/**
 * Сколько звука с микрофона принимаем: реальное время — 16 кГц × 2 байта = 32 000 байт в секунду; берём с запасом в полтора раза
 * на окно в 10 секунд, чтобы короткий всплеск (сеть «выдала» накопленное) не закрывал режим.
 */
const MIC_BYTES_PER_SECOND = MIC_SAMPLE_RATE * 2;
const MIC_WINDOW_MS = 10_000;
const MIC_MAX_BYTES_PER_WINDOW = Math.round(MIC_BYTES_PER_SECOND * (MIC_WINDOW_MS / 1000) * 1.5);
/** Одновременно к Scribe идёт не больше двух запросов: лишний кусок не берётся, его звук уйдёт со следующим куском или хвостом. */
const MAX_SCRIBE_REQUESTS = 2;
/** Один и тот же звук, найденный в соседних кусках (перекрытие), ближе этого друг к другу — повтор. */
const SOUND_REPEAT_GAP_MS = 500;
const VOICE_CUT_TAIL_CHARS = 200;
const SERVICE_TOKENS = new Set(["<fin>", "<end>"]);
const END_MARK = "<end>";

interface Reply {
  id: number;
  stream: SpeechStream | null;
  messageId: string | null;
  startedAt: number;
  /** Знаков принято в озвучку по потолку реплики. */
  chars: number;
  started: boolean;
  /** Озвучки не будет или она оборвалась. */
  failed: boolean;
  /** Выше потолка: остальной текст не уходит, отправленное дозвучивается. */
  capped: boolean;
  /** Перебита человеком. */
  cut: boolean;
  usageWritten: boolean;
}

/** Слова из ответа Soniox: закреплённые и предварительные; токены без пробела в начале достраивают прежнее слово, уверенность — наименьшая. */
function readWords(raw: string): { settled: HeardWord[]; interim: HeardWord[] } {
  const settled: HeardWord[] = [];
  const interim: HeardWord[] = [];
  let tokens: Array<{ text?: unknown; is_final?: unknown; confidence?: unknown }> = [];
  try {
    const parsed = JSON.parse(raw) as { tokens?: unknown };
    if (Array.isArray(parsed.tokens)) tokens = parsed.tokens;
  } catch {
    return { settled, interim };
  }
  const open = { settled: false, interim: false };
  for (const token of tokens) {
    if (typeof token?.text !== "string") continue;
    if (token.text === END_MARK) {
      open.settled = false;
      open.interim = false;
      continue;
    }
    if (SERVICE_TOKENS.has(token.text)) continue;
    const kind = token.is_final === true ? "settled" : "interim";
    const words = kind === "settled" ? settled : interim;
    const text = token.text.trim();
    if (text.length === 0) {
      open[kind] = false;
      continue;
    }
    const confidence = typeof token.confidence === "number" ? token.confidence : 1;
    const last = words.at(-1);
    if (open[kind] && last && !token.text.startsWith(" ")) {
      last.text += text;
      last.confidence = Math.min(last.confidence, confidence);
    } else {
      words.push({ text, confidence });
    }
    open[kind] = true;
  }
  return { settled, interim };
}

/** Запрос к Scribe за звуком текущей фразы: `sounds` — найденное без повторов, когда запрос закончился. */
interface SoundRequest {
  takenAt: number;
  done: boolean;
  sounds: SoundHeard[];
  settled: Promise<void>;
}

/** Звук человека с временем начала (часы сессии). */
interface SoundHeard {
  kind: HumanSoundKind;
  startedAt: number;
}

export function createDialogSession(deps: DialogSessionDeps): DialogSession {
  const { userId, chatId, config, storage, usage, logError } = deps;
  const now = deps.now ?? (() => Date.now());
  let voiceId = deps.voiceId;
  let ended = false;
  let soniox: ReturnType<typeof createSonioxSession> | null = null;
  let reply: Reply | null = null;
  const micBudget = createWindowBudget({ max: MIC_MAX_BYTES_PER_WINDOW, windowMs: MIC_WINDOW_MS, now });
  let warningTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();


  // Звуки человека: пока человек говорит, звук микрофона кусками уходит в Scribe; на конце фразы уходит хвост.
  // Звуки фразы — объединение ответов всех её кусков; ответ на конце фразы ждём не дольше `waitMs`.
  const soundsConfig = config.sounds && deps.soundsUsage ? config.sounds : null;
  const soundsUsage = deps.soundsUsage;
  const scribe: ScribeSounds | null = soundsConfig
    ? createScribeSounds({
        apiKey: soundsConfig.apiKey,
        model: soundsConfig.model,
        language: soundsConfig.language,
        baseUrl: soundsConfig.baseUrl,
        headers: soundsConfig.headers,
        timeoutMs: soundsConfig.timeoutMs,
        fetch: soundsConfig.fetch,
      })
    : null;
  const soundWindow = soundsConfig ? createSoundWindow(soundsConfig) : null;
  const soundRepeats = createSoundDedupe({ gapMs: SOUND_REPEAT_GAP_MS });
  let scribeRequests = 0;
  /** Сбой Scribe уже записан в журнал: повторы молчат, пока не придёт успешный ответ. */
  let scribeFailureLogged = false;
  /** Запросы текущей фразы (с конца прошлой): из них собираются её звуки; смех без слов ждёт здесь следующей фразы. */
  let segment: SoundRequest[] = [];
  const scribeAbort = new AbortController();
  const waitTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Фразы уходят клиенту по порядку, даже если Scribe на следующую ответил раньше. */
  let phrasesWaiting = 0;
  let phraseOutbox: Promise<void> = Promise.resolve();

  /** Один запрос к Scribe: звуки или `[]` при любом сбое (в журнал один раз, без исключения). Расход пишется за каждый ответивший запрос и за оборванный после отправки. */
  async function detectSounds(slice: SoundSlice): Promise<ScribeSound[]> {
    if (!scribe || !soundsUsage) return [];
    scribeRequests += 1;
    let sentAt: number | undefined;
    const recordSpend = () => void soundsUsage.record({ ownerId: userId, chatId, seconds: slice.durationMs / 1000, startedAt: sentAt ?? now() });
    try {
      if (!(await soundsUsage.canDetect({ userId, chatId }))) return [];
      const found = await scribe.detect(slice.pcm, scribeAbort.signal, () => {
        sentAt = now();
      });
      scribeFailureLogged = false;
      recordSpend();
      return found;
    } catch (error) {
      // Таймаут и отмена после отправки: звук ушёл, ElevenLabs мог его принять и списать.
      if (error instanceof ScribeAbortedError && sentAt !== undefined) recordSpend();
      if (!ended && !scribeFailureLogged) {
        scribeFailureLogged = true;
        logError(`Звуки: Scribe не ответил: ${error instanceof Error ? error.message : String(error)}`);
      }
      return [];
    } finally {
      scribeRequests -= 1;
    }
  }

  /** Запрос ушёл: его звуки (без повторов с перекрытием) копятся в текущей фразе. */
  function startRequest(slice: SoundSlice) {
    const takenAt = now();
    const request: SoundRequest = { takenAt, done: false, sounds: [], settled: Promise.resolve() };
    request.settled = detectSounds(slice).then((found) => {
      request.done = true;
      request.sounds = found
        .filter((sound) => soundRepeats.isNew(sound.kind, slice.startMs + sound.startMs, slice.startMs + sound.endMs))
        .map((sound) => ({ kind: sound.kind, startedAt: takenAt - slice.durationMs + sound.startMs }));
    });
    // Звук старше окна клиенту не нужен: старые законченные запросы отбрасываются.
    const oldest = takenAt - soundsConfig!.maxWindowSeconds * 1000;
    segment = [...segment.filter((older) => !older.done || older.takenAt >= oldest), request];
  }

  /** Кусок во время фразы: если накопилось `chunkSeconds` и к Scribe можно, звук (если не тишина) уходит. */
  function sendChunkIfDue() {
    if (!soundWindow || !soundWindow.chunkDue() || scribeRequests >= MAX_SCRIBE_REQUESTS) return;
    const slice = soundWindow.take("chunk");
    if (slice) startRequest(slice);
  }

  const toHeard = (requests: readonly SoundRequest[]): HeardSound[] =>
    requests.flatMap((request) => request.sounds.map((sound) => ({ kind: sound.kind, agoMs: Math.max(0, now() - sound.startedAt) })));

  function sendPhrase(text: string, serverTimeMs: number, sounds?: HeardSound[]) {
    deps.send({ type: "phrase_end", text, serverTimeMs, ...(sounds && sounds.length > 0 && { sounds }) });
  }

  /**
   * Конец фразы от Soniox: уходит хвост звука. Если всё уже вернулось и очереди нет — фраза уходит сразу со звуками всех кусков,
   * иначе по порядку после ответов или порога: ждём только хвост и ещё не вернувшиеся куски.
   */
  function endPhrase(text: string) {
    const serverTimeMs = now();
    if (soundWindow && scribeRequests < MAX_SCRIBE_REQUESTS) {
      const tail = soundWindow.take("tail");
      if (tail) startRequest(tail);
    }
    const requests = segment;
    segment = [];
    if (requests.every((request) => request.done) && phrasesWaiting === 0) return sendPhrase(text, serverTimeMs, toHeard(requests));
    phrasesWaiting += 1;
    // Порог отсчитывается от конца фразы, а не от того, когда до неё дошла очередь.
    const threshold = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waitTimers.delete(timer);
        resolve();
      }, soundsConfig!.waitMs);
      waitTimers.add(timer);
    });
    phraseOutbox = phraseOutbox.then(async () => {
      await Promise.race([Promise.all(requests.map((request) => request.settled)), threshold]);
      phrasesWaiting -= 1;
      if (ended) return;
      const ready = requests.filter((request) => request.done);
      sendPhrase(text, serverTimeMs, toHeard(ready));
      // Опоздавший ответ: фраза ушла без его звуков, они приклеятся к следующей.
      for (const request of requests) {
        if (request.done) continue;
        void request.settled.then(() => {
          const heard = toHeard([request]);
          if (!ended && heard.length > 0) deps.send({ type: "sounds", sounds: heard });
        });
      }
    });
  }

  function stopTimers() {
    clearTimeout(warningTimer);
    clearTimeout(idleTimer);
  }

  /** Человек или агент что-то сказал: отсчёт простоя начинается заново. */
  function markActivity() {
    if (ended) return;
    stopTimers();
    const idleMs = config.idleSeconds * 1000;
    const warningMs = Math.max(0, idleMs - IDLE_WARNING_SECONDS * 1000);
    warningTimer = setTimeout(() => deps.send({ type: "idle_warning", secondsLeft: Math.round((idleMs - warningMs) / 1000) }), warningMs);
    idleTimer = setTimeout(() => finish(DIALOG_CLOSE_CODES.idle), idleMs);
  }

  /** Расход реплики — один раз, по знакам, реально ушедшим в ElevenLabs. */
  function settleUsage(target: Reply) {
    if (target.usageWritten || !target.stream) return;
    target.usageWritten = true;
    void usage.record({ ownerId: userId, chatId, messageId: target.messageId, chars: target.stream.sentChars, startedAt: target.startedAt });
  }

  function releaseReply(target: Reply | null) {
    if (!target) return;
    target.stream?.close();
    settleUsage(target);
  }

  /** Сессия закончилась: всё закрыто, расход записан, таймеров нет. Клиенту ничего не отправляется. */
  function shutDown() {
    if (ended) return;
    ended = true;
    scribeAbort.abort();
    stopTimers();
    for (const timer of waitTimers) clearTimeout(timer);
    waitTimers.clear();
    releaseReply(reply);
    soniox?.close();
  }

  /** Сессия закончилась по нашей причине: клиент узнаёт код (и, если есть, вид ошибки) и соединение закрывается. */
  function finish(code: number, error?: DialogErrorKind) {
    if (ended) return;
    if (error) deps.send({ type: "error", kind: error });
    shutDown();
    deps.close(code);
  }

  function failReply(target: Reply, kind: SpeechFailure) {
    if (target.failed) return;
    target.failed = true;
    deps.send({ type: "speech_failed", replyId: target.id, kind });
    releaseReply(target);
  }

  function handleSonioxMessage(raw: string, event: SonioxEvent) {
    if (ended) return;
    if (event.type === "error") {
      logError(`Голос: Soniox вернул ошибку (код ${event.code})`);
      finish(DIALOG_CLOSE_CODES.recognitionUnavailable, "recognition_lost");
      return;
    }
    const { settled, interim } = readWords(raw);
    if (settled.length > 0 || interim.length > 0) {
      deps.send({ type: "heard", settled, interim });
      markActivity();
    }
    const phrases = event.type === "text" || event.type === "finished" ? (event.endedPhrases ?? []) : [];
    for (const text of phrases) {
      if (text.length === 0) continue;
      endPhrase(text);
      markActivity();
    }
  }

  function handleSonioxClosed(reason: SonioxCloseReason) {
    if (reason === "time_limit") return finish(DIALOG_CLOSE_CODES.idle);
    finish(DIALOG_CLOSE_CODES.recognitionUnavailable, reason === "failed" ? "service_unavailable" : "recognition_lost");
  }

  async function beginReply(id: number): Promise<Reply> {
    releaseReply(reply);
    const next: Reply = { id, stream: null, messageId: null, startedAt: now(), chars: 0, started: false, failed: false, capped: false, cut: false, usageWritten: false };
    reply = next;
    const speech = config.speech;
    if (!speech) {
      failReply(next, "unavailable");
      return next;
    }
    const verdict = await usage.assertCanSpeak({ userId, chatId });
    if (ended || reply !== next) return next;
    if (verdict !== "ok") {
      failReply(next, verdict);
      return next;
    }
    next.stream = openSpeech(
      { ...speech, voiceId, logError },
      {
        onAudio(chunk) {
          if (ended || reply !== next) return;
          if (!next.started) {
            next.started = true;
            deps.send({ type: "speech_started", replyId: id, serverTimeMs: now() });
          }
          markActivity();
          deps.sendAudio(encodeSpeechFrame(id, chunk));
        },
        onDone() {
          if (ended || reply !== next) return;
          deps.send({ type: "speech_done", replyId: id, spokenChars: next.stream?.sentChars ?? 0 });
          settleUsage(next);
        },
        onFailed() {
          if (ended || reply !== next) return;
          failReply(next, "unavailable");
        },
      },
    );
    return next;
  }

  async function speak(command: Extract<ClientCommand, { type: "speak" }>) {
    markActivity();
    const current = reply && reply.id === command.replyId ? reply : await beginReply(command.replyId);
    if (current.failed || current.capped || current.cut || !current.stream) return;
    const sentence = command.text.trim();
    if (sentence.length === 0) return;
    // Каждое предложение уходит с пробелом в конце: его тоже считает ElevenLabs.
    const length = sentence.length + 1;
    if (current.chars + length > config.maxCharsPerReply || !deps.takeMinuteChars(length)) {
      current.capped = true;
      deps.send({ type: "speech_failed", replyId: current.id, kind: "cap" });
      return;
    }
    current.chars += length;
    current.messageId ??= command.messageId ?? null;
    current.stream.speak(sentence);
  }

  function interrupt(command: Extract<ClientCommand, { type: "interrupt" }>) {
    markActivity();
    const current = reply?.id === command.replyId ? reply : null;
    if (!current?.stream) {
      deps.send({ type: "speech_cut", replyId: command.replyId, spokenChars: 0, spokenTail: "" });
      return;
    }
    current.cut = true;
    const position = current.stream.cut(command.playedMs);
    settleUsage(current);
    deps.send({ type: "speech_cut", replyId: current.id, ...position });
  }

  async function markCut(command: Extract<ClientCommand, { type: "mark_cut" }>) {
    const rejected = () => deps.send({ type: "cut_rejected", messageId: command.messageId });
    try {
      const message = await storage.getMessage(command.messageId);
      if (!message || message.chatId !== chatId || message.role !== "assistant") return rejected();
      if (!storage.setVoiceCut) return;
      await storage.setVoiceCut({
        ownerId: userId,
        chatId,
        messageId: command.messageId,
        voiceCut: { partIndex: command.partIndex, charOffset: command.charOffset, spokenTail: command.spokenTail.slice(-VOICE_CUT_TAIL_CHARS) },
      });
      deps.send({ type: "cut_saved", messageId: command.messageId });
    } catch (error) {
      logError(`Голос: не удалось сохранить отметку обрыва: ${error instanceof Error ? error.message : String(error)}`);
      rejected();
    }
  }

  async function run(command: ClientCommand) {
    if (ended) return;
    switch (command.type) {
      case "ping":
        return;
      case "voice":
        if (deps.voiceAllowed && !deps.voiceAllowed(command.voiceId)) return;
        voiceId = command.voiceId;
        deps.onVoice?.(command.voiceId);
        return;
      case "prepare":
        markActivity();
        if (reply?.id !== command.replyId) await beginReply(command.replyId);
        return;
      case "speak":
        return speak(command);
      case "end_reply":
        markActivity();
        if (reply?.id === command.replyId && !reply.failed && !reply.cut) reply.stream?.finish();
        return;
      case "interrupt":
        return interrupt(command);
      case "mark_cut":
        return markCut(command);
    }
  }

  return {
    start(message) {
      soniox = createSonioxSession(
        {
          apiKey: config.recognition.apiKey,
          model: config.recognition.model,
          languageHints: [message.language ?? config.recognition.language],
          websocketUrl: config.recognition.websocketUrl,
          headers: config.recognition.headers,
          maxSessionSeconds: config.maxSessionSeconds,
          endpointLatencyLevel: config.recognition.endpointLatencyLevel,
          maxEndpointDelayMs: config.recognition.maxEndpointDelayMs,
          context: config.recognition.context,
          phraseEnds: true,
          keepalive: true,
          logError,
          connectUpstream: config.recognition.connectUpstream,
        },
        {
          onReady() {
            if (ended) return;
            deps.send({
              type: "ready",
              maxSessionSeconds: config.maxSessionSeconds,
              idleSeconds: config.idleSeconds,
              voiceId,
              speech: Boolean(config.speech),
            });
            markActivity();
          },
          onMessage: handleSonioxMessage,
          onClosed: handleSonioxClosed,
        },
      );
      soniox.begin({ audio_format: "pcm_s16le", sample_rate: MIC_SAMPLE_RATE, num_channels: 1 });
    },

    receiveAudio(chunk) {
      if (ended) return;
      // Звук быстрее микрофона — не человек: каждый байт стоит денег у Soniox, закрываем, а не пропускаем молча.
      if (!micBudget.take("mic", chunk.byteLength)) return finish(DIALOG_CLOSE_CODES.audioTooLarge, "invalid");
      soundWindow?.push(chunk);
      sendChunkIfDue();
      soniox?.sendAudio(chunk);
    },

    command(command) {
      queue = queue.then(() =>
        run(command).catch((error: unknown) => {
          logError(`Голос: сбой команды ${command.type}: ${error instanceof Error ? error.message : String(error)}`);
        }),
      );
      return queue;
    },

    close: shutDown,
  };
}
