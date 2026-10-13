import { Hono } from "hono";

/*
 * Поддельный Telegram для демо и e2e (DEMO_MODEL=mock): бот в режиме опроса ходит сюда вместо api.telegram.org
 * (`api.baseUrl` бота). Настоящих обращений нет.
 * Что умеет: опрос `getUpdates`, отправку и правку сообщений, кнопки, меню команд, «печатает». Файлы и голос не принимает.
 * Управляющие адреса для тестов (человек пишет боту, тест читает ответы бота):
 *   POST /control/say       {personId, name, username?, text} — человек пишет боту; `/start <код>` приходит командой;
 *   GET  /control/messages  ?chatId=<personId> — сообщения бота этому человеку в порядке отправки (после правок).
 * Человек — число `personId`: у каждого теста свой, поэтому тесты не видят чужих сообщений.
 */

export const mockTelegramToken = "424242:demo-mock-telegram-token";
export const mockTelegramUsername = "demo_agent_bot";

/** Самый долгий опрос без новостей: сервер демо не ждёт Telegram по 25 секунд, а тест — остановки. */
const LONG_POLL_MAX_MS = 1_000;
const POLL_STEP_MS = 20;

interface SentMessage {
  chatId: string;
  messageId: number;
  text: string;
  buttons: Array<Array<{ text: string; data?: string; url?: string }>>;
}

interface Update {
  update_id: number;
  [field: string]: unknown;
}

type InlineKeyboard = { inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> } | undefined;

const buttonsOf = (markup: InlineKeyboard) =>
  (markup?.inline_keyboard ?? []).map((row) => row.map((button) => ({ text: button.text, ...(button.callback_data && { data: button.callback_data }), ...(button.url && { url: button.url }) })));

export function createMockTelegram(options: { token?: string; username?: string } = {}) {
  const token = options.token ?? mockTelegramToken;
  const username = options.username ?? mockTelegramUsername;
  let updates: Update[] = [];
  let nextUpdateId = 1;
  let nextMessageId = 1;
  const messages: SentMessage[] = [];

  const ok = (result: unknown) => ({ ok: true, result });
  const fail = (code: number, description: string) => ({ ok: false, error_code: code, description });

  async function call(method: string, body: Record<string, unknown>): Promise<{ status?: number; json: unknown }> {
    const chatId = String(body.chat_id ?? "");
    switch (method) {
      case "getUpdates": {
        const offset = Number(body.offset ?? 0);
        updates = updates.filter((update) => update.update_id >= offset);
        const until = Date.now() + Math.min(Number(body.timeout ?? 0) * 1000, LONG_POLL_MAX_MS);
        while (updates.length === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
        return { json: ok(updates) };
      }
      case "deleteWebhook":
      case "setWebhook":
      case "setMyCommands":
      case "sendChatAction":
      case "sendMessageDraft":
        return { json: ok(true) };
      case "answerCallbackQuery":
        return { json: ok(true) };
      case "sendMessage": {
        const text = String(body.text ?? "");
        if (!text) return { status: 400, json: fail(400, "Bad Request: message text is empty") };
        const message: SentMessage = { chatId, messageId: nextMessageId++, text, buttons: buttonsOf(body.reply_markup as InlineKeyboard) };
        messages.push(message);
        return { json: ok({ message_id: message.messageId, chat: { id: Number(chatId) } }) };
      }
      case "editMessageText": {
        const message = messages.find((item) => item.chatId === chatId && item.messageId === Number(body.message_id));
        if (!message) return { status: 400, json: fail(400, "Bad Request: message to edit not found") };
        message.text = String(body.text ?? "");
        message.buttons = buttonsOf(body.reply_markup as InlineKeyboard);
        return { json: ok({ message_id: message.messageId }) };
      }
      case "editMessageReplyMarkup": {
        const message = messages.find((item) => item.chatId === chatId && item.messageId === Number(body.message_id));
        if (!message) return { status: 400, json: fail(400, "Bad Request: message to edit not found") };
        message.buttons = [];
        return { json: ok(true) };
      }
      default:
        return { status: 404, json: fail(404, "Not Found") };
    }
  }

  const app = new Hono();

  // Управляющие адреса объявлены раньше общего «/<бот>/<метод>»: иначе `control/say` принят за вызов метода.
  app.post("/control/say", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { personId?: unknown; name?: unknown; username?: unknown; text?: unknown };
    if (typeof body.personId !== "number" || typeof body.text !== "string" || typeof body.name !== "string") return c.json({ error: "personId, name and text are required" }, 400);
    const command = /^\/[A-Za-z0-9_]+(@\S+)?/.exec(body.text);
    const from = { id: body.personId, is_bot: false, first_name: body.name, ...(typeof body.username === "string" && { username: body.username }) };
    updates.push({
      update_id: nextUpdateId++,
      message: {
        message_id: nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: body.personId, type: "private" },
        from,
        text: body.text,
        ...(command && { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] }),
      },
    });
    return c.json({ ok: true });
  });
  app.get("/control/messages", (c) => {
    const chatId = c.req.query("chatId") ?? "";
    return c.json({ messages: messages.filter((message) => message.chatId === chatId).map(({ messageId, text, buttons }) => ({ messageId, text, buttons })) });
  });
  app.get("/control/bot", (c) => c.json({ username }));

  app.post("/:bot/:method", async (c) => {
    if (c.req.param("bot") !== `bot${token}`) return c.json(fail(401, "Unauthorized"), 401);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { status, json } = await call(c.req.param("method"), body);
    return c.json(json as Record<string, unknown>, (status ?? 200) as 200);
  });

  return app;
}
