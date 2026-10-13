import { accessRefusedResponse, allowedUser, assertVoiceTagSet } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ResolvedUser, VoiceTagSet } from "@ykurilov/agent-chat-core";
import type { VoiceDialogVoice, VoiceDialogVoices } from "@ykurilov/agent-chat-react";
import type { Hono } from "hono";

/** Голос приложения; `tags` — набор тегов эмоций этого голоса, без него голосу идёт общий список. */
export interface DialogVoice extends VoiceDialogVoice {
  tags?: VoiceTagSet | undefined;
}

export interface VoiceCatalogOptions {
  /** Голоса приложения; хотя бы один. */
  voices: DialogVoice[];
  /** Голос по умолчанию: из списка. Его слышит тот, кто ничего не выбирал, и тот, чей голос убрали из списка. */
  defaultVoiceId: string;
  storage: Pick<ChatStorage, "getVoiceChoice" | "setVoiceChoice">;
  logError?: (error: unknown) => void;
}

export interface VoiceCatalog {
  readonly voices: readonly DialogVoice[];
  readonly defaultVoiceId: string;
  /** Голос человека для следующей реплики; всегда из списка. */
  current(userId: string): Promise<string>;
  /** Набор тегов голоса; `undefined` — у голоса набора нет (или голоса нет в списке): ему идёт общий список. Чат берёт отсюда теги для модели. */
  tagsOf(voiceId: string): VoiceTagSet | undefined;
  view(userId: string): Promise<VoiceDialogVoices>;
  /** `false` — такого голоса в списке нет, выбор не изменился. */
  select(userId: string, voiceId: string): Promise<boolean>;
}

/** Список голосов приложения и выбор человека: в хранилище, а если оно выбор не хранит — в памяти до перезагрузки. */
export function createVoiceCatalog(options: VoiceCatalogOptions): VoiceCatalog {
  const { voices, defaultVoiceId, storage } = options;
  if (voices.length === 0) throw new Error("voices: в настройках голосов нужен хотя бы один голос");
  const ids = new Set(voices.map((voice) => voice.id));
  if (ids.size !== voices.length) throw new Error("voices: в списке голосов есть повторяющийся идентификатор");
  if (!ids.has(defaultVoiceId)) throw new Error("defaultVoiceId: голос по умолчанию должен быть в списке голосов");
  for (const voice of voices) if (voice.tags) assertVoiceTagSet(voice.tags, `voices: «${voice.name}»`);
  const tagSets = new Map(voices.flatMap((voice) => (voice.tags ? [[voice.id, voice.tags] as const] : [])));

  const persisted = Boolean(storage.getVoiceChoice && storage.setVoiceChoice);
  const remembered = new Map<string, string>();

  async function readChoice(userId: string): Promise<string | null> {
    if (!persisted) return remembered.get(userId) ?? null;
    try {
      return (await storage.getVoiceChoice?.(userId)) ?? null;
    } catch (error) {
      options.logError?.(error);
      return null;
    }
  }

  const current = async (userId: string): Promise<string> => {
    const choice = await readChoice(userId);
    return choice !== null && ids.has(choice) ? choice : defaultVoiceId;
  };

  return {
    voices,
    defaultVoiceId,
    current,
    tagsOf: (voiceId) => tagSets.get(voiceId),
    async view(userId) {
      // Экрану нужны только имя и идентификатор; наборы тегов — дело модели.
      return { voices: voices.map(({ id, name }) => ({ id, name })), current: await current(userId), persisted };
    },
    async select(userId, voiceId) {
      if (!ids.has(voiceId)) return false;
      if (persisted) await storage.setVoiceChoice?.(userId, voiceId);
      else remembered.set(userId, voiceId);
      return true;
    },
  };
}

export interface VoiceRoutesOptions {
  /** Общий путь режима, например `/api/voice-dialog`: маршруты `{path}/voices` и `{path}/voice`. */
  path: string;
  catalog: VoiceCatalog;
  resolveUser: (request: Request) => Promise<ResolvedUser>;
}

const NO_STORE = { "Cache-Control": "no-store" };

/** `GET {path}/voices` и `PUT {path}/voice` — только для вошедшего человека. */
export function mountVoiceRoutes(app: Hono, options: VoiceRoutesOptions): void {
  const { catalog, resolveUser } = options;
  const base = options.path.replace(/\/+$/, "");

  app.get(`${base}/voices`, async (context) => {
    const resolved = await resolveUser(context.req.raw);
    const refused = accessRefusedResponse(resolved, NO_STORE);
    if (refused) return refused;
    const user = allowedUser(resolved);
    if (!user) return context.json({ error: "unauthorized" }, 401, NO_STORE);
    return context.json(await catalog.view(user.id), 200, NO_STORE);
  });

  app.put(`${base}/voice`, async (context) => {
    const resolved = await resolveUser(context.req.raw);
    const refused = accessRefusedResponse(resolved, NO_STORE);
    if (refused) return refused;
    const user = allowedUser(resolved);
    if (!user) return context.json({ error: "unauthorized" }, 401, NO_STORE);
    const voiceId = await readVoiceId(context.req.raw);
    if (voiceId === null || !(await catalog.select(user.id, voiceId))) {
      return context.json({ error: "invalid_voice" }, 400, NO_STORE);
    }
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}

async function readVoiceId(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    const voiceId = typeof body === "object" && body !== null ? (body as { voiceId?: unknown }).voiceId : undefined;
    return typeof voiceId === "string" && voiceId.length > 0 ? voiceId : null;
  } catch {
    return null;
  }
}
