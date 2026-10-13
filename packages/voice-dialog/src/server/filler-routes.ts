import { accessRefusedResponse, allowedUser } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ResolvedUser } from "@ykurilov/agent-chat-core";
import type { Hono } from "hono";
import type { FillerLibrary } from "./fillers";

export interface FillerRoutesOptions {
  /** Тот же адрес, что у диалога: маршруты встают рядом с `{path}/voices`. */
  path: string;
  library: FillerLibrary;
  storage: Pick<ChatStorage, "getChat">;
  /** Голос из списка голосов приложения. */
  voiceAllowed: (voiceId: string) => boolean;
  resolveUser: (request: Request) => Promise<ResolvedUser>;
}

const NO_STORE = { "cache-control": "no-store" };

/**
 * `GET {path}/fillers` — список фраз-заполнителей; `GET {path}/fillers/{id}?voiceId=…&chatId=…` — звук фразы голосом
 * (PCM s16le 24 кГц). Чат нужен только затем, чтобы записать расход первого синтеза: на чужой чат расход не пишется.
 */
export function mountFillerRoutes(app: Hono, options: FillerRoutesOptions): void {
  const { library, storage, voiceAllowed, resolveUser } = options;
  const base = options.path.replace(/\/+$/, "");

  app.get(`${base}/fillers`, async (context) => {
    const resolved = await resolveUser(context.req.raw);
    const refused = accessRefusedResponse(resolved, NO_STORE);
    if (refused) return refused;
    const user = allowedUser(resolved);
    if (!user) return context.json({ error: "unauthorized" }, 401, NO_STORE);
    return context.json(library.manifest(), 200, NO_STORE);
  });

  app.get(`${base}/fillers/:id`, async (context) => {
    const resolved = await resolveUser(context.req.raw);
    const refused = accessRefusedResponse(resolved, NO_STORE);
    if (refused) return refused;
    const user = allowedUser(resolved);
    if (!user) return context.json({ error: "unauthorized" }, 401, NO_STORE);
    const voiceId = context.req.query("voiceId");
    const chatId = context.req.query("chatId");
    if (!voiceId || !chatId || !voiceAllowed(voiceId)) return context.json({ error: "invalid_request" }, 400, NO_STORE);
    const chat = await storage.getChat(chatId);
    if (!chat || chat.ownerId !== user.id) return context.json({ error: "forbidden" }, 403, NO_STORE);
    const result = await library.audio({ userId: user.id, chatId, voiceId, phraseId: context.req.param("id") });
    if (result.ok) return new Response(result.pcm as Uint8Array<ArrayBuffer>, { status: 200, headers: { ...NO_STORE, "content-type": "application/octet-stream" } });
    if (result.reason === "unknown") return context.json({ error: "not_found" }, 404, NO_STORE);
    if (result.reason === "limit") return context.json({ error: "limit" }, 402, NO_STORE);
    return context.json({ error: "unavailable" }, 503, NO_STORE);
  });
}
