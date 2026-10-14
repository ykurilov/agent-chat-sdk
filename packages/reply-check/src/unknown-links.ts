import type { ReplyCheck } from "@ykurilov/agent-chat-core";
import { acceptedRewrite } from "./accepted-rewrite";
import { UNKNOWN_LINKS_NOTE } from "./rewrite-notes";
import { unknownLinksIn, withoutLinks } from "./links-in-text";
import { russianReplyCheckLabels, type ReplyCheckLabels } from "./labels";

export { UNKNOWN_LINKS_NOTE };

export interface UnknownLinksOptions {
  /** Домены приложений: короткие имена на них разрешены, если человек назвал имя (`ivan` → `ivan.apps.example.com`). */
  appDomains?: readonly string[];
  /** Свои слова вместо русских по умолчанию (`englishReplyCheckLabels` или часть). */
  labels?: Partial<ReplyCheckLabels>;
}

/** Неизменное начало запроса: одно на все переписки, из кэша модели. */
export const LINK_REWRITE_INSTRUCTION =
  "Ты редактор. Ссылки, перечисленные ниже, — не из инструкции: убери их из ответа. " +
  "Если без ссылки фраза теряет смысл, перестрой её, ничего не обещая. Других ссылок не добавляй, остальное не меняй. " +
  "В ответе только переписанный текст.";

type Outcome = "переписан" | "ссылки вырезаны" | "запасная фраза";

/** Строка журнала: по ней считается, как часто срабатывает проверка. */
function noteOf(outcome: Outcome, links: readonly string[], left: readonly string[]): string {
  const rest = left.length > 0 ? ` вырезано=${left.join(",")}` : "";
  return `ссылки не из инструкции: итог=${outcome} было=${links.join(",")}${rest}`;
}

/** Выдуманные ссылки: разрешены адреса из `seenTexts`; лишние — одна переписка, остаток вырезается кодом. */
export function unknownLinks(options: UnknownLinksOptions = {}): ReplyCheck {
  const { appDomains = [] } = options;
  const labels = { ...russianReplyCheckLabels, ...options.labels };

  return async ({ text, seenTexts, rewrite }) => {
    const links = unknownLinksIn(text, seenTexts, appDomains);
    if (links.length === 0) return;

    let rewritten = "";
    try {
      rewritten = acceptedRewrite(text, await rewrite(LINK_REWRITE_INSTRUCTION, `${text}\n\n${UNKNOWN_LINKS_NOTE} ${links.join(", ")}`));
    } catch {
      // Модель не ответила — ссылки вырежет код
    }
    const base = rewritten || text;
    const left = unknownLinksIn(base, seenTexts, appDomains);
    if (rewritten && left.length === 0) return { text: rewritten, note: noteOf("переписан", links, left) };
    const cut = withoutLinks(base, left);
    // Ответ был одной ссылкой: пустой текст служба заменила бы прежним — со ссылкой. Уходит запасная фраза.
    if (!/[\p{L}\p{N}]/u.test(cut)) return { text: labels.linkOnlyReply, note: noteOf("запасная фраза", links, left) };
    return { text: cut, note: noteOf("ссылки вырезаны", links, left) };
  };
}
