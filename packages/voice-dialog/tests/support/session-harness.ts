import { vi } from "vitest";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { createDialogSession } from "../../src/server/dialog-session";
import type { DialogSession, DialogSessionDeps } from "../../src/server/dialog-session";
import { createSoundsUsage } from "../../src/server/sounds-usage";
import { createSpeechUsage } from "../../src/server/speech-usage";
import { createWindowBudget } from "../../src/server/window-budget";
import { decodeSpeechFrame } from "../../src/protocol";
import type { ClientCommand, ServerMessage } from "../../src/protocol";
import { FakeSocket, connectFake } from "./fake-socket";

export const SONIOX_KEY = "soniox-secret-key-0123456789";
export const ELEVEN_KEY = "eleven-secret-key-0123456789";
export const START = { type: "start", audio: { format: "pcm_s16le", sampleRate: 16000, channels: 1 } } as const;

export interface SessionSetup {
  session: DialogSession;
  storage: ChatStorage;
  sent: ServerMessage[];
  frames: Array<{ replyId: number; audio: Uint8Array }>;
  closes: number[];
  logged: string[];
  /** Сокеты к Soniox и ElevenLabs по порядку создания. */
  soniox: () => FakeSocket;
  speech: () => FakeSocket[];
  /** Сообщения сервера определённого вида. */
  of: <T extends ServerMessage["type"]>(type: T) => Array<Extract<ServerMessage, { type: T }>>;
  command: (command: ClientCommand) => Promise<void>;
  /** Сессия начата и Soniox «ответил»: можно слать звук. */
  begin: () => void;
}

export interface SessionOverrides {
  speech?: DialogSessionDeps["config"]["speech"];
  spendingLimits?: SpendingLimits | undefined;
  idleSeconds?: number;
  maxSessionSeconds?: number;
  maxCharsPerReply?: number;
  maxCharsPerMinute?: number;
  storage?: ChatStorage;
  price?: number;
  now?: () => number;
  /** Звуки человека (Scribe): `fetch` подменён; без значения — выключены. */
  sounds?: {
    fetch: typeof fetch;
    waitMs?: number;
    maxWindowSeconds?: number;
    timeoutMs?: number;
    pricePerHour?: number;
    spendingLimits?: SpendingLimits;
    /** По умолчанию в тестах кусков нет и тишина не проверяется: звук уходит целиком на конце фразы. */
    chunkSeconds?: number;
    overlapSeconds?: number;
    silenceRms?: number;
  };
  /** Как соединиться с Soniox; по умолчанию — подмена `FakeSocket`. */
  connectUpstream?: (url: string, headers: Record<string, string>) => never;
}

/** Всё, что нужно тесту сессии диалога: подменённые Soniox и ElevenLabs, хранилище с чатом пользователя anna. */
export function sessionWith(overrides: SessionOverrides = {}): SessionSetup {
  FakeSocket.instances = [];
  const storage = overrides.storage ?? createInMemoryChatStorage();
  const sent: ServerMessage[] = [];
  const frames: SessionSetup["frames"] = [];
  const closes: number[] = [];
  const logged: string[] = [];
  const now = overrides.now ?? Date.now;
  const minuteChars = createWindowBudget({ max: overrides.maxCharsPerMinute ?? 4000, windowMs: 60_000, now });
  const session = createDialogSession({
    userId: "anna",
    chatId: "chat-1",
    voiceId: "voice-1",
    config: {
      recognition: {
        apiKey: SONIOX_KEY,
        model: "stt-rt-v5",
        language: "ru",
        endpointLatencyLevel: 2,
        maxEndpointDelayMs: 1500,
        websocketUrl: "wss://stt.test/transcribe",
        connectUpstream: overrides.connectUpstream ?? connectFake,
      },
      speech:
        "speech" in overrides
          ? overrides.speech
          : { apiKey: ELEVEN_KEY, model: "eleven_v4_turbo", language: "ru", connect: connectFake },
      sounds: overrides.sounds
        ? {
            apiKey: ELEVEN_KEY,
            model: "scribe_v2",
            language: "ru",
            baseUrl: "https://scribe.test",
            waitMs: overrides.sounds.waitMs ?? 400,
            maxWindowSeconds: overrides.sounds.maxWindowSeconds ?? 30,
            timeoutMs: overrides.sounds.timeoutMs ?? 5000,
            chunkSeconds: overrides.sounds.chunkSeconds ?? 0,
            overlapSeconds: overrides.sounds.overlapSeconds ?? 0.5,
            silenceRms: overrides.sounds.silenceRms ?? 0,
            fetch: overrides.sounds.fetch,
          }
        : null,
      idleSeconds: overrides.idleSeconds ?? 180,
      maxSessionSeconds: overrides.maxSessionSeconds ?? 1800,
      maxCharsPerReply: overrides.maxCharsPerReply ?? 2000,
    },
    takeMinuteChars: (length) => minuteChars.take("anna", length),
    storage,
    usage: createSpeechUsage({
      storage,
      model: "eleven_v4_turbo",
      pricePerThousandChars: { eleven_v4_turbo: overrides.price ?? 0.05 },
      spendingLimits: overrides.spendingLimits,
      now,
      logError: (message) => logged.push(message),
    }),
    soundsUsage: overrides.sounds
      ? createSoundsUsage({
          storage,
          model: "scribe_v2",
          pricePerHour: overrides.sounds.pricePerHour ?? 0.36,
          spendingLimits: overrides.sounds.spendingLimits,
          now,
          logError: (message) => logged.push(message),
        })
      : undefined,
    send: (message) => sent.push(message),
    sendAudio: (frame) => {
      const decoded = decodeSpeechFrame(frame);
      if (decoded) frames.push(decoded);
    },
    close: (code) => closes.push(code),
    now,
    logError: (message) => logged.push(message),
  });

  const sonioxSocket = () => FakeSocket.instances[0]!;
  return {
    session,
    storage,
    sent,
    frames,
    closes,
    logged,
    soniox: sonioxSocket,
    speech: () => FakeSocket.instances.slice(1),
    of: (type) => sent.filter((message): message is never => message.type === type),
    command: (command) => session.command(command),
    begin() {
      session.start(START);
      sonioxSocket().open();
    },
  };
}

/** Ответ Soniox: слова с уверенностью; `final` — закреплённые, иначе предварительные. Слова после первого начинаются с пробела. */
export function sonioxWords(words: string[], options: { final?: boolean; confidence?: number; end?: boolean } = {}) {
  const tokens: Array<{ text: string; is_final: boolean; confidence: number }> = words.map((text, index) => ({
    text: index === 0 ? text : ` ${text}`,
    is_final: options.final ?? false,
    confidence: options.confidence ?? 0.9,
  }));
  if (options.end) tokens.push({ text: "<end>", is_final: true, confidence: 1 });
  return { tokens };
}

/** Звук с микрофона длиной `seconds`: по секунде, с ходом времени, как в жизни (быстрее реального времени сервер закрывает режим). */
export async function listenFor(setup: Pick<SessionSetup, "session">, seconds: number): Promise<void> {
  for (let second = 0; second < seconds; second++) {
    setup.session.receiveAudio(new Uint8Array(32_000));
    await vi.advanceTimersByTimeAsync(1000);
  }
}

/** Scribe глазами теста: каждый запрос ждёт, пока тест не ответит; `bytes` — сколько звука ушло (без заголовка WAV). */
export function scribeFake() {
  const calls: Array<{
    bytes: number;
    form: FormData;
    signal: AbortSignal | null | undefined;
    reply(body: unknown): void;
    fail(status?: number): void;
    crash(): void;
  }> = [];
  const fetchFake = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<unknown>((resolve, reject) => {
        const form = init.body as FormData;
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        calls.push({
          bytes: (form.get("file") as File).size - 44,
          form,
          signal: init.signal,
          reply: (body) => resolve({ ok: true, status: 200, json: async () => body }),
          fail: (status = 500) => resolve({ ok: false, status, json: async () => ({}) }),
          crash: () => reject(new TypeError("fetch failed")),
        });
      }),
  );
  return { fetch: fetchFake as unknown as typeof fetch, calls };
}

/** Ответ Scribe со звуками: границы в секундах. */
export const scribeSounds = (...events: Array<[text: string, start: number, end: number]>) => ({
  language_code: "rus",
  words: events.map(([text, start, end]) => ({ type: "audio_event", text, start, end, logprob: 0 })),
});
