/** Всё, что человек уже сказал: закреплённое распознавание и то, что Soniox ещё может поправить. */
export interface DictatedText {
  finalText: string;
  interimText: string;
}

/** Подсказка Soniox: тема и термины, чтобы точнее распознавать узкие слова. */
export interface SonioxContext {
  general?: Array<{ key: string; value: string }>;
  text?: string;
  terms?: string[];
}

export interface StartMessageOptions {
  apiKey: string;
  model: string;
  languageHints: string[];
  context?: SonioxContext | undefined;
  /** Как быстро Soniox объявляет конец фразы: чем меньше число, тем раньше (и тем чаще ошибается на паузах). Не задан — по умолчанию Soniox. */
  endpointLatencyLevel?: number | undefined;
  /** Самая долгая пауза до конца фразы, мс. Не задан — по умолчанию Soniox. */
  maxEndpointDelayMs?: number | undefined;
}

/**
 * Первое сообщение в WebSocket Soniox: ключ и настройки распознавания. Формат звука Soniox определяет сам.
 * Границы фраз (`enable_endpoint_detection`): на паузе Soniox закрепляет сказанное, не дожидаясь конца диктовки.
 */
export function buildStartMessage({ apiKey, model, languageHints, context, endpointLatencyLevel, maxEndpointDelayMs }: StartMessageOptions) {
  return {
    api_key: apiKey,
    model,
    audio_format: "auto",
    language_hints: languageHints,
    ...(context && { context }),
    enable_endpoint_detection: true,
    ...(endpointLatencyLevel !== undefined && { endpoint_latency_adjustment_level: endpointLatencyLevel }),
    ...(maxEndpointDelayMs !== undefined && { max_endpoint_delay_ms: maxEndpointDelayMs }),
  };
}

/** Команда Soniox «закрепи всё сказанное»: в ответ приходят закреплённые слова и метка `<fin>`; соединение остаётся открытым. */
export function buildFinalizeMessage() {
  return { type: "finalize" } as const;
}

export type SonioxEvent =
  /** `finalized`: в ответе метка `<fin>`, то есть Soniox выполнил команду «закрепи всё» и всё сказанное закреплено. */
  | { type: "text"; text: DictatedText; finalized?: true; endedPhrases?: string[] }
  | { type: "finished"; text?: DictatedText; endedPhrases?: string[] }
  | { type: "error"; code: number; message: string }
  | { type: "ignored" };

/** Служебные метки Soniox между словами: в текст не попадают. `<fin>` — конец закрепления по команде, `<end>` — конец фразы. */
const FINALIZED_MARK = "<fin>";
const PHRASE_END_MARK = "<end>";
const serviceTokens = new Set([FINALIZED_MARK, PHRASE_END_MARK]);

interface SonioxMessage {
  tokens?: Array<{ text?: unknown; is_final?: unknown }>;
  finished?: unknown;
  error_code?: unknown;
  error_message?: unknown;
}

export interface TranscriptOptions {
  /**
   * Выдавать конец фразы: по метке `<end>` событие несёт `endedPhrases` — закреплённый текст каждой закончившейся фразы.
   * Нужно голосовому диалогу; диктовке поле не нужно, и без опции события прежние.
   */
  phraseEnds?: boolean | undefined;
}

/** Копит ответы Soniox: закреплённые слова только добавляются, незакреплённые каждый раз приходят заново целиком. */
export function createTranscript({ phraseEnds = false }: TranscriptOptions = {}) {
  let finalText = "";
  let phraseText = "";
  let interimText = "";
  const snapshot = (): DictatedText => ({ finalText, interimText });

  return {
    accept(raw: string): SonioxEvent {
      let message: SonioxMessage;
      try {
        message = JSON.parse(raw) as SonioxMessage;
      } catch {
        return { type: "ignored" };
      }
      if (typeof message !== "object" || message === null) return { type: "ignored" };

      if (message.error_code !== undefined || message.error_message !== undefined) {
        return {
          type: "error",
          code: typeof message.error_code === "number" ? message.error_code : 0,
          message: typeof message.error_message === "string" ? message.error_message : "",
        };
      }

      const hasTokens = Array.isArray(message.tokens);
      let finalized = false;
      const endedPhrases: string[] = [];
      if (hasTokens) {
        let interim = "";
        for (const token of message.tokens!) {
          if (typeof token.text !== "string") continue;
          if (token.text === FINALIZED_MARK) finalized = true;
          if (token.text === PHRASE_END_MARK && phraseEnds) {
            endedPhrases.push(phraseText.trim());
            phraseText = "";
          }
          if (serviceTokens.has(token.text)) continue;
          if (token.is_final === true) {
            finalText += token.text;
            phraseText += token.text;
          } else interim += token.text;
        }
        interimText = interim;
      }

      const phrases = endedPhrases.length > 0 ? { endedPhrases } : {};
      if (message.finished === true) {
        return hasTokens && message.tokens!.length > 0 ? { type: "finished", text: snapshot(), ...phrases } : { type: "finished" };
      }
      if (!hasTokens) return { type: "ignored" };
      return { type: "text", text: snapshot(), ...(finalized && { finalized: true as const }), ...phrases };
    },

    /** Диктовка закончилась: что Soniox не успел закрепить, остаётся как есть. */
    settle(): DictatedText {
      finalText += interimText;
      interimText = "";
      return snapshot();
    },

    current: snapshot,
  };
}
