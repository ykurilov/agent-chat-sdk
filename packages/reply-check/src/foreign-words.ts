import type { ReplyCheck } from "@ykurilov/agent-chat-core";
import { DEFAULT_MAX_LENGTH_RATIO, acceptedRewrite } from "./accepted-rewrite";
import { foreignWordsIn, type ReplyScript } from "./found-foreign-words";
import { FOREIGN_WORDS_NOTE } from "./rewrite-notes";

export { FOREIGN_WORDS_NOTE };

export interface ForeignWordsOptions {
  /** Письменность ответа: слова другой письменности — чужие. */
  script: ReplyScript;
  /** Язык ответа для инструкции переписки, в виде «по-русски». По умолчанию: кириллица — «по-русски», латиница — «по-английски». */
  language?: string;
  /** Имена, которые пишутся другой письменностью и чужими не считаются (Excel, Telegram). */
  knownNames?: readonly string[];
  /** Насколько длиннее исходного может быть переписанный ответ (во сколько раз). По умолчанию 1.5. */
  maxLengthRatio?: number;
}

const DEFAULT_LANGUAGE: Record<ReplyScript, string> = { cyrillic: "по-русски", latin: "по-английски" };

/** Неизменное начало запроса: одно на все переписки одного языка, из кэша модели. */
export function foreignWordsInstruction(language: string): string {
  return (
    `Ты редактор. Перепиши этот ответ ${language}, смысл не меняй. ` +
    "Иностранные слова и иероглифы замени словами языка ответа. Ссылки, почту, @имена и названия оставь как есть. " +
    "Ничего не добавляй и не убирай. В ответе только переписанный текст."
  );
}

export const FOREIGN_WORDS_INSTRUCTION_CYRILLIC = foreignWordsInstruction(DEFAULT_LANGUAGE.cyrillic);

type Outcome = "переписан" | "ушёл лучший из двух" | "не переписан";

/** Строка журнала: по ней считается, как часто срабатывает проверка. */
function noteOf(outcome: Outcome, foreign: readonly string[], left: readonly string[]): string {
  const rest = left.length > 0 ? ` осталось=${left.join(",")}` : "";
  return `чужие слова: итог=${outcome} было=${foreign.join(",")}${rest}`;
}

/** Чужие слова в ответе: одна переписка моделью, иначе уходит вариант с меньшим числом чужих слов. */
export function foreignWords(options: ForeignWordsOptions): ReplyCheck {
  const { script, knownNames = [], maxLengthRatio = DEFAULT_MAX_LENGTH_RATIO } = options;
  const system = foreignWordsInstruction(options.language ?? DEFAULT_LANGUAGE[script]);

  return async ({ text, seenTexts, rewrite }) => {
    const foreign = foreignWordsIn(text, seenTexts, script, knownNames);
    if (foreign.length === 0) return;

    let rewritten = "";
    try {
      rewritten = acceptedRewrite(text, await rewrite(system, `${text}\n\n${FOREIGN_WORDS_NOTE} ${foreign.join(", ")}`), {
        sameLength: { maxRatio: maxLengthRatio },
      });
    } catch {
      // Модель не ответила — уходит исходный ответ
    }
    if (!rewritten) return { text, note: noteOf("не переписан", foreign, foreign) };

    const left = foreignWordsIn(rewritten, seenTexts, script, knownNames);
    if (left.length === 0) return { text: rewritten, note: noteOf("переписан", foreign, left) };
    return left.length < foreign.length
      ? { text: rewritten, note: noteOf("ушёл лучший из двух", foreign, left) }
      : { text, note: noteOf("ушёл лучший из двух", foreign, foreign) };
  };
}
