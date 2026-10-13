import type { AgentVideoView, VideosClient } from "@ykurilov/agent-chat-react";
import { timeLabel } from "../time-label";
import { embedUrl, isPosterAddress, isVideoAddress, watchUrl } from "../video-address";

const TOOL_NAME = "show_video";

const wholeSeconds = (value: unknown, min: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= min ? value : undefined;

/** Обложка — только https или путь от корня своего сайта. Иначе заглушка скина. */
const safePoster = (value: unknown): string | undefined => (isPosterAddress(value) ? value : undefined);

/**
 * Видео агента на экране: вызов `show_video` → вид карточки. Пока идёт — `loading`; отказ, ошибка, «Стоп» и подделка
 * в базе — `undefined` (строка инструмента). Адреса плеера и страницы экран собирает сам из площадки и проверенного кода.
 */
export const videosClient: VideosClient = {
  toolName: TOOL_NAME,
  describe(part) {
    if (part.state === "input-streaming" || part.state === "input-available") return { state: "loading" };
    if (part.state !== "output-available") return undefined;

    const output = part.output as Record<string, unknown> | null;
    const video = typeof output === "object" && output !== null ? (output["видео"] as Record<string, unknown> | undefined) : undefined;
    if (typeof video !== "object" || video === null) return undefined;
    const address = { provider: video["площадка"], code: video["код"] };
    const title = video["название"];
    if (!isVideoAddress(address) || typeof title !== "string" || title.trim() === "") return undefined;

    const start = wholeSeconds(video["начало"], 1);
    const duration = wholeSeconds(video["длительность"], 1);
    const poster = safePoster(video["обложка"]);
    const view: AgentVideoView = {
      id: part.toolCallId,
      title,
      provider: address.provider,
      embedUrl: embedUrl(address, start),
      pageUrl: watchUrl(address, start),
      ...(poster && { poster }),
      ...(duration !== undefined && { duration: timeLabel(duration) }),
      ...(start !== undefined && { start: timeLabel(start) }),
    };
    return { state: "ready", video: view };
  },
};
