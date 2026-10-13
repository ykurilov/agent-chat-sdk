// Общее для живых проверок голоса: озвучка русской фразы, сессия от обработчика сервера, диктовка по WebSocket.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { buildStartMessage, createTranscript } from "../../src/soniox-messages";
import type { VoiceSessionParameters } from "../../src/request-session";
import { createVoiceHandler } from "../../src/server";

export const phrase = "Привет, это проверка голосового ввода. Сегодня хорошая погода.";

/** Настройки прокси из окружения: из России ключ запрашивается через него. */
export function upstreamSettings() {
  const proxyToken = process.env.PROXY_TOKEN;
  return {
    ...(process.env.SONIOX_API_BASE_URL && { apiBaseUrl: process.env.SONIOX_API_BASE_URL }),
    ...(process.env.SONIOX_WEBSOCKET_URL && { websocketUrl: process.env.SONIOX_WEBSOCKET_URL }),
    ...(proxyToken && { apiHeaders: { "X-Proxy-Token": proxyToken } }),
  };
}

/** Озвученная фраза, перекодированная ffmpeg в нужный контейнер (аргументы кодека и формата). */
export function speechAs(ffmpegArguments: string[]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "voice-live-"));
  try {
    execFileSync("say", ["-v", "Milena", "-o", join(dir, "speech.aiff"), phrase]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-i", join(dir, "speech.aiff"), "-ac", "1", "-ar", "16000", ...ffmpegArguments, join(dir, "out.bin")]);
    return readFileSync(join(dir, "out.bin"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Сессия так, как её получает браузер: от обработчика сервера. */
export async function requestSession(): Promise<VoiceSessionParameters> {
  const handler = createVoiceHandler({ basePath: "/api/voice", resolveUser: async () => ({ id: "live-test" }), ...upstreamSettings() });
  const response = await handler.fetch(new Request("http://live.test/api/voice/session", { method: "POST" }));
  expect(response.status).toBe(200);
  return (await response.json()) as VoiceSessionParameters;
}

/** Диктовка напрямую в Soniox, как из браузера: первое сообщение, куски звука, конец звука. Возвращает закреплённый текст. */
export function dictate(session: VoiceSessionParameters, audio: Buffer, chunkBytes: number, audioFormat = "auto"): Promise<string> {
  return new Promise((resolve, reject) => {
    const transcript = createTranscript();
    const socket = new WebSocket(session.websocketUrl);
    const timer = setTimeout(() => reject(new Error("Soniox не ответил за 60 секунд")), 60_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ ...buildStartMessage(session), audio_format: audioFormat }));
      for (let offset = 0; offset < audio.length; offset += chunkBytes) socket.send(new Uint8Array(audio.subarray(offset, offset + chunkBytes)));
      socket.send("");
    });
    socket.addEventListener("message", (event) => {
      const result = transcript.accept(String(event.data));
      if (result.type === "error") {
        clearTimeout(timer);
        reject(new Error("Soniox вернул ошибку"));
      }
      if (result.type === "finished") {
        clearTimeout(timer);
        socket.close();
        resolve(transcript.current().finalText);
      }
    });
    socket.addEventListener("error", () => reject(new Error("не удалось соединиться с Soniox (из России нужен SONIOX_WEBSOCKET_URL)")));
  });
}

export function expectPhraseRecognized(text: string) {
  const lower = text.toLowerCase();
  expect(lower).toContain("привет");
  expect(lower).toContain("проверка");
  expect(lower).toContain("погода");
}
