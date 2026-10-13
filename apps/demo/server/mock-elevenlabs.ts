import type { UpstreamSocket } from "@ykurilov/agent-chat-voice/server";

/**
 * Подмена ElevenLabs для стенда в режиме `mock` и для тестов: настоящей сети нет.
 * На каждое предложение приходят короткие куски звука (по 4 знака, ровный тон, PCM s16le 24 кГц) и `alignment`.
 * Знак звучит ровно `MOCK_MS_PER_CHAR` мс, поэтому позиция обрыва предсказуема.
 */
export const MOCK_MS_PER_CHAR = 60;

const CHARS_PER_CHUNK = 4;
const OPEN_DELAY_MS = 10;
const CHUNK_INTERVAL_MS = 20;
const SAMPLE_RATE = 24_000;
const BYTES_PER_MS = 48;
const TONE_HZ = 220;
const AMPLITUDE = 3_000;

type Handler = (event: object) => void;

export function createMockElevenLabs(): UpstreamSocket {
  const handlers = new Map<string, Handler[]>();
  const queue: string[] = [];
  let samplesMade = 0;
  let finishing = false;
  let announcedEnd = false;
  let closed = false;
  let ticker: ReturnType<typeof setTimeout> | undefined;

  const emit = (type: string, event: object = {}) => {
    for (const handler of handlers.get(type) ?? []) handler(event);
  };
  const say = (message: object) => {
    if (!closed) emit("message", { data: JSON.stringify(message) });
  };

  function tone(byteLength: number): Uint8Array {
    const pcm = new Uint8Array(byteLength);
    const view = new DataView(pcm.buffer);
    for (let offset = 0; offset < byteLength; offset += 2) {
      view.setInt16(offset, Math.round(Math.sin((2 * Math.PI * TONE_HZ * samplesMade) / SAMPLE_RATE) * AMPLITUDE), true);
      samplesMade += 1;
    }
    return pcm;
  }

  function step() {
    ticker = undefined;
    if (closed) return;
    const piece = queue.shift();
    if (piece !== undefined) {
      const chars = piece.split("");
      say({
        audio: Buffer.from(tone(chars.length * MOCK_MS_PER_CHAR * BYTES_PER_MS)).toString("base64"),
        alignment: {
          chars,
          char_start_times_ms: chars.map((_, index) => index * MOCK_MS_PER_CHAR),
          char_durations_ms: chars.map(() => MOCK_MS_PER_CHAR),
        },
      });
    }
    if (queue.length > 0) ticker = setTimeout(step, CHUNK_INTERVAL_MS);
    else if (finishing && !announcedEnd) {
      announcedEnd = true;
      say({ is_final: true });
    }
  }

  const schedule = () => {
    if (!ticker && !closed) ticker = setTimeout(step, CHUNK_INTERVAL_MS);
  };

  const socket: UpstreamSocket = {
    readyState: 0,
    send(data) {
      if (closed || typeof data !== "string" || !data.startsWith("{")) return;
      const message = JSON.parse(data) as { inputs?: Array<{ text?: string }>; close_socket?: boolean };
      for (const input of message.inputs ?? []) {
        const text = input.text ?? "";
        for (let index = 0; index < text.length; index += CHARS_PER_CHUNK) queue.push(text.slice(index, index + CHARS_PER_CHUNK));
      }
      if (message.close_socket) finishing = true;
      if (queue.length > 0 || finishing) schedule();
    },
    close() {
      closed = true;
      socket.readyState = 3;
      clearTimeout(ticker);
    },
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler as Handler]);
    },
  };
  setTimeout(() => {
    if (closed) return;
    socket.readyState = 1;
    emit("open");
  }, OPEN_DELAY_MS);
  return socket;
}
