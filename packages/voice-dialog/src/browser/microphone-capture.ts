import { MIC_SAMPLE_RATE } from "../protocol";
import { CAPTURE_PROCESSOR_NAME, CAPTURE_WORKLET_SOURCE } from "./capture-worklet";

/** Что не так с микрофоном, в терминах, которые показывает режим. */
export class MicrophoneError extends Error {
  constructor(readonly kind: "microphone_denied" | "microphone_missing") {
    super(kind);
    this.name = "MicrophoneError";
  }
}

export interface MicrophoneCaptureOptions {
  /** Длина куска, мс; зажимается в 20–100. По умолчанию 40. */
  chunkMs?: number;
  /** Громкость последнего куска, 0…1: для индикации. */
  onLevel?(level: number): void;
  /** Подмены среды для тестов; по умолчанию — браузерные. `undefined` — «такого нет в браузере». */
  mediaDevices?: MediaDevices | undefined;
  AudioContext?: typeof AudioContext | undefined;
  AudioWorkletNode?: typeof AudioWorkletNode | undefined;
  /** Адрес модуля захвата по его коду; по умолчанию — `Blob`-адрес. */
  createModuleUrl?(source: string): string;
}

export interface MicrophoneCapture {
  /** Открыть микрофон и слать звук кусками PCM s16le 16 кГц. Звать в нажатии пользователя. */
  start(onChunk: (chunk: Int16Array) => void): Promise<RunningMicrophone>;
}

export interface RunningMicrophone {
  /** Контекст захвата: за ним следит жизненный цикл страницы. */
  readonly audioContext: AudioContext;
  /** Освободить микрофон сразу; остальное закрывается не дольше `RELEASE_TIMEOUT_MS`. */
  stop(): Promise<void>;
}

const MIN_CHUNK_MS = 20;
const MAX_CHUNK_MS = 100;
const DEFAULT_CHUNK_MS = 40;
const RELEASE_TIMEOUT_MS = 2000;

export function createMicrophoneCapture(options: MicrophoneCaptureOptions = {}): MicrophoneCapture {
  return { start: (onChunk) => startCapture(options, onChunk) };
}

function pick<T, K extends keyof MicrophoneCaptureOptions>(options: MicrophoneCaptureOptions, key: K, fallback: () => T | undefined): T | undefined {
  return key in options ? (options[key] as T | undefined) : fallback();
}

async function startCapture(options: MicrophoneCaptureOptions, onChunk: (chunk: Int16Array) => void): Promise<RunningMicrophone> {
  const mediaDevices = pick<MediaDevices, "mediaDevices">(options, "mediaDevices", () => (typeof navigator === "undefined" ? undefined : navigator.mediaDevices));
  const AudioContextClass = pick<typeof AudioContext, "AudioContext">(options, "AudioContext", () => (typeof AudioContext === "undefined" ? undefined : AudioContext));
  const WorkletNodeClass = pick<typeof AudioWorkletNode, "AudioWorkletNode">(options, "AudioWorkletNode", () => (typeof AudioWorkletNode === "undefined" ? undefined : AudioWorkletNode));
  if (!mediaDevices?.getUserMedia || !AudioContextClass || !WorkletNodeClass) throw new MicrophoneError("microphone_missing");

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new MicrophoneError(name === "NotAllowedError" || name === "SecurityError" ? "microphone_denied" : "microphone_missing");
  }

  const releaseTracks = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  try {
    context = new AudioContextClass();
    if (!context.audioWorklet) throw new Error("AudioWorklet недоступен");
    void context.resume().catch(() => undefined);
    await context.audioWorklet.addModule((options.createModuleUrl ?? createBlobUrl)(CAPTURE_WORKLET_SOURCE));
    source = context.createMediaStreamSource(stream);
    node = new WorkletNodeClass(context, CAPTURE_PROCESSOR_NAME);
    const chunker = createChunker(context.sampleRate, clamp(options.chunkMs ?? DEFAULT_CHUNK_MS), onChunk, options.onLevel);
    let running = true;
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (running) chunker.push(event.data);
    };
    // Узел никуда не выведен: микрофон не должен звучать в динамиках.
    source.connect(node);

    const runningContext = context;
    const runningNode = node;
    const runningSource = source;
    let stopping: Promise<void> | null = null;
    return {
      audioContext: runningContext,
      stop() {
        if (stopping) return stopping;
        running = false;
        releaseTracks();
        runningNode.port.onmessage = null;
        runningNode.disconnect();
        runningSource.disconnect();
        stopping = withTimeout(runningContext.close().catch(() => undefined), RELEASE_TIMEOUT_MS);
        return stopping;
      },
    };
  } catch (error) {
    releaseTracks();
    void context?.close().catch(() => undefined);
    throw error instanceof MicrophoneError ? error : new MicrophoneError("microphone_missing");
  }
}

function clamp(chunkMs: number): number {
  return Math.min(MAX_CHUNK_MS, Math.max(MIN_CHUNK_MS, chunkMs));
}

function createBlobUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
}

function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Собирает звук с частотой контекста в куски PCM 16 кГц нужной длины. */
function createChunker(inputRate: number, chunkMs: number, onChunk: (chunk: Int16Array) => void, onLevel?: (level: number) => void) {
  const chunkSamples = Math.round((MIC_SAMPLE_RATE * chunkMs) / 1000);
  const step = inputRate / MIC_SAMPLE_RATE;
  const pending = new Int16Array(chunkSamples);
  let filled = 0;
  let sum = 0;
  let count = 0;
  /** Сколько входных отсчётов уже отдано в текущий выходной. Дробное, если частоты не кратны. */
  let position = 0;
  let peak = 0;

  function emit(value: number) {
    const clipped = Math.max(-1, Math.min(1, value));
    pending[filled++] = clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767);
    if (filled === chunkSamples) {
      onChunk(pending.slice());
      onLevel?.(Math.min(1, peak));
      filled = 0;
      peak = 0;
    }
  }

  return {
    push(samples: Float32Array) {
      if (step === 1) {
        for (const value of samples) {
          peak = Math.max(peak, Math.abs(value));
          emit(value);
        }
        return;
      }
      // Каждый выходной отсчёт — среднее входных, попавших в его окно (с долями на краях): это же и сглаживание.
      for (const value of samples) {
        peak = Math.max(peak, Math.abs(value));
        let rest = 1;
        while (rest > 0) {
          const room = step - position;
          const take = Math.min(rest, room);
          sum += value * take;
          count += take;
          position += take;
          rest -= take;
          if (position >= step - 1e-9) {
            emit(sum / count);
            sum = 0;
            count = 0;
            position = 0;
          }
        }
      }
    },
  };
}
