/** Слова, которые проверки ответа сами вставляют в ответ агента. */
export interface ReplyCheckLabels {
  /** Ответ был целиком из выдуманной ссылки: после вырезания ничего не осталось — уходит эта фраза. */
  linkOnlyReply: string;
}

export const russianReplyCheckLabels: ReplyCheckLabels = {
  linkOnlyReply: "Ссылку здесь дать не могу. Расскажите, что вы ищете, и я подскажу.",
};

export const englishReplyCheckLabels: ReplyCheckLabels = {
  linkOnlyReply: "I can't share a link here. Tell me what you're looking for and I'll help.",
};
