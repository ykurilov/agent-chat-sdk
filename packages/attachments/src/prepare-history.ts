import { CHAT_IMAGE_NUMBER_PART, chatImageReferences, modelAcceptsImages } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage, ModelProfile } from "@ykurilov/agent-chat-core";
import { isAttachmentId } from "./attachment-storage";
import { fitImageForModel } from "./fit-image";
import { createImagePlanCache } from "./image-plan-cache";
import type { ResolvedImagesForBlindModels } from "./images-for-blind-models";
import type { ImagePlan, ImagePlanCache } from "./image-plan-cache";
import { defaultAttachmentLimits } from "./limits";
import type { AttachmentStorage, StoredAttachment } from "./attachment-storage";

type Part = AgentChatMessage["parts"][number];

const PREFIX = "attachment:";

/** Имя для текста запроса: без кавычек, скобок и управляющих символов, чтобы оно не ломало разметку блока. */
export function safeName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f"<>]/g, " ").slice(0, 200).trim();
}

/** Имя для плашки: ещё и без «ёлочек» и квадратных скобок, которыми плашка размечена. */
function markerName(name: string): string {
  return safeName(name.replace(/[«»[\]]/g, " "));
}

function unavailable(name: unknown): Part {
  const shown = typeof name === "string" ? safeName(name) : "";
  return { type: "text", text: shown ? `[Файл «${shown}» недоступен.]` : "[Файл недоступен.]" };
}

function textBlock(record: StoredAttachment): Part {
  // Закрывающий тег внутри файла (в любом регистре) обезврежен: содержимое файла — данные, а не разметка запроса.
  const body = (record.extractedText ?? "").replace(/<\/(attachment)/gi, "<\\/$1");
  const note = record.textTruncated ? "\n[Текст файла обрезан: показано начало.]" : "";
  return { type: "text", text: `<attachment name="${safeName(record.name)}" type="${record.mediaType}">\n${body}${note}\n</attachment>` };
}

/** Решений по картинкам (без копий они крошечные). */
const MAX_IMAGE_PLANS = 10_000;

/**
 * Решения по картинкам: старая картинка (загружена до уменьшения) иначе перекодировалась бы в каждом шаге каждого
 * хода. Ключ — id и размер записи: байты вложения не меняются. Копия хранится только у уменьшенных; предел — по памяти
 * копий (`limits.imageCacheBytes`), а не по числу: чат с десятками старых картинок не вытесняет их по кругу.
 */
export function createImagePlans(maxCopyBytes: number): ImagePlanCache {
  return createImagePlanCache({ maxPlans: MAX_IMAGE_PLANS, maxCopyBytes });
}

/** Кэш для `prepareHistory` без своего: по умолчанию из лимитов. */
const sharedImagePlans = createImagePlans(defaultAttachmentLimits.imageCacheBytes);

/** Решение по картинке; `bytes` — уже прочитанные байты, если решение принималось сейчас. */
async function planImage(imagePlans: ImagePlanCache, storage: AttachmentStorage, record: StoredAttachment): Promise<{ plan: ImagePlan | undefined; bytes?: Uint8Array }> {
  const key = `${record.id}:${record.size}`;
  const cached = imagePlans.get(key);
  if (cached) return { plan: await cached };
  const decided = (async () => {
    const bytes = await storage.readBytes(record.id);
    if (!bytes) return { plan: undefined };
    // Новые картинки уменьшены при загрузке и проходят как есть; загруженные раньше ужимаются здесь.
    const fitted = await fitImageForModel(bytes, record.mediaType);
    if (!fitted) return { plan: { kind: "unreadable" } as const };
    const plan: ImagePlan = fitted.changed ? { kind: "fitted", mediaType: fitted.mediaType, bytes: fitted.bytes } : { kind: "original", mediaType: fitted.mediaType };
    return { plan, bytes };
  })();
  // Файла нет или хранилище сбоило — не запоминается: в следующий раз прочитается заново.
  imagePlans.set(key, decided.then((result) => result.plan));
  return decided;
}

async function imagePart(imagePlans: ImagePlanCache, storage: AttachmentStorage, record: StoredAttachment): Promise<Part> {
  const { plan, bytes: alreadyRead } = await planImage(imagePlans, storage, record);
  if (!plan) return unavailable(record.name);
  if (plan.kind === "unreadable") return { type: "text", text: `[Картинка «${safeName(record.name)}» пропущена: её не удалось прочитать.]` };
  const bytes = plan.kind === "fitted" ? plan.bytes : (alreadyRead ?? (await storage.readBytes(record.id)));
  if (!bytes) return unavailable(record.name);
  return {
    type: "file",
    url: `data:${plan.mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
    mediaType: plan.mediaType,
    filename: record.name,
  };
}

/**
 * Заменяет части `file` на то, что увидит модель: картинку — байтами (если модель видит картинки у этого провайдера),
 * плашкой с номером вложения (`imagesForBlindModels`) или пометкой, PDF и текстовый файл — блоком с извлечённым
 * текстом. Результат зависит только от истории, записей и пары «модель + провайдер»: между ходами запрос не меняется.
 */
export async function prepareHistory(input: {
  storage: AttachmentStorage;
  chatId: string;
  history: readonly AgentChatMessage[];
  model: { profile: ModelProfile; providerId: string };
  /** Решения по картинкам; нет — общий кэш по умолчанию. */
  imagePlans?: ImagePlanCache;
  /** Плашка вместо картинки для модели без зрения; нет — пометка «не показана». */
  imagesForBlindModels?: ResolvedImagesForBlindModels;
  imageNumbers?: boolean;
}): Promise<AgentChatMessage[]> {
  const { storage, chatId, model, imagesForBlindModels: blind } = input;
  const seesImages = modelAcceptsImages(model.profile, model.providerId);
  const imagePlans = input.imagePlans ?? sharedImagePlans;
  const records = new Map<string, Promise<StoredAttachment | undefined>>();
  const recordOf = (id: string) => {
    let record = records.get(id);
    if (!record) {
      record = storage.get(id).then((found) => (found?.chatId === chatId ? found : undefined));
      records.set(id, record);
    }
    return record;
  };

  async function convert(part: Part): Promise<Part> {
    if (part.type !== "file") return part;
    const id = part.url.startsWith(PREFIX) ? part.url.slice(PREFIX.length) : "";
    const record = isAttachmentId(id) ? await recordOf(id) : undefined;
    if (!record) return unavailable(part.filename);
    if (record.kind !== "image") return textBlock(record);
    if (blind && (blind.always || !seesImages)) {
      return { type: "text", text: blind.marker({ id: record.id, name: markerName(record.name), mediaType: record.mediaType, authorId: record.ownerId }) };
    }
    if (!seesImages) {
      return { type: "text", text: `[Картинка «${safeName(record.name)}» не показана: выбранная модель не видит картинки.]` };
    }
    return imagePart(imagePlans, storage, record);
  }

  return Promise.all(
    input.history.map(async (message) => {
      const numbers = input.imageNumbers ? new Map(chatImageReferences([message]).map(ref => [ref.attachmentId, ref.number])) : undefined;
      if (!message.parts.some(part => part.type === "file" || part.type === CHAT_IMAGE_NUMBER_PART)) return message;
      const converted = await Promise.all(message.parts.filter(part => part.type !== CHAT_IMAGE_NUMBER_PART).map(async part => {
        const number = part.type === "file" && part.url.startsWith(PREFIX) ? numbers?.get(part.url.slice(PREFIX.length)) : undefined;
        const value = await convert(part);
        return number === undefined ? [value] : [{ type: "text" as const, text: `[Фото №${number}]` }, value];
      }));
      return { ...message, parts: converted.flat() };
    }),
  );
}
