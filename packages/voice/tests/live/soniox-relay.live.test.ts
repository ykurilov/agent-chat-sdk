// Живая проверка режима «звук через наш сервер» (FR-011): настоящий клиент `createVoiceInput({ mode: "relay" })`
// → настоящий Hono-сервер на Node с `@hono/node-ws` → настоящий Soniox. Микрофон подменён записью озвученной фразы.
// Проверяет и время: предварительные слова идут по ходу речи, финал приходит после «стоп» (`finalize` → `<fin>`),
// а с ключом Together (TOGETHER_API_KEY) — ещё и чистка текста моделью, один настоящий вызов.
// Запуск: `pnpm test:live soniox-relay`. Ключи — из окружения (`pnpm secrets:load`).
// Из России адрес WebSocket Soniox для сервера задаёт SONIOX_WEBSOCKET_URL (нужен маршрут прокси до stt-rt.soniox.com).
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountVoiceRelay } from "../../src/hono";
import { createVoiceInput } from "../../src/index";
import { createTextPolisher, createVoiceRelay } from "../../src/server";
import { expectPhraseRecognized, speechAs, upstreamSettings } from "./support";

const chunkBytes = 480;

/** Микрофон и запись, подменённые готовым звуком: куски идут так же, как из MediaRecorder. */
function playbackOf(audio: Buffer, onAudioSent: () => void) {
  class PlaybackRecorder {
    private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
    private timer: ReturnType<typeof setInterval> | undefined;
    state: "inactive" | "recording" = "inactive";
    static isTypeSupported = () => true;
    addEventListener(name: string, listener: (event: unknown) => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }
    private emit(name: string, event?: unknown) {
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    }
    start() {
      this.state = "recording";
      let offset = 0;
      this.timer = setInterval(() => {
        if (offset >= audio.length) {
          clearInterval(this.timer);
          return onAudioSent();
        }
        this.emit("dataavailable", { data: new Blob([new Uint8Array(audio.subarray(offset, offset + chunkBytes))]) });
        offset += chunkBytes;
      }, 15);
    }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      clearInterval(this.timer);
      this.emit("stop");
    }
  }
  const stream = { getTracks: () => [{ stop() {} }] };
  return {
    MediaRecorder: PlaybackRecorder as unknown as typeof MediaRecorder,
    mediaDevices: { getUserMedia: async () => stream } as unknown as MediaDevices,
  };
}

describe.skipIf(!process.env.SONIOX_API_KEY)("Soniox через сервер приложения (relay)", () => {
  let server: ReturnType<typeof serve>;
  let port: number;

  beforeAll(async () => {
    const app = new Hono();
    const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
    const relay = createVoiceRelay({ resolveUser: async () => ({ id: "live-test" }), ...upstreamSettings() });
    mountVoiceRelay(app, "/api/voice/stream", relay, upgradeWebSocket);
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        port = (info as AddressInfo).port;
        resolve();
      });
    });
    injectWebSocket(server);
  });
  afterAll(() => {
    server.close();
  });

  it("клиент → сервер → Soniox: слова идут по ходу речи, финал после «стоп», ключа в браузере нет", async () => {
    const audio = speechAs(["-c:a", "libopus", "-b:a", "32k", "-f", "webm"]);
    const startedAt = Date.now();
    const timeline: Array<{ ms: number; kind: string; text?: string }> = [];
    const mark = (kind: string, text?: string) => timeline.push({ ms: Date.now() - startedAt, kind, ...(text !== undefined && { text }) });
    let latest = "";
    let stop: () => void = () => undefined;
    const session = createVoiceInput({
      api: "/api/voice",
      mode: "relay",
      relayUrl: `ws://127.0.0.1:${port}/api/voice/stream`,
      // Человек нажимает «стоп», когда договорил: здесь — когда весь звук отдан.
      ...playbackOf(audio, () => {
        mark("стоп");
        stop();
      }),
    }).start({
      onConnected: () => mark("подключено"),
      onText: (text) => {
        latest = text.finalText + text.interimText;
        mark(text.interimText ? "предварительный" : "закреплённый", latest);
      },
      onError: (kind) => mark(`ошибка:${kind}`),
      onEnd: () => mark("конец"),
    });
    stop = () => session.stop();

    await expect.poll(() => timeline.some((entry) => entry.kind === "конец"), { timeout: 60_000, interval: 200 }).toBe(true);
    session.cancel();
    console.log(`Таймлайн relay (мс от начала):\n${timeline.map((entry) => `${String(entry.ms).padStart(6)}  ${entry.kind}${entry.text ? `: ${entry.text}` : ""}`).join("\n")}`);

    expect(timeline.some((entry) => entry.kind.startsWith("ошибка"))).toBe(false);
    const stopAt = timeline.find((entry) => entry.kind === "стоп")!.ms;
    const firstWords = timeline.find((entry) => entry.kind === "предварительный")!;
    // Слова показаны по ходу речи, до «стоп», а не пачкой в конце.
    expect(firstWords.ms).toBeLessThan(stopAt);
    // Финал закреплён после «стоп»: диктовка закончилась не позже таймаута ожидания.
    const endAt = timeline.at(-1)!.ms;
    expect(endAt).toBeGreaterThanOrEqual(stopAt);
    expect(endAt - stopAt).toBeLessThan(3_000);
    expectPhraseRecognized(latest);
  }, 90_000);
});

describe.skipIf(!process.env.SONIOX_API_KEY || !process.env.TOGETHER_API_KEY)("Soniox + чистка моделью через сервер приложения", () => {
  let server: ReturnType<typeof serve>;
  let port: number;

  beforeAll(async () => {
    const app = new Hono();
    const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
    const relay = createVoiceRelay({
      resolveUser: async () => ({ id: "live-test" }),
      polish: { provider: "together", env: process.env },
      logError: (message) => console.error(message),
      ...upstreamSettings(),
    });
    mountVoiceRelay(app, "/api/voice/stream", relay, upgradeWebSocket);
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        port = (info as AddressInfo).port;
        resolve();
      });
    });
    injectWebSocket(server);
  });
  afterAll(() => {
    server.close();
  });

  it("после «стоп» приходит исправленный текст от настоящей модели (один вызов Together)", async () => {
    const audio = speechAs(["-c:a", "libopus", "-b:a", "32k", "-f", "webm"]);
    const events: string[] = [];
    let spoken = "";
    let polished: string | undefined;
    let stop: () => void = () => undefined;
    const session = createVoiceInput({
      api: "/api/voice",
      mode: "relay",
      relayUrl: `ws://127.0.0.1:${port}/api/voice/stream`,
      ...playbackOf(audio, () => stop()),
    }).start({
      onConnected: () => events.push("connected"),
      onText: (text) => void (spoken = text.finalText + text.interimText),
      onPolishing: () => events.push("polishing"),
      onPolished: (text) => {
        polished = text;
        events.push("polished");
      },
      onError: (kind) => events.push(`error:${kind}`),
      onEnd: () => events.push("end"),
    });
    stop = () => session.stop();

    await expect.poll(() => events.includes("end"), { timeout: 60_000, interval: 200 }).toBe(true);
    session.cancel();
    console.log(`Soniox: ${spoken}\nПосле чистки: ${polished ?? "(осталось как есть)"}`);

    expect(events).not.toContainEqual(expect.stringMatching(/^error:/));
    expect(events).toEqual(["connected", "polishing", "polished", "end"]);
    expectPhraseRecognized(polished!);
    // Знаки и заглавные на месте, смысл не изменён.
    expect(polished![0]).toBe(polished![0]!.toUpperCase());
    expect(polished).toMatch(/[.!]$/);
  }, 90_000);
});

describe.skipIf(!process.env.TOGETHER_API_KEY)("чистка моделью: вопрос агенту остаётся вопросом", () => {
  it("«как тебя зовут» после чистки — тот же вопрос, а не ответ на него (один вызов Together)", async () => {
    const polisher = createTextPolisher({ provider: "together", env: process.env }, (message) => console.error(message))!;
    const spoken = "ну э-э как тебя зовут и что ты умеешь делать";

    const polished = await polisher(spoken);
    console.log(`Вопрос: ${spoken}\nПосле чистки: ${polished ?? "(модель отвергнута, остаётся текст Soniox)"}`);

    // Либо вопрос остался вопросом, либо ответ отвергнут защитой и остаётся текст Soniox: ответом на вопрос он быть не может.
    if (polished !== null) {
      expect(polished).toMatch(/\?$/);
      expect(polished.toLowerCase()).toContain("как тебя зовут");
      expect(polished.toLowerCase()).not.toContain("меня зовут");
    }
  }, 30_000);
});
