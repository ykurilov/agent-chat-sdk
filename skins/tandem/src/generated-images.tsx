import { cn } from "@tandem/ui";
import type { GeneratedImagesView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ImageOff, Loader2 } from "lucide-react";
import type { CSSProperties } from "react";

/** Классы пропорций целиком: Tailwind находит их в исходнике. Незнакомая пропорция — квадрат. */
const aspectClasses: Record<string, string> = {
  "1:1": "aspect-square",
  "3:2": "aspect-[3/2]",
  "2:3": "aspect-[2/3]",
  "16:9": "aspect-[16/9]",
  "9:16": "aspect-[9/16]",
};

/** Колонки по числу заказанных: одна картинка крупно, несколько — по две, на широком экране до четырёх. */
function gridColumns(ordered: number): string {
  if (ordered <= 1) return "grid-cols-1 max-w-md";
  if (ordered <= 4) return "grid-cols-2 max-w-xl";
  return "grid-cols-2 sm:grid-cols-4 max-w-3xl";
}

const tileBase = "relative w-full overflow-hidden rounded-[var(--radius-nested)] border border-[var(--border)]";

type ReadyItem = Extract<GeneratedImagesView["items"][number], { state: "ready" }>;

/** Готовая картинка — кнопка с лупой: по нажатию окно просмотра. */
function ReadyImage({ item, className, imageClassName, style }: { item: ReadyItem; className: string; imageClassName: string; style?: CSSProperties }) {
  const labels = useChatLabels();
  return (
    <button
      type="button"
      data-tile="ready"
      aria-label={`${labels.images.open}: ${item.alt}`}
      onClick={(event) => item.onOpen(event.currentTarget)}
      className={cn(className, "tandem-focus block cursor-zoom-in bg-[var(--surface)]")}
      {...(style && { style })}
    >
      <img
        src={item.src}
        alt=""
        loading="lazy"
        {...(item.width !== undefined && { width: item.width })}
        {...(item.height !== undefined && { height: item.height })}
        className={imageClassName}
      />
    </button>
  );
}

const captionClass = "text-xs leading-snug text-[var(--foreground-muted)]";

/**
 * Картинки по ширине ответа (договор 26, `wide`): каждая своей пропорции, целиком, без обрезки; подпись под картинкой.
 * Пустой список — вызов идёт: ничего не рисуется.
 */
function WideImages({ items }: GeneratedImagesView) {
  const ready = items.filter((item): item is ReadyItem => item.state === "ready");
  if (ready.length === 0) return null;
  return (
    <ul className="flex w-full flex-col gap-3">
      {ready.map((item) => (
        <li key={item.key}>
          <figure className="m-0 flex flex-col gap-1.5">
            <ReadyImage
              item={item}
              className={tileBase}
              imageClassName="block size-full object-contain"
              {...(item.width && item.height && { style: { aspectRatio: `${item.width} / ${item.height}` } })}
            />
            {item.caption && <figcaption className={captionClass}>{item.caption}</figcaption>}
          </figure>
        </li>
      ))}
    </ul>
  );
}

/**
 * Картинки агента (договор скина, версия 13): сетка плиток одной пропорции. Заглушка, готовая и упавшая картинка
 * занимают одно место — лента не прыгает при замене. Упавшая подписана словами, «Стоп» — надписью под сеткой.
 * Версия 26: `wide` — картинки по ширине ответа (библиотека), `caption` — видимая подпись под плиткой.
 */
export function TandemGeneratedImages(view: GeneratedImagesView) {
  const labels = useChatLabels();
  if (view.wide) return <WideImages {...view} />;
  const { ordered, aspectRatio, items, stopped } = view;
  const aspect = aspectClasses[aspectRatio] ?? "aspect-square";
  const tile = cn(tileBase, aspect);
  return (
    <div className="flex flex-col gap-2">
      <ul className={cn("grid w-full gap-2", gridColumns(ordered))}>
        {items.map((item) => (
          <li key={item.key}>
            {item.state === "ready" ? (
              item.caption ? (
                <figure className="m-0 flex flex-col gap-1">
                  <ReadyImage item={item} className={tile} imageClassName="size-full object-cover" />
                  <figcaption className={captionClass}>{item.caption}</figcaption>
                </figure>
              ) : (
                <ReadyImage item={item} className={tile} imageClassName="size-full object-cover" />
              )
            ) : item.state === "loading" ? (
              <div role="status" data-tile="loading" className={cn(tile, "grid place-items-center bg-[var(--surface)] motion-safe:animate-pulse")}>
                <span className="flex items-center gap-1.5 px-2 text-center text-xs text-[var(--foreground-muted)]">
                  <Loader2 aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" />
                  {labels.images.loading}
                </span>
              </div>
            ) : (
              <div data-tile="failed" className={cn(tile, "grid place-items-center border-dashed bg-[var(--canvas)] p-2")}>
                <span className="flex min-w-0 flex-col items-center gap-1 text-center">
                  <ImageOff aria-hidden="true" className="size-4 text-[var(--destructive-text)]" />
                  <span className="text-xs font-semibold text-[var(--destructive-text)]">{labels.images.failed}</span>
                  {item.reason && <span className="line-clamp-3 break-words text-[11px] text-[var(--foreground-subtle)]">{item.reason}</span>}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {stopped && <p className="text-xs text-[var(--foreground-muted)]">{labels.images.stopped}</p>}
    </div>
  );
}
