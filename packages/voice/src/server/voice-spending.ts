import type { ChatService } from "@ykurilov/agent-chat-core";

/**
 * Учёт расходов голоса тем же журналом и теми же лимитами, что у ходов агента (только режим `relay`: в режиме `direct`
 * звук идёт мимо сервера, и секунд он не видит).
 */
export interface VoiceSpending {
  /**
   * Служба чата (`createChatService`) или её часть: проверка лимита до диктовки, запись расхода и проверка, что чат из
   * адреса — свой. Исчерпан лимит — диктовка не начинается (браузер видит «лимит»), чистка текста не зовётся.
   */
  service: Pick<ChatService, "assertWithinLimit" | "recordUsage" | "assertOwnChat">;
  /** Цена распознавания, доллары за час звука (Soniox). Расход пишется видом `voice_input`. */
  recognitionUsdPerHour: number;
  /**
   * Чат, на который ложится расход. По умолчанию — `?chat=` адреса соединения (его ставит `createVoiceInput`), если это
   * чат вошедшего (`assertOwnChat`), иначе `"voice"`. Чат — только метка учёта: расход всегда на вошедшем человеке.
   */
  chatId?: (request: Request, user: { id: string }) => string | Promise<string>;
}

/** Метка учёта, когда соединение не назвало чат. */
export const VOICE_CHAT_FALLBACK = "voice";
/** Номер чата из адреса: буквы, цифры, `-` и `_`, не длиннее 128 знаков. Остальное в журнал не пускаем. */
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Запас к пределу записи: секунды считает сервер по своим часам, а Soniox может закрыть чуть позже. */
const SECONDS_SLACK = 5;

export function assertVoiceSpending(spending: VoiceSpending): void {
  const price = spending.recognitionUsdPerHour;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    throw new Error("spending.recognitionUsdPerHour: цена распознавания за час звука должна быть числом не меньше нуля");
  }
}

/** Чат расхода по адресу соединения или по выбору приложения. */
export async function spendingChatId(request: Request, user: { id: string }, spending: VoiceSpending | undefined): Promise<string> {
  if (spending?.chatId) return spending.chatId(request, user);
  const named = new URL(request.url).searchParams.get("chat");
  if (!spending || !named || !CHAT_ID.test(named)) return VOICE_CHAT_FALLBACK;
  // Чужой или удалённый чат — расход без чата: иначе адресом можно было бы тратить окно лимита чужого чата.
  try {
    await spending.service.assertOwnChat(user.id, named);
    return named;
  } catch {
    return VOICE_CHAT_FALLBACK;
  }
}

/**
 * Счётчик секунд одной диктовки: от первого куска звука до конца соединения (так считает и Soniox), начатая секунда —
 * целая, не больше предела записи с запасом. Расход пишется один раз; сбой записи — строка в журнал.
 */
export function createRecognitionMeter(input: {
  spending: VoiceSpending;
  ownerId: string;
  chatId: string;
  modelId: string;
  maxSessionSeconds: number;
  now: () => number;
  logError: (message: string) => void;
}) {
  let audioFrom: number | null = null;
  let settled = false;
  return {
    audio() {
      if (audioFrom === null) audioFrom = input.now();
    },
    end() {
      if (settled) return;
      settled = true;
      if (audioFrom === null) return;
      const seconds = Math.max(1, Math.min(Math.ceil((input.now() - audioFrom) / 1000), input.maxSessionSeconds + SECONDS_SLACK));
      input.spending.service
        .recordUsage({
          ownerId: input.ownerId,
          chatId: input.chatId,
          source: "voice_input",
          modelId: input.modelId,
          providerId: "soniox",
          inputTokens: seconds,
          outputTokens: 0,
          cost: (seconds * input.spending.recognitionUsdPerHour) / 3600,
        })
        .catch((error: unknown) => input.logError(`Голос: не записан расход ${seconds} с: ${error instanceof Error ? error.message : String(error)}`));
    },
  };
}
