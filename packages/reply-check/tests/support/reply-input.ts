import type { ReplyCheckInput } from "@ykurilov/agent-chat-core";

/** Вызов переписки, как его видит проверка: инструкция, текст запроса. */
export interface RewriteCall {
  system: string;
  prompt: string;
}

/** Вход проверки с поддельной моделью-переписчиком; `calls` — все её вызовы по порядку. */
export function replyInput(
  text: string,
  options: { seenTexts?: string[]; rewrite?: (call: RewriteCall) => Promise<string> | string } = {},
): { input: ReplyCheckInput; calls: RewriteCall[] } {
  const calls: RewriteCall[] = [];
  const rewrite = async (system: string, prompt: string): Promise<string> => {
    const call = { system, prompt };
    calls.push(call);
    if (!options.rewrite) throw new Error("переписка не ожидалась");
    return options.rewrite(call);
  };
  return { input: { text, ownerId: "owner-1", chatId: "chat-1", messageId: "message-1", seenTexts: options.seenTexts ?? [], rewrite }, calls };
}
