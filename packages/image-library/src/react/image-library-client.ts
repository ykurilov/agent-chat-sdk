import type { GeneratedImagesView, ImagesClient } from "@ykurilov/agent-chat-react";
import { isImageAddress } from "../image-address";

const TOOL_NAME = "show_image";

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isSize = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * Пропорции, которые знает каждый скин с `GeneratedImages` (те же, что у `generate_images`). Скин версии 25 не знает
 * `wide` и рисует картинку плиткой этой пропорции; незнакомую строку («1200:800») он обрезал бы квадратом.
 */
const KNOWN_RATIOS = [
  ["1:1", 1],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
] as const;

/** Ближайшая знакомая пропорция по отношению сторон (сравнение в логарифмах: 2:1 и 1:2 одинаково далеки от 1:1). */
function nearestAspectRatio(width: number, height: number): string {
  const ratio = Math.log(width / height);
  let best: (typeof KNOWN_RATIOS)[number] = KNOWN_RATIOS[0];
  for (const known of KNOWN_RATIOS) if (Math.abs(Math.log(known[1]) - ratio) < Math.abs(Math.log(best[1]) - ratio)) best = known;
  return best[0];
}

/** Пока вызов идёт — пустой вид: показ мгновенный, заглушка «картинка создаётся» тут неверна. */
const pending: GeneratedImagesView = { ordered: 1, aspectRatio: "3:2", wide: true, items: [], stopped: false };

export interface ImageLibraryClientOptions {
  /** Те же домены, что `allowedHosts` на сервере: картинка с другого домена не показывается. */
  allowedHosts?: readonly string[];
}

/**
 * Картинки библиотеки на экране: вызов `show_image` → картинка по ширине ответа со своей пропорцией и подписью-названием;
 * по нажатию — окно просмотра. Отказ, ошибка, «Стоп» и подделка в базе — `undefined` (строка инструмента).
 */
export function createImageLibraryClient(options: ImageLibraryClientOptions = {}): ImagesClient {
  const allowedHosts = [...(options.allowedHosts ?? [])];
  return {
    toolName: TOOL_NAME,
    describe({ part, openImage }) {
      if (part.state === "input-streaming" || part.state === "input-available") return pending;
      if (part.state !== "output-available") return undefined;
      const output = part.output as Record<string, unknown> | null;
      const image = typeof output === "object" && output !== null ? (output["картинка"] as Record<string, unknown> | undefined) : undefined;
      if (typeof image !== "object" || image === null) return undefined;
      const { название: title, подпись: alt, адрес: src, ширина: width, высота: height } = image;
      if (!isText(title) || !isText(alt) || !isImageAddress(src, allowedHosts) || !isSize(width) || !isSize(height)) return undefined;
      const key = part.toolCallId;
      return {
        ordered: 1,
        aspectRatio: nearestAspectRatio(width, height),
        wide: true,
        items: [{ state: "ready", key, src, alt, caption: title, width, height, onOpen: (trigger) => openImage(key, trigger) }],
        stopped: false,
      };
    },
  };
}

/** Клиент для картинок только со своего сайта (`/…`). Есть CDN — `createImageLibraryClient({ allowedHosts })`. */
export const imageLibraryClient: ImagesClient = createImageLibraryClient();
