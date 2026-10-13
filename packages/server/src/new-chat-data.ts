/** Данные нового чата из браузера: решает приложение (`ChatHandlerOptions.newChatData`). */
export type NewChatDataResolver = (input: { user: { id: string }; request: Request }) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;

/** Ответ приложения: объект данных или `undefined`. Другое — ошибка приложения, а не человека: обработчик ответит 500. */
export async function resolveNewChatData(resolve: NewChatDataResolver, input: { user: { id: string }; request: Request }): Promise<Record<string, unknown> | undefined> {
  const data = await resolve(input);
  if (data === undefined) return undefined;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TypeError(`newChatData должен вернуть объект данных чата или undefined, а вернул ${data === null ? "null" : Array.isArray(data) ? "массив" : typeof data}.`);
  }
  return data;
}
