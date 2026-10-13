import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMicrophoneCapture, MicrophoneError } from "../src/browser/microphone-capture";
import type { MicrophoneCaptureOptions } from "../src/browser/microphone-capture";
import { FakeAudioContext } from "./support/fake-web-audio";

class FakeTrack {
  stopCalls = 0;
  stop() {
    this.stopCalls += 1;
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack(), new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  port: { onmessage: ((event: { data: Float32Array }) => void) | null } = { onmessage: null };
  disconnected = false;
  connectedTo: unknown = null;
  constructor(
    readonly context: unknown,
    readonly name: string,
  ) {
    FakeWorkletNode.instances.push(this);
  }
  connect(node: unknown) {
    this.connectedTo = node;
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
  /** Звук из микрофона: `ms` миллисекунд постоянного значения при частоте контекста. */
  feed(ms: number, value: number, sampleRate: number) {
    this.port.onmessage?.({ data: new Float32Array(Math.round((sampleRate * ms) / 1000)).fill(value) });
  }
}

class MicContext extends FakeAudioContext {
  audioWorklet = { addModule: vi.fn(async (_url: string) => undefined) };
  sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource(_stream: unknown) {
    return this.sourceNode;
  }
}

let stream: FakeStream;

beforeEach(() => {
  stream = new FakeStream();
  FakeAudioContext.instances = [];
  FakeWorkletNode.instances = [];
});
afterEach(() => vi.useRealTimers());

function options(overrides: Partial<MicrophoneCaptureOptions> = {}): MicrophoneCaptureOptions {
  return {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) } as unknown as MediaDevices,
    AudioContext: MicContext as unknown as typeof AudioContext,
    AudioWorkletNode: FakeWorkletNode as unknown as typeof AudioWorkletNode,
    createModuleUrl: () => "blob:capture-worklet",
    ...overrides,
  };
}

const context = () => FakeAudioContext.instances[0] as MicContext;
const node = () => FakeWorkletNode.instances[0] as FakeWorkletNode;

describe("захват микрофона: запрос и настройки", () => {
  it("эхоподавление, шумоподавление и автоусиление включены; звук один канал", async () => {
    const opts = options();
    await createMicrophoneCapture(opts).start(() => undefined);
    expect(opts.mediaDevices!.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }),
    });
  });

  it("подключает AudioWorklet: модуль загружен, узел создан и соединён с источником", async () => {
    await createMicrophoneCapture(options()).start(() => undefined);
    expect(context().audioWorklet.addModule).toHaveBeenCalledWith("blob:capture-worklet");
    expect(node().context).toBe(context());
    expect(context().sourceNode.connect).toHaveBeenCalledWith(node());
  });

  it("контекст можно возобновить (нажатие пользователя ещё действует) и отдать наружу", async () => {
    const capture = await createMicrophoneCapture(options()).start(() => undefined);
    expect(context().resumeCalls).toBeGreaterThanOrEqual(1);
    expect(capture.audioContext).toBe(context());
  });
});

describe("захват микрофона: звук наружу", () => {
  it("PCM 16 бит 16 кГц кусками 20–100 мс при частоте контекста 48 кГц", async () => {
    const chunks: Int16Array[] = [];
    await createMicrophoneCapture(options()).start((chunk) => chunks.push(chunk));
    for (let i = 0; i < 50; i++) node().feed(20, 0.5, 48_000); // одна секунда
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk).toBeInstanceOf(Int16Array);
      expect(chunk.length).toBeGreaterThanOrEqual(320); // 20 мс при 16 кГц
      expect(chunk.length).toBeLessThanOrEqual(1600); // 100 мс
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBeGreaterThan(16_000 - 1600);
    expect(total).toBeLessThanOrEqual(16_000);
  });

  it("значения переводятся в целые: 0,5 → ≈ 16383, тишина → 0, отрицательные сохраняют знак", async () => {
    const chunks: Int16Array[] = [];
    await createMicrophoneCapture(options()).start((chunk) => chunks.push(chunk));
    for (let i = 0; i < 5; i++) node().feed(20, 0.5, 48_000);
    for (let i = 0; i < 5; i++) node().feed(20, -0.25, 48_000);
    for (let i = 0; i < 5; i++) node().feed(20, 0, 48_000);
    const all = chunks.flatMap((chunk) => Array.from(chunk));
    expect(all.slice(0, 10).every((v) => Math.abs(v - 16383) <= 2)).toBe(true);
    expect(all.slice(all.length - 10).every((v) => v === 0)).toBe(true);
    expect(all.some((v) => v < -8000 && v > -8400)).toBe(true);
  });

  it("значения вне −1…1 не переполняют целое", async () => {
    const chunks: Int16Array[] = [];
    await createMicrophoneCapture(options()).start((chunk) => chunks.push(chunk));
    for (let i = 0; i < 5; i++) node().feed(20, 3, 48_000);
    const all = chunks.flatMap((chunk) => Array.from(chunk));
    expect(all.every((v) => v === 32767)).toBe(true);
  });

  it("частота контекста, не кратная 16 кГц (44,1 кГц), тоже даёт правильное число отсчётов", async () => {
    const chunks: Int16Array[] = [];
    const opts = options({
      AudioContext: class extends MicContext {
        sampleRate = 44_100;
      } as unknown as typeof AudioContext,
    });
    await createMicrophoneCapture(opts).start((chunk) => chunks.push(chunk));
    for (let i = 0; i < 100; i++) node().feed(20, 0.5, 44_100); // две секунды
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBeGreaterThan(32_000 - 1600);
    expect(total).toBeLessThanOrEqual(32_000);
  });

  it("контекст уже на 16 кГц — звук идёт как есть", async () => {
    const chunks: Int16Array[] = [];
    const opts = options({
      AudioContext: class extends MicContext {
        sampleRate = 16_000;
      } as unknown as typeof AudioContext,
    });
    await createMicrophoneCapture(opts).start((chunk) => chunks.push(chunk));
    for (let i = 0; i < 10; i++) node().feed(20, 0.5, 16_000);
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBeGreaterThanOrEqual(2560);
  });

  it("размер куска настраивается и зажимается в 20–100 мс", async () => {
    const sizes: number[] = [];
    await createMicrophoneCapture(options({ chunkMs: 500 })).start((chunk) => sizes.push(chunk.length));
    for (let i = 0; i < 50; i++) node().feed(20, 0.1, 48_000);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1600);
    const small: number[] = [];
    FakeWorkletNode.instances = [];
    FakeAudioContext.instances = [];
    await createMicrophoneCapture(options({ chunkMs: 1 })).start((chunk) => small.push(chunk.length));
    for (let i = 0; i < 50; i++) node().feed(20, 0.1, 48_000);
    expect(Math.min(...small)).toBeGreaterThanOrEqual(320);
  });

  it("громкость для индикации: 0…1 по последнему куску", async () => {
    const levels: number[] = [];
    await createMicrophoneCapture(options({ chunkMs: 20, onLevel: (level) => levels.push(level) })).start(() => undefined);
    node().feed(20, 0, 48_000);
    node().feed(20, 0.5, 48_000);
    expect(levels.length).toBeGreaterThanOrEqual(2);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeGreaterThan(0.3);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
  });

  it("узел захвата никуда не выведен: микрофон не слышен в динамиках", async () => {
    await createMicrophoneCapture(options()).start(() => undefined);
    expect(node().connectedTo).not.toBe(context().destination);
  });
});

describe("захват микрофона: ошибки", () => {
  const failWith = (name: string) =>
    options({
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("отказ", name);
        }),
      } as unknown as MediaDevices,
    });

  it.each(["NotAllowedError", "SecurityError"])("отказ пользователя (%s) → microphone_denied", async (name) => {
    const failure = await createMicrophoneCapture(failWith(name)).start(() => undefined).catch((error) => error);
    expect(failure).toBeInstanceOf(MicrophoneError);
    expect(failure.kind).toBe("microphone_denied");
  });

  it.each(["NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError"])("нет доступного микрофона (%s) → microphone_missing", async (name) => {
    const failure = await createMicrophoneCapture(failWith(name)).start(() => undefined).catch((error) => error);
    expect(failure).toBeInstanceOf(MicrophoneError);
    expect(failure.kind).toBe("microphone_missing");
  });

  it("нет mediaDevices (страница без https) → microphone_missing", async () => {
    const failure = await createMicrophoneCapture(options({ mediaDevices: undefined })).start(() => undefined).catch((error) => error);
    expect(failure).toMatchObject({ kind: "microphone_missing" });
  });

  it("нет AudioWorklet в браузере → microphone_missing, микрофон при этом освобождён", async () => {
    const opts = options({
      AudioContext: class extends MicContext {
        audioWorklet = undefined as never;
      } as unknown as typeof AudioContext,
    });
    const failure = await createMicrophoneCapture(opts).start(() => undefined).catch((error) => error);
    expect(failure).toMatchObject({ kind: "microphone_missing" });
    expect(stream.tracks.every((track) => track.stopCalls === 1)).toBe(true);
  });

  it("не удалось загрузить модуль захвата → микрофон освобождён, ошибка не проглочена", async () => {
    const opts = options({
      AudioContext: class extends MicContext {
        audioWorklet = { addModule: vi.fn(async () => Promise.reject(new Error("csp"))) };
      } as unknown as typeof AudioContext,
    });
    const failure = await createMicrophoneCapture(opts).start(() => undefined).catch((error) => error);
    expect(failure).toBeInstanceOf(MicrophoneError);
    expect(stream.tracks.every((track) => track.stopCalls === 1)).toBe(true);
  });
});

describe("захват микрофона: освобождение", () => {
  it("stop останавливает дорожки, отключает узлы, закрывает контекст и перестаёт слать звук", async () => {
    const chunks: Int16Array[] = [];
    const capture = await createMicrophoneCapture(options()).start((chunk) => chunks.push(chunk));
    node().feed(100, 0.5, 48_000);
    const before = chunks.length;
    await capture.stop();
    expect(stream.tracks.map((track) => track.stopCalls)).toEqual([1, 1]);
    expect(node().disconnected).toBe(true);
    expect(context().sourceNode.disconnect).toHaveBeenCalled();
    expect(context().closeCalls).toBe(1);
    node().feed(100, 0.5, 48_000);
    expect(chunks).toHaveLength(before);
  });

  it("дорожки останавливаются сразу, синхронно с вызовом stop", async () => {
    const capture = await createMicrophoneCapture(options()).start(() => undefined);
    void capture.stop();
    expect(stream.tracks.map((track) => track.stopCalls)).toEqual([1, 1]);
  });

  it("освобождение не дольше 2 с, даже если закрытие контекста зависло", async () => {
    vi.useFakeTimers();
    const opts = options({
      AudioContext: class extends MicContext {
        close = () => new Promise<void>(() => undefined);
      } as unknown as typeof AudioContext,
    });
    const capture = await createMicrophoneCapture(opts).start(() => undefined);
    let done = false;
    void capture.stop().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    expect(stream.tracks.every((track) => track.stopCalls === 1)).toBe(true);
  });

  it("повторный stop безопасен", async () => {
    const capture = await createMicrophoneCapture(options()).start(() => undefined);
    await capture.stop();
    await expect(capture.stop()).resolves.toBeUndefined();
    expect(stream.tracks.map((track) => track.stopCalls)).toEqual([1, 1]);
  });
});
