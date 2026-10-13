import type { GeneratedImagesView, ImagesClient } from "@ykurilov/agent-chat-react";
import { aspectRatios } from "../image-catalog";
import type { AspectRatio } from "../image-catalog";

const TOOL_NAME = "generate_images";
const MAX_COUNT = 8;

type Item = GeneratedImagesView["items"][number];

interface CallInput {
  prompt: string;
  count: number;
  aspectRatio: AspectRatio;
}

/** Вход вызова, приведённый к допустимому: пока вход дописывается, в нём может не быть ничего. */
function callInput(input: unknown): CallInput {
  const fields = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const count = typeof fields.count === "number" && Number.isFinite(fields.count) ? Math.min(MAX_COUNT, Math.max(1, Math.trunc(fields.count))) : 1;
  const aspectRatio = aspectRatios.includes(fields.aspectRatio as AspectRatio) ? (fields.aspectRatio as AspectRatio) : "1:1";
  return { prompt: typeof fields.prompt === "string" ? fields.prompt : "", count, aspectRatio };
}

const numbered = (value: unknown): value is { номер: number } =>
  typeof value === "object" && value !== null && typeof (value as { номер?: unknown }).номер === "number";

/**
 * Картинки агента на экране: вызов `generate_images` → вид для скина `GeneratedImages`. Пока идёт — заглушки на
 * `count` нужной пропорции; готово — картинки адресом вложений по номеру, упавшие — с причиной; «Стоп» — пометка.
 */
export const imagesClient: ImagesClient = {
  toolName: TOOL_NAME,
  describe({ part, api, chatId, openImage }) {
    const { prompt, count, aspectRatio } = callInput(part.input);
    const loading = (): Item[] => Array.from({ length: count }, (_, index) => ({ state: "loading", key: `${part.toolCallId}:${index + 1}` }));
    const view = (ordered: number, items: Item[], stopped = false): GeneratedImagesView => ({ ordered, aspectRatio, items, stopped });

    switch (part.state) {
      case "output-available":
        break;
      case "output-error":
        // Ядро закрывает вызов, оборванный «Стопом», ошибкой: готовые до него картинки в итог не попали.
        return view(count, [], true);
      case "output-denied":
        return undefined;
      default:
        return view(count, loading());
    }

    const output = part.output as Record<string, unknown> | null;
    if (typeof output !== "object" || output === null) return undefined;
    if (typeof output["отказ"] === "string") {
      const reason = output["отказ"];
      return view(count, loading().map(({ key }) => ({ state: "failed", key, reason })));
    }
    const images = output["картинки"];
    const failures = output["ошибки"] ?? [];
    if (!Array.isArray(images) || !Array.isArray(failures)) return undefined;

    const byNumber: Array<[number, Item]> = [];
    for (const image of images.filter(numbered)) {
      const { id, ширина: width, высота: height } = image as { id?: unknown; ширина?: unknown; высота?: unknown };
      if (typeof id !== "string") continue;
      byNumber.push([
        image.номер,
        {
          state: "ready",
          key: id,
          src: `${api}/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(id)}`,
          alt: prompt,
          ...(typeof width === "number" && { width }),
          ...(typeof height === "number" && { height }),
          onOpen: (trigger) => openImage(id, trigger),
        },
      ]);
    }
    for (const failure of failures.filter(numbered)) {
      const reason = (failure as { причина?: unknown }).причина;
      byNumber.push([failure.номер, { state: "failed", key: `${part.toolCallId}:${failure.номер}`, reason: typeof reason === "string" ? reason : "" }]);
    }
    const ordered = typeof output["заказано"] === "number" ? output["заказано"] : count;
    return view(
      ordered,
      byNumber.sort(([a], [b]) => a - b).map(([, item]) => item),
      output["остановлено"] === true,
    );
  },
};
