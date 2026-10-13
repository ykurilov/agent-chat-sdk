import { openSpeech } from "../../src/server/speech-stream";
import type { SpeechStreamOptions } from "../../src/server/speech-stream";
import { FakeSocket, connectFake } from "./fake-socket";

export const KEY = "eleven-secret-key-0123456789";

export function streamWith(options: Partial<SpeechStreamOptions> = {}) {
  FakeSocket.instances = [];
  const audio: Uint8Array[] = [];
  const log = { done: 0, failed: 0 };
  const logged: string[] = [];
  const stream = openSpeech(
    { apiKey: KEY, voiceId: "voice-1", model: "eleven_v4_turbo", language: "ru", connect: connectFake, logError: (message) => logged.push(message), ...options },
    { onAudio: (chunk) => audio.push(chunk), onDone: () => (log.done += 1), onFailed: () => (log.failed += 1) },
  );
  const socket = FakeSocket.instances.at(-1)!;
  return { stream, socket, audio, log, logged };
}

