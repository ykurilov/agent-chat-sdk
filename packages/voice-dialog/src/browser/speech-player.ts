import { SPEECH_SAMPLE_RATE } from "../protocol";

export interface SpeechPlayerOptions {
  /** Подмена для тестов; `undefined` — «в этом браузере звука нет». */
  AudioContext?: typeof AudioContext | undefined;
}

export interface SpeechPlayer {
  /** Создать и возобновить звук. Звать синхронно внутри нажатия: иначе Safari на iPhone промолчит. `false` — звука в браузере нет. */
  unlock(): boolean;
  /** Поставить кусок озвучки (PCM s16le 24 кГц, моно) в очередь; играет сразу, встык к предыдущему. */
  enqueue(pcm: Uint8Array): void;
  /** Мгновенная тишина: всё поставленное глушится, очередь пуста. Возвращает, сколько звука реально проиграно. */
  flush(): { playedMs: number };
  /**
   * Заполнитель («Хмм…», «Сейчас поищу…»): короткая фраза, отдельный источник. В счёт реплики не входит: `playedMs`, `flush().playedMs`
   * и отметка обрыва её не видят. Настоящий ответ, поставленный после, встаёт сразу за ней. `flush` и `close` глушат и её.
   * `null` — звука нет или фраза пустая. PCM s16le 24 кГц, моно.
   */
  playFiller(pcm: Uint8Array): { durationMs: number } | null;
  /** Новая реплика: счёт проигранного начинается заново. */
  beginReply(): void;
  /** Сколько звука проиграно с начала реплики (по часам `AudioContext`), без пауз между кусками. */
  playedMs(): number;
  /** Сколько поставленного звука ещё не проиграно. */
  queuedMs(): number;
  /** Звучит что-нибудь, и ответ, и заполнитель. */
  isPlaying(): boolean;
  /** Звучит настоящий ответ (заполнитель не считается). */
  isAnswerPlaying(): boolean;
  /** Всё поставленное доиграно, и ответ, и заполнитель (не при `flush`). Возвращает отписку. */
  onDrained(listener: () => void): () => void;
  /** Поставленный ответ доигран (заполнитель не считается; не при `flush`). Возвращает отписку. */
  onAnswerDrained(listener: () => void): () => void;
  /** Контекст для слежения за жизненным циклом; до `unlock` — `null`. */
  readonly audioContext: AudioContext | null;
  close(): Promise<void>;
}

/** Запас впереди «сейчас», чтобы кусок не опоздал к собственному началу. */
const START_LEAD_S = 0.02;

interface QueuedChunk {
  source: AudioBufferSourceNode;
  startsAt: number;
  durationS: number;
}

export function createSpeechPlayer(options: SpeechPlayerOptions = {}): SpeechPlayer {
  const AudioContextClass = "AudioContext" in options ? options.AudioContext : typeof AudioContext === "undefined" ? undefined : AudioContext;
  let context: AudioContext | null = null;
  let active = new Set<QueuedChunk>();
  /** Заполнители: звучат отдельно от реплики и в её счёт не входят. */
  let fillers = new Set<QueuedChunk>();
  /** Все куски реплики с начала: по ним считается проигранное. */
  let replyChunks: QueuedChunk[] = [];
  let nextStartsAt = 0;
  let leftover: number | null = null;
  const drainedListeners = new Set<() => void>();
  const answerDrainedListeners = new Set<() => void>();

  function played(chunk: QueuedChunk, time: number): number {
    return Math.min(Math.max(time - chunk.startsAt, 0), chunk.durationS);
  }

  function silence(chunk: QueuedChunk) {
    chunk.source.onended = null;
    try {
      chunk.source.stop();
    } catch {
      // уже остановлен или не начинал — тишина всё равно нужна
    }
    chunk.source.disconnect();
  }

  function playedMs(): number {
    if (!context) return 0;
    const time = context.currentTime;
    return replyChunks.reduce((sum, chunk) => sum + played(chunk, time), 0) * 1000;
  }

  /** Целое число 16-битных отсчётов в числа −1…1. */
  function toSamples(pcm: Uint8Array): Float32Array {
    const samples = Math.floor(pcm.length / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
    const out = new Float32Array(samples);
    for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
  }

  /** Кусок реплики: нечётный байт в конце дожидается следующего куска. */
  function toFloat(pcm: Uint8Array): Float32Array {
    const withCarry = leftover === null ? pcm : Uint8Array.from([leftover, ...pcm]);
    leftover = withCarry.length % 2 === 1 ? withCarry[withCarry.length - 1]! : null;
    return toSamples(withCarry);
  }

  /** Поставить звук в общую очередь по времени: встык к тому, что уже стоит. */
  function schedule(samples: Float32Array, ctx: AudioContext): QueuedChunk {
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    const buffer = ctx.createBuffer(1, samples.length, SPEECH_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const chunk: QueuedChunk = {
      source,
      startsAt: Math.max(ctx.currentTime + START_LEAD_S, nextStartsAt),
      durationS: buffer.duration,
    };
    nextStartsAt = chunk.startsAt + chunk.durationS;
    return chunk;
  }

  function notify(listeners: Set<() => void>) {
    for (const listener of [...listeners]) listener();
  }

  return {
    unlock() {
      if (!AudioContextClass) return false;
      context ??= new AudioContextClass();
      void context.resume().catch(() => undefined);
      // Тихий буфер, запущенный прямо в нажатии, окончательно открывает звук в Safari.
      const silent = context.createBufferSource();
      silent.buffer = context.createBuffer(1, 1, SPEECH_SAMPLE_RATE);
      silent.connect(context.destination);
      silent.start(0);
      return true;
    },

    enqueue(pcm) {
      const ctx = context;
      if (!ctx) return;
      const samples = toFloat(pcm);
      if (samples.length === 0) return;
      const chunk = schedule(samples, ctx);
      const { source } = chunk;
      source.onended = () => {
        active.delete(chunk);
        source.disconnect();
        if (active.size > 0) return;
        notify(answerDrainedListeners);
        if (fillers.size === 0) notify(drainedListeners);
      };
      active.add(chunk);
      replyChunks.push(chunk);
      source.start(chunk.startsAt);
    },

    playFiller(pcm) {
      const ctx = context;
      if (!ctx) return null;
      const even = pcm.subarray(0, pcm.length - (pcm.length % 2));
      const samples = toSamples(even);
      if (samples.length === 0) return null;
      const chunk = schedule(samples, ctx);
      const { source } = chunk;
      source.onended = () => {
        fillers.delete(chunk);
        source.disconnect();
        if (fillers.size === 0 && active.size === 0) notify(drainedListeners);
      };
      fillers.add(chunk);
      source.start(chunk.startsAt);
      return { durationMs: chunk.durationS * 1000 };
    },

    flush() {
      const playedSoFar = playedMs();
      for (const chunk of active) silence(chunk);
      for (const chunk of fillers) silence(chunk);
      active = new Set();
      fillers = new Set();
      replyChunks = [];
      nextStartsAt = 0;
      leftover = null;
      return { playedMs: playedSoFar };
    },

    beginReply() {
      // Что ещё играет, относится к прошлой реплике и в счёт новой не входит.
      replyChunks = [];
      leftover = null;
    },

    playedMs,

    queuedMs() {
      if (!context) return 0;
      const time = context.currentTime;
      let remaining = 0;
      for (const chunk of active) remaining += chunk.durationS - played(chunk, time);
      return remaining * 1000;
    },

    isPlaying: () => active.size > 0 || fillers.size > 0,

    isAnswerPlaying: () => active.size > 0,

    onDrained(listener) {
      drainedListeners.add(listener);
      return () => drainedListeners.delete(listener);
    },

    onAnswerDrained(listener) {
      answerDrainedListeners.add(listener);
      return () => answerDrainedListeners.delete(listener);
    },

    get audioContext() {
      return context;
    },

    async close() {
      for (const chunk of active) silence(chunk);
      for (const chunk of fillers) silence(chunk);
      active = new Set();
      fillers = new Set();
      replyChunks = [];
      nextStartsAt = 0;
      leftover = null;
      const closing = context;
      context = null;
      await closing?.close().catch(() => undefined);
    },
  };
}
