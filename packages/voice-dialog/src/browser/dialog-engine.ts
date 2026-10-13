import { splitVoiceTags } from "@ykurilov/agent-chat-react";
import type {
  AnswerEnd,
  AssistantActivity,
  AssistantTextDelta,
  VoiceDialogEngine,
  VoiceDialogError,
  VoiceDialogOpenOptions,
  VoiceDialogView,
  VoiceDialogVoice,
} from "@ykurilov/agent-chat-react";
import { DIALOG_CLOSE_CODES, decodeSpeechFrame, MIC_SAMPLE_RATE } from "../protocol";
import type { ClientCommand, DialogErrorKind, HumanSoundKind, ServerMessage } from "../protocol";
import { createBargeInFilter } from "./barge-in-filter";
import type { BargeInFilter, BargeInFilterOptions } from "./barge-in-filter";
import { createDialogState } from "./dialog-state";
import { createFillerClient } from "./filler-client";
import type { FillerClient } from "./filler-client";
import { createFillerScheduler, DEFAULT_FILLER_SETTINGS } from "./filler-scheduler";
import type { FillerClock, FillerSchedulerSettings } from "./filler-scheduler";
import { createLatencyMeter } from "./latency-meter";
import type { LatencyReport } from "./latency-meter";
import { createMicrophoneCapture, MicrophoneError } from "./microphone-capture";
import type { MicrophoneCapture, MicrophoneCaptureOptions, RunningMicrophone } from "./microphone-capture";
import { createPageLifecycle } from "./page-lifecycle";
import type { PageLifecycle, PageLifecycleOptions } from "./page-lifecycle";
import { createSpeechPlayer } from "./speech-player";
import type { SpeechPlayer } from "./speech-player";
import { createSpokenText, sourcePositionAtSpoken } from "./spoken-text";
import { createHumanSounds } from "./human-sounds";
import { expectedSoundsFor, interjectionsIn, soundKindsOfTag, soundKindsOfText } from "./voice-tag-sounds";
import type { SpokenSentence, SpokenText } from "./spoken-text";
import { createVoiceClient, voicesForMenu } from "./voices";

export interface VoiceDialogEngineOptions {
  /** Общий путь режима на сервере, например `/api/voice-dialog`; можно и полный адрес. */
  basePath: string;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  /** Класс звукового контекста; по умолчанию браузерный. `undefined` — «звука нет». */
  audioContext?: typeof AudioContext | undefined;
  mediaDevices?: MediaDevices | undefined;
  now?: () => number;
  /** Настройки отсева эха и перебивания: слова с уверенностью ниже игнорируются, `stopWords` перебивают всегда. */
  bargeIn?: { minConfidence?: number; ignoreWords?: string[]; stopWords?: string[]; echoWindowMs?: number };
  /** Сколько после конца куска озвучки со смехом или вздохом такой же звук в микрофоне ещё считается эхом (задержка микрофона), мс. По умолчанию 600. */
  soundEchoTailMs?: number;
  /** Замер задержки «конец фразы → первый звук» по каждому ходу. Никуда не отправляется. */
  onMetrics?: (report: LatencyReport) => void;
  language?: string;
  /**
   * Заполнители: короткие фразы голосом («Хмм…», «Сейчас поищу…»), пока модель молчит, думает или вызывает инструмент.
   * `false` — выключены. Пороги и правила — `settings` (по умолчанию `DEFAULT_FILLER_SETTINGS`); `clock` и `random` — для тестов.
   * Сами фразы задаются на сервере (`speech.fillerPhrases`).
   */
  fillers?: false | { settings?: Partial<FillerSchedulerSettings>; clock?: FillerClock; random?: () => number };
  /** Подмены частей для тестов; в продукте не нужны. */
  createPlayer?: () => SpeechPlayer;
  createMicrophone?: (options: { onLevel(level: number): void }) => MicrophoneCapture;
  createLifecycle?: (options: PageLifecycleOptions) => PageLifecycle;
}

/** Через сколько после обрыва связи пробовать снова; три попытки, потом «нет связи». */
const RECONNECT_DELAYS_MS = [300, 1000, 2000];
/** Как часто отмечать в фильтре эха, что уже прозвучало. */
const NOTE_INTERVAL_MS = 400;
/** Сколько знаков в секунду произносит голос: по этому счёту из проигранного времени получается озвученный текст. */
const SPOKEN_CHARS_PER_SECOND = 15;
/** Отмечаем чуть вперёд проигранного: эхо приходит в микрофон позже, чем звук ушёл в динамик, но распознавание — с задержкой. */
const NOTE_LEAD_MS = 500;
/** Громкость для индикации: вид обновляется, только когда она изменилась заметно. */
const LEVEL_STEP = 0.05;
const WEBSOCKET_OPEN = 1;

/** Что режим показывает, когда сервер закрыл соединение сам с таким кодом: повторять нечего. */
const CLOSE_ERRORS: Record<number, VoiceDialogError> = {
  [DIALOG_CLOSE_CODES.normal]: "idle",
  [DIALOG_CLOSE_CODES.invalidMessage]: "service_unavailable",
  [DIALOG_CLOSE_CODES.noUser]: "service_unavailable",
  [DIALOG_CLOSE_CODES.spendingLimit]: "limit",
  [DIALOG_CLOSE_CODES.foreignChat]: "service_unavailable",
  [DIALOG_CLOSE_CODES.idle]: "idle",
  [DIALOG_CLOSE_CODES.audioTooLarge]: "service_unavailable",
  [DIALOG_CLOSE_CODES.tooMany]: "rate_limited",
  [DIALOG_CLOSE_CODES.recognitionUnavailable]: "recognition_lost",
  1011: "service_unavailable",
};

const SERVER_ERRORS: Record<DialogErrorKind, VoiceDialogError> = {
  recognition_lost: "recognition_lost",
  service_unavailable: "service_unavailable",
  rate_limited: "rate_limited",
  invalid: "service_unavailable",
};

/** Часть текста ответа в общем потоке говоримого текста: по ней позиция обрыва переводится обратно в часть сообщения. */
interface Segment {
  partIndex: number;
  start: number;
  length: number;
}

/** Одна реплика агента: от отправки слов до конца звука. */
interface Reply {
  id: number;
  /** Слова человека, ушедшие в чат этой репликой: к ним дописываются следующие фразы, пока ответа нет. */
  words: string;
  messageId: string | undefined;
  /** Модель начала вызов инструмента: это уже действие, ход склеивать нельзя. */
  acted: boolean;
  /** Идёт склейка: чат заменяет сообщение человека склеенным; события прежнего ответа не относятся к реплике. */
  replacing: boolean;
  /** Фразы, пришедшие во время склейки: они допишутся к склеенному, когда она кончится. */
  heldWords: string[];
  /** Ответы, чьи события пришли во время склейки: после неё они чужие. */
  supersededIds: Set<string>;
  /** Озвучка была доступна, когда реплика началась: prepare ушёл на сервер. */
  prepared: boolean;
  spoken: SpokenText;
  /** Предложения, ушедшие на озвучку: по ним считается позиция обрыва. */
  sentences: SpokenSentence[];
  segments: Segment[];
  streamLength: number;
  lastPart: number | null;
  textDone: boolean;
  serverDone: boolean;
  /** Сервер сказал, что озвучки не будет. */
  failed: boolean;
  /** Связь оборвалась посреди реплики: её озвучка потеряна. */
  lost: boolean;
  audioStarted: boolean;
}

interface Session {
  close(): void;
  voiceChosen(id: string): void;
  refresh(): void;
}

interface EngineShared {
  voices: VoiceDialogVoice[] | undefined;
  /** Звук заполнителей по голосам; `null` — заполнители выключены. Живёт столько же, сколько движок: выключение режима его не сбрасывает. */
  fillers: FillerClient | null;
  currentVoiceId(): string | undefined;
  loadVoices(): Promise<unknown>;
  selectVoice(id: string): Promise<void>;
}

/** Голосовой режим для `AgentChat`: слушает, отправляет фразы, озвучивает ответ и даёт себя перебить. */
export function createVoiceDialogEngine(options: VoiceDialogEngineOptions): VoiceDialogEngine {
  const voiceClient = createVoiceClient({ basePath: options.basePath, ...(options.fetch && { fetch: options.fetch }) });
  const shared: EngineShared = {
    voices: undefined,
    fillers: options.fillers === false ? null : createFillerClient({ basePath: options.basePath, ...(options.fetch && { fetch: options.fetch }) }),
    currentVoiceId: () => voiceClient.currentVoiceId(),
    loadVoices: () => engine.loadVoices(),
    selectVoice: (id) => engine.selectVoice(id),
  };
  let session: Session | null = null;

  const engine: VoiceDialogEngine = {
    open(open) {
      session?.close();
      session = startSession(options, shared, open);
    },
    close() {
      const closing = session;
      session = null;
      closing?.close();
    },
    async selectVoice(id) {
      await voiceClient.selectVoice(id);
      session?.voiceChosen(id);
    },
    async loadVoices() {
      const loaded = await voiceClient.loadVoices();
      shared.voices = voicesForMenu(loaded);
      session?.refresh();
      return loaded;
    },
  };
  return engine;
}

function socketUrl(basePath: string, chatId: string): string {
  const path = `${basePath.replace(/\/+$/, "")}/stream?chatId=${encodeURIComponent(chatId)}`;
  if (/^wss?:/i.test(path)) return path;
  if (/^https?:/i.test(path)) return path.replace(/^http/i, "ws");
  const location = (globalThis as { location?: { protocol: string; host: string } }).location;
  return `${location?.protocol === "https:" ? "wss:" : "ws:"}//${location?.host ?? "localhost"}${path.startsWith("/") ? "" : "/"}${path}`;
}

function startSession(options: VoiceDialogEngineOptions, shared: EngineShared, { chat, chatId, onView }: VoiceDialogOpenOptions): Session {
  const now = options.now ?? (() => Date.now());
  const state = createDialogState();
  const latency = createLatencyMeter({ now });
  const barge: BargeInFilter = createBargeInFilter(bargeInOptions(options, now));
  /** Звуки человека (смех, вздох), ждущие следующего сообщения: уходят вместе со словами, ход сами не запускают. */
  const humanSounds = createHumanSounds({ now, ...(options.soundEchoTailMs !== undefined && { echoTailMs: options.soundEchoTailMs }) });
  const player = options.createPlayer?.() ?? createSpeechPlayer("audioContext" in options ? { AudioContext: options.audioContext } : {});
  const microphone = createMicrophone(options, (level) => {
    if (Math.abs(level - shownLevel) < LEVEL_STEP) return;
    shownLevel = level;
    publish();
  });
  const WebSocketClass = options.WebSocket ?? globalThis.WebSocket;
  const url = socketUrl(options.basePath, chatId);
  /** Голос хода: заполнитель звучит тем же голосом, что и ответ. */
  let turnVoiceId: string | undefined;
  /** Голос, который сервер назвал в «готов»: нужен заполнителям, если список голосов не получен. */
  let serverVoiceId: string | undefined;
  const fillerClient = shared.fillers;
  const fillers = fillerClient ? createFillerScheduler(fillerSchedulerDeps(options, fillerClient)) : null;

  function fillerSchedulerDeps(engineOptions: VoiceDialogEngineOptions, client: FillerClient): Parameters<typeof createFillerScheduler>[0] {
    const custom = engineOptions.fillers || undefined;
    return {
      settings: {
        ...DEFAULT_FILLER_SETTINGS,
        ...custom?.settings,
        toolCategories: { ...DEFAULT_FILLER_SETTINGS.toolCategories, ...custom?.settings?.toolCategories },
      },
      ...(custom?.clock && { clock: custom.clock }),
      ...(custom?.random && { random: custom.random }),
      phrases: (category) => (turnVoiceId ? client.phrases(turnVoiceId, category) : []),
      isAnswerAudioPlaying: () => player.isAnswerPlaying(),
      speak(phrase) {
        const pcm = turnVoiceId ? client.audio(turnVoiceId, phrase.id) : undefined;
        if (!alive || !speechAvailable || !pcm || !player.playFiller(pcm)) return false;
        // Свой голос из динамика не должен перебивать самого себя.
        barge.noteSpoken(phrase.text);
        const kinds = soundKindsOfText(phrase.text);
        if (kinds.length > 0) humanSounds.noteAgentSounds(kinds, { from: now(), until: now() + (phrase.text.length * 1000) / SPOKEN_CHARS_PER_SECOND });
        return true;
      },
    };
  }

  let alive = true;
  let speechAvailable = true;
  let shownLevel = 0;
  let socket: WebSocket | null = null;
  /** Сообщение start на текущем соединении уже ушло: с этого момента можно слать звук. */
  let started = false;
  let serverReady = false;
  let micReady = false;
  let running: RunningMicrophone | null = null;
  let voicesRequested = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let noteTimer: ReturnType<typeof setInterval> | undefined;
  let replyCounter = 0;
  let reply: Reply | null = null;
  /** Реплики, которым послан interrupt: ждём от сервера, сколько знаков озвучено. */
  const cutting = new Map<number, Reply>();
  /** Одна очередь отправки: остановка прежнего ответа всегда раньше следующих слов. */
  let sendChain: Promise<void> = Promise.resolve();
  /** Фразы, которые ждут отправки (например, пока идёт остановка): уходят одним сообщением, ни одна не теряется. */
  let pendingWords: string[] = [];
  let pendingPhraseEndAt = 0;
  /** Ответы, которые для режима закончены (перебиты или дозвучали): их поздние события не относятся к новой реплике. */
  const retiredMessageIds = new Set<string>();
  const unsubscribe: Array<() => void> = [];

  const lifecycle = (options.createLifecycle ?? createPageLifecycle)({ onLeave: () => fail("backgrounded") });

  function publish() {
    const snapshot = state.current();
    const voice = shared.currentVoiceId();
    const view: VoiceDialogView = {
      state: snapshot.state,
      ...(snapshot.error && { error: snapshot.error }),
      speechAvailable,
      ...(shared.voices && { voices: shared.voices }),
      ...(voice && { currentVoiceId: voice }),
      level: shownLevel,
      onToggle: () => {},
      onSelectVoice: (id) => void shared.selectVoice(id).catch(() => undefined),
    };
    onView(view);
  }

  function sendJson(command: ClientCommand) {
    if (socket?.readyState === WEBSOCKET_OPEN) socket.send(JSON.stringify(command));
  }

  /** Освободить всё: микрофон, соединение, звук, слежение за страницей. Второй вызов ничего не делает. */
  function release() {
    if (!alive) return;
    alive = false;
    clearTimeout(reconnectTimer);
    stopNoting();
    for (const off of unsubscribe.splice(0)) off();
    fillers?.dispose();
    lifecycle.stop();
    const closing = socket;
    socket = null;
    try {
      closing?.close(DIALOG_CLOSE_CODES.normal);
    } catch {
      // соединение уже закрыто
    }
    void running?.stop().catch(() => undefined);
    running = null;
    player.flush();
    void player.close().catch(() => undefined);
  }

  function fail(error: VoiceDialogError) {
    if (!alive) return;
    state.dispatch({ type: "failed", error });
    release();
    publish();
  }

  function tryConnected() {
    if (!serverReady || !micReady) return;
    if (state.dispatch({ type: "connected" })) publish();
  }

  // ─── озвученное для фильтра эха ────────────────────────────────────────────

  function startNoting(current: Reply) {
    stopNoting();
    let noted = 0;
    const tick = () => {
      if (reply !== current) return;
      // Теги голоса не произносятся словами: в счёте скорости их знаков нет, а вместо них ждём звуки (смех, вздох).
      const { plain: text, tags } = splitVoiceTags(current.sentences.map((sentence) => sentence.text).join(" "));
      const target = Math.min(text.length, Math.floor(((player.playedMs() + NOTE_LEAD_MS) / 1000) * SPOKEN_CHARS_PER_SECOND));
      if (target <= noted) return;
      let end = target;
      while (end < text.length && !/\s/.test(text[end]!)) end++;
      // Звук в тексте принадлежит куску, если стоит в нём; тег в самом конце ответа — последнему куску.
      const inChunk = (at: number) => at >= noted && (at < end || end === text.length);
      const chunkTags = tags.filter((tag) => inChunk(tag.at));
      const sounds = chunkTags.flatMap((tag) => expectedSoundsFor(tag.name));
      const spoken = text.slice(noted, end);
      barge.noteSpoken([spoken, ...sounds].join(" "));
      // Свой смех и вздох голоса: Scribe услышит их в микрофоне, но это не звуки человека. Эхо — только пока играет этот кусок.
      const kinds = [...chunkTags.flatMap((tag) => soundKindsOfTag(tag.name)), ...interjectionsIn(text).filter((item) => inChunk(item.at)).flatMap((item) => item.kinds)];
      const playsAt = (chars: number) => now() + (chars * 1000) / SPOKEN_CHARS_PER_SECOND - player.playedMs();
      if (kinds.length > 0) humanSounds.noteAgentSounds(kinds, { from: playsAt(noted), until: playsAt(end) });
      noted = end;
    };
    tick();
    noteTimer = setInterval(tick, NOTE_INTERVAL_MS);
  }

  function stopNoting() {
    clearInterval(noteTimer);
    noteTimer = undefined;
  }

  // ─── ход реплики ───────────────────────────────────────────────────────────

  function expectsSpeech(current: Reply): boolean {
    return current.prepared && !current.failed && !current.lost && current.sentences.length > 0;
  }

  function maybeFinish() {
    const current = reply;
    if (!current || !current.textDone) return;
    if (expectsSpeech(current) && !current.serverDone) return;
    if (player.isPlaying()) return;
    stopNoting();
    fillers?.turnEnded();
    if (current.messageId) retiredMessageIds.add(current.messageId);
    reply = null;
    latency.finishTurn();
    barge.reset();
    if (state.dispatch({ type: "reply_finished" })) publish();
  }

  function speakSentences(current: Reply, sentences: SpokenSentence[]) {
    for (const sentence of sentences) {
      if (!current.prepared || current.failed || current.lost) continue;
      latency.mark("firstSentenceAt");
      current.sentences.push(sentence);
      sendJson({ type: "speak", replyId: current.id, text: sentence.text, ...(current.messageId && { messageId: current.messageId }) });
    }
  }

  function onAssistantText(delta: AssistantTextDelta) {
    const current = reply;
    const phase = state.current().state;
    if (!current || current.textDone || (phase !== "thinking" && phase !== "speaking")) return;
    if (current.replacing) return void current.supersededIds.add(delta.messageId);
    // Поздние куски прежнего ответа (остановка ещё идёт) не принадлежат новой реплике.
    if (retiredMessageIds.has(delta.messageId) || (current.messageId !== undefined && current.messageId !== delta.messageId)) return;
    current.messageId ??= delta.messageId;
    fillers?.answerText();
    latency.mark("firstTextAt");
    if (current.lastPart !== delta.partIndex) {
      // Части ответа — отдельные абзацы: пустая строка не даёт предложениям разных частей слиться.
      if (current.streamLength > 0) {
        speakSentences(current, current.spoken.push("\n\n"));
        current.streamLength += 2;
      }
      current.segments.push({ partIndex: delta.partIndex, start: current.streamLength, length: 0 });
      current.lastPart = delta.partIndex;
    }
    const segment = current.segments.at(-1)!;
    segment.length += delta.text.length;
    current.streamLength += delta.text.length;
    speakSentences(current, current.spoken.push(delta.text));
  }

  function onAnswerEnd(end: AnswerEnd) {
    const current = reply;
    const phase = state.current().state;
    if (!current || current.textDone || (phase !== "thinking" && phase !== "speaking")) return;
    if (current.replacing) return void (end.messageId && current.supersededIds.add(end.messageId));
    // Пустой id — отказ отправки: своего ответа у реплики не будет, закрываем её. Чужой конец (прежний ответ) реплику не закрывает.
    if (end.messageId && (retiredMessageIds.has(end.messageId) || (current.messageId !== undefined && current.messageId !== end.messageId))) return;
    speakSentences(current, current.spoken.finish());
    current.textDone = true;
    fillers?.turnEnded();
    if (current.prepared && !current.failed && !current.lost) sendJson({ type: "end_reply", replyId: current.id });
    maybeFinish();
  }

  /** Размышление или вызов инструмента в ответе, который сейчас ждёт реплика: заполнителю есть о чём говорить. */
  function onAssistantActivity(activity: AssistantActivity) {
    const current = reply;
    const phase = state.current().state;
    if (!current || current.textDone || (phase !== "thinking" && phase !== "speaking")) return;
    if (current.replacing) return void current.supersededIds.add(activity.messageId);
    if (retiredMessageIds.has(activity.messageId) || (current.messageId !== undefined && current.messageId !== activity.messageId)) return;
    current.messageId ??= activity.messageId;
    if (activity.kind === "tool" && activity.phase === "start") current.acted = true;
    const key = `${activity.messageId}:${activity.partIndex}`;
    if (activity.phase === "end") fillers?.activityEnded(key);
    else fillers?.activityStarted(key, activity.kind, activity.toolName);
  }

  function onSpeechFrame(replyId: number, audio: Uint8Array) {
    const current = reply;
    if (!current || current.id !== replyId || current.lost) return;
    player.enqueue(audio);
    if (current.audioStarted) return;
    current.audioStarted = true;
    latency.mark("firstSampleAt");
    const report = latency.finishTurn();
    if (report) options.onMetrics?.(report);
    if (state.dispatch({ type: "speech_started" })) publish();
    startNoting(current);
  }

  /**
   * Новые слова можно дописать к предыдущей фразе: ответ ещё ничего не показал (ни текста, ни звука, ни действия),
   * а чат умеет заменять сообщение. Заполнитель («Хмм…») не в счёт: это голос режима, а не ответ модели.
   */
  function canGlue(): boolean {
    const current = reply;
    if (!current || !chat.replaceLastMessage || state.current().state !== "thinking") return false;
    return !current.acted && !current.audioStarted && !current.textDone && current.streamLength === 0;
  }

  /** Слова человека, пока агент думает или говорит: перебивание, если это не эхо и не междометие. */
  function onHeard(heard: Extract<ServerMessage, { type: "heard" }>) {
    const phase = state.current().state;
    if (phase !== "thinking" && phase !== "speaking") return;
    // Склейка идёт: фраза досчитывается по её концу, и ход пока не трогаем.
    if (reply?.replacing) return;
    const decision = barge.feed(heard);
    if (!decision.interrupt) return;
    // Обычные слова в ожидании ответа не останавливают ход: фраза допишется к предыдущей, когда кончится. Стоп-слово и два междометия — сразу.
    if (decision.reason === "words" && canGlue()) return;
    interrupt();
  }

  function interrupt() {
    const current = reply;
    if (!current) return;
    const { playedMs } = player.flush();
    fillers?.turnEnded();
    sendJson({ type: "interrupt", replyId: current.id, playedMs: Math.round(playedMs) });
    stopNoting();
    cutting.set(current.id, current);
    retire(current);
    reply = null;
    barge.reset();
    if (state.dispatch({ type: "interrupted" })) publish();
    // Остановка начинается сразу; следующие слова уйдут, только когда она закончится.
    const stopped = Promise.resolve(chat.stop()).catch(() => undefined);
    sendChain = sendChain.then(() => stopped);
  }

  /** Ответы реплики для режима закончены: их поздние события не относятся к следующей реплике. */
  function retire(current: Reply) {
    if (current.messageId) retiredMessageIds.add(current.messageId);
    for (const id of current.supersededIds) retiredMessageIds.add(id);
  }

  function onPhraseEnd(text: string) {
    const words = text.trim();
    const phase = state.current().state;
    if (phase === "listening") {
      barge.reset();
      if (words) queueSend(words);
    } else if (phase === "thinking" || phase === "speaking") {
      // Слова успели дойти до конца фразы, а перебивания не было: смотрим на них целиком.
      barge.reset();
      const decision = barge.feed({ settled: words.split(/\s+/).filter(Boolean).map((word) => ({ text: word, confidence: 1 })), interim: [] });
      barge.reset();
      if (!words || !decision.interrupt || !reply) return;
      if (reply.replacing) {
        // Прежняя склейка ещё идёт: фраза ждёт и допишется следом (даже стоп-слово: ход сейчас всё равно пересоздаётся).
        reply.heldWords.push(words);
      } else if (decision.reason === "words" && canGlue()) {
        glue(reply, words);
      } else {
        interrupt();
        queueSend(words);
      }
    } else if (phase === "interrupted") {
      if (words) queueSend(words);
      else if (state.dispatch({ type: "listening_again" })) publish();
    }
  }

  /**
   * Продолжение фразы, пока у хода нет ни текста, ни звука: чат заменяет прежнее сообщение склеенным, и модель отвечает один раз.
   * Реплика остаётся прежней, пока чат не ответил: не вышло — всё как при обычном перебивании.
   */
  function glue(current: Reply, words: string) {
    current.replacing = true;
    const phraseEndAt = now();
    const sounds = humanSounds.take();
    void chat.replaceLastMessage!(`${current.words} ${words}`, sounds.length > 0 ? { sounds } : undefined).then(
      (replaced) => finishGlue(current, words, phraseEndAt, replaced, sounds),
      () => finishGlue(current, words, phraseEndAt, false, sounds),
    );
  }

  function finishGlue(current: Reply, words: string, phraseEndAt: number, replaced: boolean, sounds: HumanSoundKind[]) {
    current.replacing = false;
    // Звуки не ушли с правкой: уйдут со следующим сообщением.
    if (!replaced) humanSounds.restore(sounds);
    if (!alive || reply !== current) return;
    const held = current.heldWords.splice(0);
    if (!replaced) {
      // Чат не склеил (у ответа уже есть текст, сервер отказал): новые слова идут отдельным сообщением, как при перебивании.
      interrupt();
      queueSend([words, ...held].join(" "));
      return;
    }
    const { playedMs } = player.flush();
    fillers?.turnEnded();
    sendJson({ type: "interrupt", replyId: current.id, playedMs: Math.round(playedMs) });
    stopNoting();
    retire(current);
    barge.reset();
    const next = startReply(`${current.words} ${words}`, phraseEndAt);
    if (held.length > 0) glue(next, held.join(" "));
  }

  function queueSend(words: string) {
    pendingWords.push(words);
    pendingPhraseEndAt = now();
    sendChain = sendChain
      .then(() => {
        // Первое звено забирает всё накопленное; звенья тех, что склеились, находят пусто.
        if (pendingWords.length === 0) return;
        const joined = pendingWords.join(" ");
        pendingWords = [];
        return deliver(joined, pendingPhraseEndAt);
      })
      .catch(() => undefined);
  }

  function deliver(words: string, phraseEndAt: number) {
    const phase = state.current().state;
    if (!alive || (phase !== "listening" && phase !== "interrupted")) return;
    startReply(words, phraseEndAt);
    const sounds = humanSounds.take();
    chat.send(words, sounds.length > 0 ? { sounds } : undefined);
  }

  /** Новая реплика: с этого момента ждём ответ агента на `words`. */
  function startReply(words: string, phraseEndAt: number): Reply {
    replyCounter += 1;
    const current: Reply = {
      id: replyCounter,
      words,
      messageId: undefined,
      acted: false,
      replacing: false,
      heldWords: [],
      supersededIds: new Set(),
      prepared: speechAvailable,
      spoken: createSpokenText(),
      sentences: [],
      segments: [],
      streamLength: 0,
      lastPart: null,
      textDone: false,
      serverDone: false,
      failed: false,
      lost: false,
      audioStarted: false,
    };
    reply = current;
    turnVoiceId = activeVoiceId();
    player.beginReply();
    latency.mark("phraseEndAt", phraseEndAt);
    if (state.dispatch({ type: "phrase_sent" })) publish();
    if (current.prepared) sendJson({ type: "prepare", replyId: current.id });
    if (current.prepared) fillers?.turnStarted();
    return current;
  }

  function onSpeechCut(message: Extract<ServerMessage, { type: "speech_cut" }>) {
    const target = cutting.get(message.replyId);
    cutting.delete(message.replyId);
    if (!target?.messageId || message.spokenChars <= 0 || target.segments.length === 0) return;
    const position = sourcePositionAtSpoken(target.sentences, message.spokenChars);
    const segment = [...target.segments].reverse().find((item) => item.start <= position) ?? target.segments[0]!;
    const charOffset = Math.min(Math.max(position - segment.start, 0), segment.length);
    const cut = { partIndex: segment.partIndex, charOffset, spokenTail: message.spokenTail };
    sendJson({ type: "mark_cut", replyId: target.id, messageId: target.messageId, ...cut });
    // Хранилище может не помнить обрыв: на экране отметка появляется сразу и не ждёт ответа сервера.
    chat.showCut(target.messageId, cut);
  }

  /** Голос человека из списка голосов; не получен список — голос, который назвал сервер. */
  function activeVoiceId(): string | undefined {
    return shared.currentVoiceId() ?? serverVoiceId;
  }

  /** Звук заполнителей голоса человека: в фоне; не успел — заполнитель в этот ход пропускается. */
  function loadFillers() {
    const voiceId = activeVoiceId();
    if (!alive || !speechAvailable || !fillerClient || !voiceId) return;
    void fillerClient.load(voiceId, chatId);
  }

  function onServerMessage(message: ServerMessage) {
    switch (message.type) {
      case "ready":
        serverReady = true;
        reconnectAttempts = 0;
        speechAvailable = message.speech && speechAvailable;
        serverVoiceId = message.voiceId || undefined;
        if (!voicesRequested) {
          voicesRequested = true;
          // Заполнители не ждут успеха списка голосов: упал список — фразы грузятся голосом из «готов».
          void shared
            .loadVoices()
            .catch(() => undefined)
            .then(() => loadFillers());
        }
        tryConnected();
        publish();
        break;
      case "heard":
        onHeard(message);
        break;
      case "phrase_end":
        humanSounds.hear(message.sounds);
        onPhraseEnd(message.text);
        break;
      case "sounds":
        // Звуки, найденные позже конца фразы: ждут следующей, сами хода не запускают.
        humanSounds.hear(message.sounds);
        break;
      case "speech_started":
        if (reply?.id === message.replyId) latency.mark("speechStartedAt");
        break;
      case "speech_done":
        if (reply?.id === message.replyId) {
          reply.serverDone = true;
          maybeFinish();
        }
        break;
      case "speech_cut":
        onSpeechCut(message);
        break;
      case "speech_failed":
        if (reply?.id !== message.replyId) break;
        reply.failed = true;
        // Потолок знаков касается одной реплики; остальное — озвучки не будет, пока не изменится сервер или лимит.
        if (message.kind !== "cap") {
          speechAvailable = false;
          publish();
        }
        maybeFinish();
        break;
      case "error":
        fail(SERVER_ERRORS[message.kind]);
        break;
      case "cut_saved":
      case "cut_rejected":
      case "idle_warning":
        break;
    }
  }

  // ─── соединение ────────────────────────────────────────────────────────────

  function connect() {
    const ws = new WebSocketClass(url);
    ws.binaryType = "arraybuffer";
    socket = ws;
    started = false;
    serverReady = false;
    ws.addEventListener("open", () => {
      if (socket !== ws || !alive) return;
      ws.send(
        JSON.stringify({
          type: "start",
          audio: { format: "pcm_s16le", sampleRate: MIC_SAMPLE_RATE, channels: 1 },
          ...(options.language && { language: options.language }),
        }),
      );
      started = true;
    });
    ws.addEventListener("message", (event) => {
      if (socket !== ws || !alive) return;
      const data = (event as MessageEvent).data as unknown;
      if (typeof data === "string") {
        try {
          onServerMessage(JSON.parse(data) as ServerMessage);
        } catch {
          // непонятное сообщение сервера пропускаем: режим не должен падать от него
        }
        return;
      }
      if (data instanceof ArrayBuffer) {
        const frame = decodeSpeechFrame(new Uint8Array(data));
        if (frame) onSpeechFrame(frame.replyId, frame.audio);
      }
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws || !alive) return;
      onSocketClosed((event as CloseEvent).code);
    });
  }

  function onSocketClosed(code: number) {
    socket = null;
    started = false;
    serverReady = false;
    const known = CLOSE_ERRORS[code];
    if (known) return fail(known);
    // Связь оборвалась посреди реплики: озвучка этого ответа потеряна, текст доходит и без неё.
    if (reply) {
      reply.lost = true;
      stopNoting();
      player.flush();
      maybeFinish();
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts];
    if (delay === undefined) return fail("network");
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      if (alive) connect();
    }, delay);
  }

  // ─── запуск ────────────────────────────────────────────────────────────────

  state.dispatch({ type: "open" });
  publish();
  // Всё, что браузер разрешает только по нажатию, — здесь же, синхронно: звук, микрофон, экран.
  if (!player.unlock()) speechAvailable = false;
  lifecycle.start();
  if (player.audioContext) lifecycle.watchAudio(player.audioContext);
  unsubscribe.push(chat.subscribeAssistantText(onAssistantText), chat.subscribeAnswerEnd(onAnswerEnd));
  unsubscribe.push(player.onDrained(maybeFinish));
  if (fillers) {
    unsubscribe.push(player.onAnswerDrained(() => fillers.answerAudioEnded()));
    const unsubscribeActivity = chat.subscribeAssistantActivity?.(onAssistantActivity);
    if (unsubscribeActivity) unsubscribe.push(unsubscribeActivity);
  }
  microphone
    .start((chunk) => {
      // Кусок собран захватом заново и лежит в своём обычном буфере.
      if (socket?.readyState === WEBSOCKET_OPEN && started) socket.send(chunk as Int16Array<ArrayBuffer>);
    })
    .then(
      (mic) => {
        if (!alive) {
          void mic.stop().catch(() => undefined);
          return;
        }
        running = mic;
        micReady = true;
        lifecycle.watchAudio(mic.audioContext);
        tryConnected();
      },
      (error: unknown) => fail(error instanceof MicrophoneError ? error.kind : "microphone_missing"),
    );
  connect();

  return {
    close() {
      state.dispatch({ type: "close" });
      release();
      publish();
    },
    voiceChosen(id) {
      sendJson({ type: "voice", voiceId: id });
      if (alive && speechAvailable && fillerClient) void fillerClient.load(id, chatId);
      publish();
    },
    refresh: publish,
  };
}

function bargeInOptions(options: VoiceDialogEngineOptions, now: () => number): BargeInFilterOptions {
  const { minConfidence, ignoreWords, stopWords, echoWindowMs } = options.bargeIn ?? {};
  return {
    now,
    ...(minConfidence !== undefined && { minConfidence }),
    ...(ignoreWords && { fillers: ignoreWords }),
    ...(stopWords && { stopWords }),
    ...(echoWindowMs !== undefined && { echoWindowMs }),
  };
}

function createMicrophone(options: VoiceDialogEngineOptions, onLevel: (level: number) => void): MicrophoneCapture {
  if (options.createMicrophone) return options.createMicrophone({ onLevel });
  const capture: MicrophoneCaptureOptions = {
    onLevel,
    ...("mediaDevices" in options && { mediaDevices: options.mediaDevices }),
    ...("audioContext" in options && { AudioContext: options.audioContext }),
  };
  return createMicrophoneCapture(capture);
}
