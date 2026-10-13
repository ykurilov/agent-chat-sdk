import { vi } from "vitest";
import type { VoiceListener } from "../../src/index";

/** Подмена дорожки микрофона: помнит, остановлена ли. */
export class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

export class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  get released() {
    return this.tracks.every((track) => track.stopped);
  }
}

type Listener = (event: never) => void;

class Emitter {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((known) => known !== listener));
  }
  protected emit(type: string, event: object = {}) {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: object) => void)(event);
  }
}

/** Подмена MediaRecorder: куски записи «приходят» по команде теста. */
export class FakeMediaRecorder extends Emitter {
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  startedWithChunkMs: number | undefined;
  /** Какие форматы «умеет» браузер; `undefined` — у браузера нет `isTypeSupported`. */
  static supportedTypes: string[] | undefined = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supportedTypes?.includes(type) ?? false;
  }
  constructor(
    readonly stream: FakeStream,
    readonly options?: { mimeType?: string },
  ) {
    super();
    FakeMediaRecorder.instances.push(this);
  }
  start(chunkMs?: number) {
    this.state = "recording";
    this.startedWithChunkMs = chunkMs;
  }
  /** Браузер при остановке отдаёт последний кусок, затем `stop`. */
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.emit("dataavailable", { data: new Blob([new Uint8Array([9, 9])]) });
    this.emit("stop");
  }
  produceChunk(...bytes: number[]) {
    this.emit("dataavailable", { data: new Blob([new Uint8Array(bytes)]) });
  }
  fail() {
    this.emit("error", { error: new Error("recorder failed") });
  }
}

/** Подмена WebSocket Soniox: что отправлено — видно, ответы сервера «приходят» по команде теста. */
export class FakeWebSocket extends Emitter {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  readonly sent: Array<string | ArrayBuffer | Blob> = [];
  closedByClient = false;
  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer | Blob) {
    this.sent.push(data);
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  receive(message: unknown) {
    this.emit("message", { data: typeof message === "string" ? message : JSON.stringify(message) });
  }
  dropConnection(code = 1006) {
    this.readyState = 3;
    this.emit("close", { code });
  }
  /** Сервер закрыл соединение с кодом. */
  closeFromServer(code: number) {
    this.dropConnection(code);
  }
  failToConnect() {
    this.emit("error");
    this.dropConnection();
  }
}

/** Ответ без настоящего потока тела: проверки со временными таймерами не зависят от очереди потоков. */
export function fakeResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

export const sessionResponse = {
  apiKey: "temp:1",
  expiresAt: "2026-09-30T00:00:00.000Z",
  websocketUrl: "wss://stt.test/transcribe",
  model: "stt-rt-v5",
  languageHints: ["ru"],
};

export interface Harness {
  events: string[];
  texts: Array<{ finalText: string; interimText: string }>;
  listener: VoiceListener;
  stream: FakeStream;
  getUserMedia: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  options: {
    api: string;
    fetch: typeof fetch;
    WebSocket: typeof WebSocket;
    MediaRecorder: typeof MediaRecorder;
    mediaDevices: MediaDevices;
    stopTimeoutMs?: number;
    polishTimeoutMs?: number;
    mode?: "direct" | "relay";
    relayUrl?: string;
  };
  recorder(): FakeMediaRecorder;
  socket(): FakeWebSocket;
}

/** Всё, что нужно тесту диктовки: подмены среды, слушатель с журналом событий. */
export function createHarness(overrides: { getUserMedia?: () => Promise<unknown>; fetch?: () => Promise<Response> } = {}): Harness {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  FakeWebSocket.instances = [];
  const stream = new FakeStream();
  const events: string[] = [];
  const texts: Harness["texts"] = [];
  const getUserMedia = vi.fn(overrides.getUserMedia ?? (async () => stream));
  const fetchStub = vi.fn(overrides.fetch ?? (async () => fakeResponse(sessionResponse)));
  const listener: VoiceListener = {
    onConnected: () => events.push("connected"),
    onText: (text) => {
      texts.push(text);
      events.push(`text:${text.finalText}|${text.interimText}`);
    },
    onError: (kind) => events.push(`error:${kind}`),
    onEnd: () => events.push("end"),
    onPolishing: () => events.push("polishing"),
    onPolished: (text) => events.push(`polished:${text}`),
  };
  return {
    events,
    texts,
    listener,
    stream,
    getUserMedia,
    fetch: fetchStub,
    options: {
      api: "/api/voice",
      fetch: fetchStub as unknown as typeof fetch,
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia } as unknown as MediaDevices,
    },
    recorder: () => FakeMediaRecorder.instances.at(-1)!,
    socket: () => FakeWebSocket.instances.at(-1)!,
  };
}

/** Даёт выполниться цепочке обещаний. */
export const settle = () => vi.waitFor(() => undefined, { interval: 1 }).then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
