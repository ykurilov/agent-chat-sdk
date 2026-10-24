import type { ChatGreeting } from "@ykurilov/agent-chat-core";

/** Приветствие HTTP-нового чата. Решение только сервера, после newChatData и до создания. */
export type NewChatGreetingResolver = (input: {
  userId: string;
  chatData: Record<string, unknown> | undefined;
}) => ChatGreeting | null | Promise<ChatGreeting | null>;
