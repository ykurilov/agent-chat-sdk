import { accessRefusedResponse, allowedUser, createRequestOriginCheck, isSafeMethod, originRefusalHint } from "@ykurilov/agent-chat-core";
import type { ResolvedUser } from "@ykurilov/agent-chat-core";
import { createHash, randomBytes } from "node:crypto";
import { commandOf } from "./bot-commands";
import { readJsonBody } from "./bounded-body";
import type { ExternalAccount, InboundUpdate, MessengerName } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTextsOf } from "./messenger-texts";
import type { MessengerBot, MessengerLink, MessengerStore } from "./types";

/** Сколько живёт код привязки. */
export const LINK_CODE_TTL_MS = 15 * 60_000;

const LINK_CODE_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** Код привязки — ровно 22 знака base64url; всё остальное в `?start=` — метка сценария. */
export function isLinkCode(value: string): boolean {
  return LINK_CODE_SHAPE.test(value);
}

/** В базе лежит только хеш кода: утечка таблицы не даёт привязать чужой аккаунт. */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export interface LinkOffer {
  url: string;
  code: string;
  expiresAt: string;
}

/** Привязка аккаунта мессенджера к пользователю приложения: коды, `/start <код>`, `/link <код>`, адреса `/links`. */
export function createAccountLinking(deps: {
  store: MessengerStore;
  bots: readonly MessengerBot[];
  resolveUser(request: Request): Promise<ResolvedUser>;
  textsOf?: MessengerTextsOf;
  onLinked?(link: MessengerLink): Promise<void> | void;
  onUnlinked?(link: MessengerLink): Promise<void> | void;
  /** Чужие страницы, которым можно выдавать и снимать привязку с куками человека. */
  allowedOrigins?: readonly string[];
  logError?(error: unknown): void;
}) {
  const { store, bots } = deps;
  if (typeof store.saveLinkIfFree !== "function") {
    throw new TypeError(
      "Хранилище мессенджеров без saveLinkIfFree: с 0.81 привязка по коду идёт только через него. Добавьте в своё хранилище атомарное «сохранить, если аккаунт свободен или уже за этим пользователем» (saved | taken) — см. MessengerStore.",
    );
  }
  const textsOf = deps.textsOf ?? defaultTextsOf;
  const messengers = [...new Set(bots.map((bot) => bot.messenger))];
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins: deps.allowedOrigins,
    onRefused: (refusal) => deps.logError?.(new Error(`Мессенджеры, привязка: ${originRefusalHint(refusal)}`)),
  });

  async function issueCode(userId: string, messenger: MessengerName): Promise<LinkOffer> {
    const bot = bots.find((item) => item.messenger === messenger);
    if (!bot) throw new Error(`Мессенджер ${messenger} не подключён`);
    // 16 случайных байт → 22 знака base64url.
    const code = randomBytes(16).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    await store.saveLinkCode({ codeHash: hashLinkCode(code), userId, messenger, expiresAt });
    return { url: bot.adapter.linkUrl(code), code, expiresAt };
  }

  /**
   * Код → привязка. `taken` — аккаунт уже привязан к другому пользователю: чужой код его не переносит (код сгорает),
   * сначала прежнюю привязку снимают в приложении. Проверка «занят» и запись — одна операция хранилища: два кода
   * разных людей одновременно не переписывают друг друга, `onLinked` получает только сохранённая привязка.
   */
  async function redeem(code: string, account: ExternalAccount): Promise<"linked" | "failed" | "taken"> {
    if (!isLinkCode(code)) return "failed";
    const now = new Date().toISOString();
    const claimed = await store.consumeLinkCode(hashLinkCode(code), account.messenger, now);
    if (!claimed) return "failed";
    const link: MessengerLink = {
      messenger: account.messenger,
      botId: account.botId,
      externalUserId: account.externalUserId,
      userId: claimed.userId,
      name: account.name,
      ...(account.username !== undefined && { username: account.username }),
      linkedAt: now,
    };
    if ((await store.saveLinkIfFree(link)) === "taken") return "taken";
    await signal(deps.onLinked, link);
    return "linked";
  }

  /** Сигнал приложению: его сбой привязку и отвязку не отменяет. */
  async function signal(hook: ((link: MessengerLink) => Promise<void> | void) | undefined, link: MessengerLink): Promise<void> {
    try {
      await hook?.(link);
    } catch (error) {
      deps.logError?.(error);
    }
  }

  /**
   * Личный чат привязанного человека: туда пишет «Задача готова», пока человек сам ничего не написал (у MAX номер чата
   * не совпадает с номером человека). Разговор гостя, писавшего до привязки, начинается заново: его чат не этого человека.
   */
  async function rememberPrivateChat(update: InboundUpdate): Promise<void> {
    const link = await store.findLink(update.account.messenger, update.account.botId, update.account.externalUserId);
    if (!link) return;
    const key = { messenger: update.account.messenger, botId: update.account.botId, externalChatId: update.chat.id };
    if ((await store.getConversation(key))?.userId === link.userId) return;
    const now = new Date().toISOString();
    await store.saveConversation({ ...key, type: "private", userId: link.userId, blocked: false, active: true, createdAt: now, updatedAt: now });
  }

  /** `/start <код>` или `/link <код>` → ответ человеку; другое обновление — `null`. */
  async function handleUpdate(update: InboundUpdate): Promise<{ reply: string } | null> {
    const command = commandOf(update);
    if (!command) return null;
    const isStartCode = command.name === "start" && isLinkCode(command.args);
    if (!isStartCode && command.name !== "link") return null;
    const outcome = await redeem(command.args, update.account);
    if (outcome === "linked" && update.chat.type === "private") await rememberPrivateChat(update);
    const texts = textsOf(update.account);
    return { reply: outcome === "linked" ? texts.linked : outcome === "taken" ? texts.linkTaken : texts.linkFailed };
  }

  /** Адреса `/links` (путь — без `basePath`). Не наш адрес — `null`. */
  async function handleRequest(request: Request, path: string): Promise<Response | null> {
    const target = /^\/links(?:\/([^/]+))?\/?$/.exec(path);
    if (!target) return null;
    // Выдача и снятие привязки меняют данные: с чужой страницы с куками человека — отказ, как у чата.
    if (!isSafeMethod(request.method) && !allowsOrigin(request)) return json({ error: { kind: "forbidden_origin" } }, 403);
    const resolved = await deps.resolveUser(request);
    // Слова приложения при отказе в доступе — как у чата.
    const refused = accessRefusedResponse(resolved);
    if (refused) return refused;
    const user = allowedUser(resolved);
    if (!user) return json({ error: "Нужно войти" }, 401);
    const messengerParam = target[1];

    if (messengerParam === undefined && request.method === "POST") {
      const body = await readJsonBody(request);
      if ("error" in body && body.error === "too_large") return json({ error: "Слишком большой запрос" }, 413);
      const messenger = "json" in body ? (body.json as { messenger?: unknown } | null)?.messenger : undefined;
      if (typeof messenger !== "string" || !messengers.includes(messenger as MessengerName)) return json({ error: "Такой мессенджер не подключён" }, 400);
      return json(await issueCode(user.id, messenger as MessengerName), 200);
    }
    if (messengerParam === undefined && request.method === "GET") {
      const links = await store.listLinks(user.id);
      return json(
        {
          messengers,
          links: links.map((link) => ({ messenger: link.messenger, name: link.name, ...(link.username !== undefined && { username: link.username }), linkedAt: link.linkedAt })),
        },
        200,
      );
    }
    if (messengerParam !== undefined && request.method === "DELETE") {
      const messenger = decodedParam(messengerParam);
      if (messenger === null || !messengers.includes(messenger as MessengerName)) return json({ error: "Такой мессенджер не подключён" }, 400);
      const removed = (await store.listLinks(user.id)).filter((link) => link.messenger === messenger);
      await store.removeLinks(user.id, messenger as MessengerName);
      for (const link of removed) await signal(deps.onUnlinked, link);
      return new Response(null, { status: 204 });
    }
    return json({ error: "Метод не поддерживается" }, 405);
  }

  return { issueCode, redeem, handleUpdate, handleRequest };
}

export type AccountLinking = ReturnType<typeof createAccountLinking>;

/** Часть адреса без `%`-кодов; битый код — `null`. */
function decodedParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
