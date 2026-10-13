/** Договор WebSocket голосового диалога: сообщения клиента и сервера, коды закрытия. См. docs/contracts/voice-dialog/dialog.md. */

export const DIALOG_CLOSE_CODES = {
  normal: 1000,
  invalidMessage: 4400,
  noUser: 4401,
  spendingLimit: 4402,
  foreignChat: 4403,
  idle: 4408,
  /** Звука с микрофона пришло больше, чем бывает в реальном времени. */
  audioTooLarge: 4413,
  tooMany: 4429,
  recognitionUnavailable: 4502,
} as const;

export const MIC_SAMPLE_RATE = 16_000;
export const SPEECH_SAMPLE_RATE = 24_000;

export interface StartMessage {
  type: "start";
  audio: { format: "pcm_s16le"; sampleRate: 16000; channels: 1 };
  language?: string;
}

export type ClientCommand =
  | { type: "prepare"; replyId: number }
  | { type: "speak"; replyId: number; text: string; messageId?: string }
  | { type: "end_reply"; replyId: number }
  | { type: "interrupt"; replyId: number; playedMs: number }
  | { type: "mark_cut"; replyId: number; messageId: string; partIndex: number; charOffset: number; spokenTail: string }
  | { type: "voice"; voiceId: string }
  | { type: "ping" };

export interface HeardWord {
  text: string;
  confidence: number;
}

/** Звуки человека, которые различает сервер (Scribe): закрытый список, совпадает с `VOICE_SOUNDS` ядра. */
export const HUMAN_SOUND_KINDS = ["laughter", "sigh", "cough", "sneeze", "gasp", "crying", "yawn", "groan"] as const;
export type HumanSoundKind = (typeof HUMAN_SOUND_KINDS)[number];

/** Звук, пойманный у человека: вид и сколько миллисекунд назад он начался (на момент отправки сообщения). */
export interface HeardSound {
  kind: HumanSoundKind;
  agoMs: number;
}

export type SpeechFailure = "unavailable" | "limit" | "cap";
export type DialogErrorKind = "recognition_lost" | "invalid" | "service_unavailable" | "rate_limited";

export type ServerMessage =
  | { type: "ready"; maxSessionSeconds: number; idleSeconds: number; voiceId: string; speech: boolean }
  | { type: "heard"; settled: HeardWord[]; interim: HeardWord[] }
  | { type: "phrase_end"; text: string; serverTimeMs: number; sounds?: HeardSound[] }
  /** Звуки, которые Scribe нашёл позже порога ожидания: клиент приклеит их к следующей фразе. */
  | { type: "sounds"; sounds: HeardSound[] }
  | { type: "speech_started"; replyId: number; serverTimeMs: number }
  | { type: "speech_done"; replyId: number; spokenChars: number }
  | { type: "speech_cut"; replyId: number; spokenChars: number; spokenTail: string }
  | { type: "speech_failed"; replyId: number; kind: SpeechFailure }
  | { type: "cut_saved"; messageId: string }
  | { type: "cut_rejected"; messageId: string }
  | { type: "idle_warning"; secondsLeft: number }
  | { type: "error"; kind: DialogErrorKind };

/** Виды заполнителей: что делает модель, пока голос молчит. Фразы по видам задаёт сервер, когда они озвучиваются заранее. */
export const FILLER_CATEGORIES = ["thinking", "reasoning", "web", "page", "memory", "tool", "long"] as const;
export type FillerCategory = (typeof FILLER_CATEGORIES)[number];

/** Заполнитель в списке сервера: звук по `id` берётся отдельным запросом (`GET …/fillers/{id}?voiceId=…`). */
export interface FillerManifestPhrase {
  id: string;
  category: FillerCategory;
  text: string;
}

export interface FillerManifest {
  phrases: FillerManifestPhrase[];
}

export type Parsed<T> = { ok: true; message: T } | { ok: false };

const REFUSED = { ok: false } as const;

function readObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === "string";
const isFilled = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Первое сообщение соединения. Любое другое — отказ (код 4400). */
export function parseStartMessage(raw: string): Parsed<StartMessage> {
  const body = readObject(raw);
  if (!body || body.type !== "start") return REFUSED;
  const audio = body.audio as Record<string, unknown> | null | undefined;
  if (typeof audio !== "object" || audio === null) return REFUSED;
  if (audio.format !== "pcm_s16le" || audio.sampleRate !== MIC_SAMPLE_RATE || audio.channels !== 1) return REFUSED;
  if (body.language !== undefined && !isText(body.language)) return REFUSED;
  return {
    ok: true,
    message: {
      type: "start",
      audio: { format: "pcm_s16le", sampleRate: MIC_SAMPLE_RATE, channels: 1 },
      ...(body.language !== undefined && { language: body.language as string }),
    },
  };
}

/** Команда клиента после `start`. Неизвестная команда, лишний `start` и неверные поля — отказ; лишние поля отбрасываются. */
export function parseClientCommand(raw: string): Parsed<ClientCommand> {
  const body = readObject(raw);
  if (!body) return REFUSED;
  switch (body.type) {
    case "ping":
      return { ok: true, message: { type: "ping" } };
    case "voice":
      return isFilled(body.voiceId) ? { ok: true, message: { type: "voice", voiceId: body.voiceId } } : REFUSED;
    case "prepare":
    case "end_reply":
      return isCount(body.replyId) ? { ok: true, message: { type: body.type, replyId: body.replyId } } : REFUSED;
    case "speak":
      if (!isCount(body.replyId) || !isFilled(body.text)) return REFUSED;
      if (body.messageId !== undefined && !isText(body.messageId)) return REFUSED;
      return {
        ok: true,
        message: {
          type: "speak",
          replyId: body.replyId,
          text: body.text,
          ...(body.messageId !== undefined && { messageId: body.messageId as string }),
        },
      };
    case "interrupt":
      return isCount(body.replyId) && isCount(body.playedMs)
        ? { ok: true, message: { type: "interrupt", replyId: body.replyId, playedMs: body.playedMs } }
        : REFUSED;
    case "mark_cut":
      if (!isCount(body.replyId) || !isFilled(body.messageId) || !isCount(body.partIndex) || !isCount(body.charOffset) || !isText(body.spokenTail)) {
        return REFUSED;
      }
      return {
        ok: true,
        message: {
          type: "mark_cut",
          replyId: body.replyId,
          messageId: body.messageId,
          partIndex: body.partIndex,
          charOffset: body.charOffset,
          spokenTail: body.spokenTail,
        },
      };
    default:
      return REFUSED;
  }
}

/** Бинарный кадр озвучки: 4 байта replyId (big-endian), затем PCM s16le 24 кГц моно. */
export function encodeSpeechFrame(replyId: number, audio: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + audio.length);
  new DataView(frame.buffer).setUint32(0, replyId, false);
  frame.set(audio, 4);
  return frame;
}

export function decodeSpeechFrame(frame: Uint8Array): { replyId: number; audio: Uint8Array } | null {
  if (frame.length < 4) return null;
  const replyId = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
  return { replyId, audio: frame.subarray(4) };
}
