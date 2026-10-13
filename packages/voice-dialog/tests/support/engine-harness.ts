import { vi } from "vitest";
import type { AnswerEnd, AssistantActivity, AssistantTextDelta, DialogChatBridge, VoiceDialogView, VoiceSound } from "@ykurilov/agent-chat-react";
import { createVoiceDialogEngine } from "../../src/browser/dialog-engine";
import type { VoiceDialogEngineOptions } from "../../src/browser/dialog-engine";
import type { LatencyReport } from "../../src/browser/latency-meter";
import type { LeaveReason, PageLifecycleOptions } from "../../src/browser/page-lifecycle";
import type { SpeechPlayer } from "../../src/browser/speech-player";
import type { MicrophoneCapture, RunningMicrophone } from "../../src/browser/microphone-capture";
import { MicrophoneError } from "../../src/browser/microphone-capture";
import { encodeSpeechFrame } from "../../src/protocol";
import type { FillerManifestPhrase } from "../../src/protocol";

/** Журнал событий по порядку: по нему проверяется, что ушло раньше и что позже. */
export type Log = string[];

/** Браузерный WebSocket, как его видит движок: что отправлено — видно, ответы «приходят» по команде теста. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static log: Log | null = null;
  readyState = 0;
  binaryType = "blob";
  readonly sent: Array<string | Uint8Array | ArrayBuffer> = [];
  closedWith: { code?: number } | null = null;
  private readonly handlers = new Map<string, Array<(event: object) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: object) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  removeEventListener(type: string, handler: (event: object) => void) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((item) => item !== handler));
  }
  send(data: string | Uint8Array | ArrayBuffer) {
    this.sent.push(data);
    if (typeof data === "string") FakeWebSocket.log?.push(`ws:${(JSON.parse(data) as { type: string }).type}`);
  }
  close(code?: number) {
    this.closedWith = { code };
    this.readyState = 3;
  }
  private emit(type: string, event: object = {}) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }
  receive(message: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify(message) });
  }
  /** Кадр озвучки: 4 байта номера реплики и звук `ms` миллисекунд. */
  receiveSpeech(replyId: number, ms = 100) {
    const frame = encodeSpeechFrame(replyId, new Uint8Array((24_000 * 2 * ms) / 1000));
    this.emit("message", { data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
  }
  /** Сокет закрылся сам, с кодом. */
  drop(code = 1006) {
    this.readyState = 3;
    this.emit("close", { code });
  }
  fail() {
    this.emit("error");
    this.drop(1006);
  }

  get messages() {
    return this.sent.filter((item): item is string => typeof item === "string").map((text) => JSON.parse(text) as Record<string, unknown> & { type: string });
  }
  ofType(type: string) {
    return this.messages.filter((message) => message.type === type);
  }
  get audio() {
    return this.sent.filter((item) => typeof item !== "string");
  }
}

export class FakePlayer implements SpeechPlayer {
  queue: Uint8Array[] = [];
  played = 0;
  queued = 0;
  playing = false;
  /** Заполнители, которые поставили на звук, по порядку. */
  fillers: Uint8Array[] = [];
  fillerPlaying = false;
  unlocks = 0;
  flushes = 0;
  closed = false;
  audioContext: AudioContext | null = null;
  private readonly drained = new Set<() => void>();
  private readonly answerDrained = new Set<() => void>();
  constructor(private readonly log: Log) {}
  unlock() {
    this.unlocks += 1;
    this.log.push("player:unlock");
    this.audioContext = new EventTarget() as unknown as AudioContext;
    return true;
  }
  enqueue(pcm: Uint8Array) {
    this.queue.push(pcm);
    this.queued += (pcm.length / 2 / 24_000) * 1000;
    this.playing = true;
    this.log.push("player:enqueue");
  }
  playFiller(pcm: Uint8Array) {
    this.fillers.push(pcm);
    this.fillerPlaying = true;
    this.log.push("player:filler");
    return { durationMs: (pcm.length / 2 / 24_000) * 1000 };
  }
  flush() {
    this.flushes += 1;
    this.log.push("player:flush");
    this.queue = [];
    this.queued = 0;
    this.playing = false;
    this.fillerPlaying = false;
    return { playedMs: this.played };
  }
  beginReply() {
    this.played = 0;
  }
  playedMs() {
    return this.played;
  }
  queuedMs() {
    return this.queued;
  }
  isPlaying() {
    return this.playing || this.fillerPlaying;
  }
  isAnswerPlaying() {
    return this.playing;
  }
  onDrained(listener: () => void) {
    this.drained.add(listener);
    return () => void this.drained.delete(listener);
  }
  onAnswerDrained(listener: () => void) {
    this.answerDrained.add(listener);
    return () => void this.answerDrained.delete(listener);
  }
  /** Настоящий ответ доигран (заполнитель, если звучит, доигрывает сам). */
  drain() {
    this.queued = 0;
    this.playing = false;
    for (const listener of [...this.answerDrained]) listener();
    if (!this.fillerPlaying) for (const listener of [...this.drained]) listener();
  }
  /** Заполнитель договорил. */
  drainFiller() {
    this.fillerPlaying = false;
    if (!this.playing) for (const listener of [...this.drained]) listener();
  }
  async close() {
    this.closed = true;
    this.log.push("player:close");
  }
}

export class FakeMicrophone {
  onChunk: ((chunk: Int16Array) => void) | null = null;
  starts = 0;
  stops = 0;
  private settle: { resolve: (mic: RunningMicrophone) => void; reject: (error: Error) => void } | null = null;
  readonly audioContext = new EventTarget() as unknown as AudioContext;
  constructor(private readonly log: Log) {}
  capture: MicrophoneCapture = {
    start: (onChunk) => {
      this.starts += 1;
      this.log.push("mic:start");
      this.onChunk = onChunk;
      return new Promise<RunningMicrophone>((resolve, reject) => {
        this.settle = { resolve, reject };
      });
    },
  };
  /** Микрофон открылся. */
  granted() {
    this.settle?.resolve({
      audioContext: this.audioContext,
      stop: async () => {
        this.stops += 1;
        this.log.push("mic:stop");
      },
    });
  }
  refused(kind: "microphone_denied" | "microphone_missing") {
    this.settle?.reject(new MicrophoneError(kind));
  }
  /** Кусок звука из микрофона. */
  feed(samples = 640) {
    this.onChunk?.(new Int16Array(samples));
  }
}

export class FakeLifecycle {
  starts = 0;
  stops = 0;
  watched: unknown[] = [];
  private onLeave: ((reason: LeaveReason) => void) | null = null;
  create = (options: PageLifecycleOptions) => {
    this.onLeave = options.onLeave;
    return {
      start: () => void (this.starts += 1),
      watchAudio: (context: unknown) => void this.watched.push(context),
      stop: () => void (this.stops += 1),
    };
  };
  leave(reason: LeaveReason) {
    this.onLeave?.(reason);
  }
}

/** Чат глазами движка: что отправлено и остановлено, а текст и конец ответа «приходят» по команде теста. */
export class FakeBridge implements DialogChatBridge {
  sent: string[] = [];
  /** Звуки человека, ушедшие с каждым сообщением (по порядку `sent`); `undefined` — без звуков. */
  sentSounds: Array<VoiceSound[] | undefined> = [];
  /** То же для склеек (по порядку `replaced`). */
  replacedSounds: Array<VoiceSound[] | undefined> = [];
  stops = 0;
  cuts: Array<{ messageId: string; cut: { partIndex: number; charOffset: number; spokenTail: string } }> = [];
  /** Когда `stop()` кончится; по умолчанию сразу. */
  stopGate: Promise<void> | null = null;
  /** Склейки: полный текст, который просили отправить вместо прежнего сообщения. */
  replaced: string[] = [];
  /** Чем кончится склейка; по умолчанию получается. */
  replaceResult = true;
  /** Когда склейка кончится; по умолчанию сразу. */
  replaceGate: Promise<void> | null = null;
  /** Мост без склейки: `replaceLastMessage` не определён (как у старых мостов). */
  withoutReplace = false;
  private readonly textListeners = new Set<(delta: AssistantTextDelta) => void>();
  private readonly endListeners = new Set<(end: AnswerEnd) => void>();
  private readonly activityListeners = new Set<(activity: AssistantActivity) => void>();
  constructor(private readonly log: Log) {}
  send(text: string, options?: { sounds?: VoiceSound[] }) {
    this.sent.push(text);
    this.sentSounds.push(options?.sounds);
    this.log.push(`chat:send:${text}`);
  }
  async stop() {
    this.stops += 1;
    this.log.push("chat:stop");
    if (this.stopGate) await this.stopGate;
    this.log.push("chat:stopped");
  }
  get replaceLastMessage(): ((text: string, options?: { sounds?: VoiceSound[] }) => Promise<boolean>) | undefined {
    if (this.withoutReplace) return undefined;
    return async (text, options) => {
      this.replaced.push(text);
      this.replacedSounds.push(options?.sounds);
      this.log.push(`chat:replace:${text}`);
      if (this.replaceGate) await this.replaceGate;
      this.log.push("chat:replaced");
      return this.replaceResult;
    };
  }
  showCut(messageId: string, cut: { partIndex: number; charOffset: number; spokenTail: string }) {
    this.cuts.push({ messageId, cut });
  }
  subscribeAssistantText(listener: (delta: AssistantTextDelta) => void) {
    this.textListeners.add(listener);
    return () => void this.textListeners.delete(listener);
  }
  subscribeAnswerEnd(listener: (end: AnswerEnd) => void) {
    this.endListeners.add(listener);
    return () => void this.endListeners.delete(listener);
  }
  subscribeAssistantActivity(listener: (activity: AssistantActivity) => void) {
    this.activityListeners.add(listener);
    return () => void this.activityListeners.delete(listener);
  }
  get subscribers() {
    return this.textListeners.size + this.endListeners.size;
  }
  get activitySubscribers() {
    return this.activityListeners.size;
  }
  /** Модель начала или закончила размышлять / вызывать инструмент. */
  activity(kind: "reasoning" | "tool", phase: "start" | "end", options: { toolName?: string; partIndex?: number; messageId?: string } = {}) {
    const { toolName, partIndex = 0, messageId = "a1" } = options;
    for (const listener of [...this.activityListeners]) listener({ messageId, partIndex, kind, phase, ...(toolName !== undefined && { toolName }) });
  }
  say(text: string, partIndex = 0, messageId = "a1") {
    for (const listener of [...this.textListeners]) listener({ messageId, partIndex, text });
  }
  finish(status: AnswerEnd["status"] = "complete", messageId = "a1") {
    for (const listener of [...this.endListeners]) listener({ messageId, status });
  }
}

/** Заполнители на сервере глазами тестов: какие фразы, какой длины звук; `null` — на сервере их нет (404). */
export interface FillersServer {
  phrases: FillerManifestPhrase[];
  audioMs: number;
  /** Фразы, которые сервер не отдаёт (503). */
  broken?: string[];
}

export const FILLER_PHRASES: FillerManifestPhrase[] = [
  { id: "thinking-0", category: "thinking", text: "Хмм…" },
  { id: "reasoning-0", category: "reasoning", text: "Секунду, дай-ка подумаю." },
  { id: "web-0", category: "web", text: "Сейчас поищу в интернете." },
  { id: "page-0", category: "page", text: "Сейчас прочту, что там." },
  { id: "memory-0", category: "memory", text: "Дай-ка вспомню." },
  { id: "tool-0", category: "tool", text: "Сейчас гляну." },
  { id: "long-0", category: "long", text: "Ещё чуть-чуть…" },
];

export const VOICES = { voices: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }], current: "anna", persisted: true };

export function harness(overrides: Partial<VoiceDialogEngineOptions> & { voices?: typeof VOICES | null; fillersServer?: FillersServer | null } = {}) {
  const log: Log = [];
  FakeWebSocket.instances = [];
  FakeWebSocket.log = log;
  const player = new FakePlayer(log);
  const microphone = new FakeMicrophone(log);
  const lifecycle = new FakeLifecycle();
  const bridge = new FakeBridge(log);
  const views: VoiceDialogView[] = [];
  const reports: LatencyReport[] = [];
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const { voices = VOICES, fillersServer = null, ...engineOverrides } = overrides;
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, ...(typeof init?.body === "string" && { body: JSON.parse(init.body) as unknown }) });
    // Ответ собран вручную: чтение настоящего Response не укладывается в микрозадачи, а тесты идут на подменённых часах.
    if (url.includes("/fillers")) {
      if (!fillersServer) return { ok: false, status: 404, json: async () => ({}) };
      if (url.endsWith("/fillers")) return { ok: true, status: 200, json: async () => ({ phrases: fillersServer.phrases }) };
      const id = url.split("/fillers/")[1]!.split("?")[0]!;
      if (fillersServer.broken?.includes(id)) return { ok: false, status: 503, json: async () => ({}) };
      const pcm = new Uint8Array((24_000 * 2 * fillersServer.audioMs) / 1000).fill(7);
      return { ok: true, status: 200, arrayBuffer: async () => pcm.buffer };
    }
    if (method === "GET") return voices ? { ok: true, status: 200, json: async () => voices } : { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 204, json: async () => ({}) };
  });
  const engine = createVoiceDialogEngine({
    basePath: "http://test/api/voice-dialog",
    fetch: fetchFake as unknown as typeof fetch,
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
    createPlayer: () => player,
    createMicrophone: () => microphone.capture,
    createLifecycle: lifecycle.create,
    onMetrics: (report) => reports.push(report),
    ...engineOverrides,
  });
  const view = () => views.at(-1);
  const socket = () => FakeWebSocket.instances.at(-1)!;
  const flushPromises = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    engine,
    log,
    player,
    microphone,
    lifecycle,
    bridge,
    views,
    reports,
    requests,
    view,
    socket,
    flushPromises,
    /** Включить режим до «слушаю»: нажатие, сокет открыт, сервер готов, микрофон открыт. */
    async start(ready: Partial<{ speech: boolean; voiceId: string }> = {}) {
      engine.open({ chatId: "c1", chat: bridge, onView: (next) => views.push(next) });
      socket().open();
      socket().receive({ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: ready.voiceId ?? "anna", speech: ready.speech ?? true });
      microphone.granted();
      await flushPromises();
      return socket();
    },
    /** Человек договорил фразу; агент получил её и начал отвечать. */
    async saySomething(text = "Расскажи про погоду") {
      socket().receive({ type: "phrase_end", text, serverTimeMs: 1 });
      await flushPromises();
    },
    heard(words: string, confidence = 0.95, kind: "settled" | "interim" = "settled") {
      const list = words.split(" ").map((word) => ({ text: word, confidence }));
      socket().receive({ type: "heard", settled: kind === "settled" ? list : [], interim: kind === "interim" ? list : [] });
    },
  };
}
