import { cn } from "@tandem/ui";
import type { GeneratedImagesView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ImageOff, Loader2 } from "lucide-react";

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

/**
 * Картинки агента (договор скина, версия 13): сетка плиток одной пропорции. Заглушка, готовая и упавшая картинка
 * занимают одно место — лента не прыгает при замене. Упавшая подписана словами, «Стоп» — надписью под сеткой.
 */
export function TandemGeneratedImages({ ordered, aspectRatio, items, stopped }: GeneratedImagesView) {
  const labels = useChatLabels();
  const aspect = aspectClasses[aspectRatio] ?? "aspect-square";
  const tile = cn(tileBase, aspect);
  return (
    <div className="flex flex-col gap-2">
      <ul className={cn("grid w-full gap-2", gridColumns(ordered))}>
        {items.map((item) => (
          <li key={item.key}>
            {item.state === "ready" ? (
              <button
                type="button"
                data-tile="ready"
                aria-label={`${labels.images.open}: ${item.alt}`}
                onClick={(event) => item.onOpen(event.currentTarget)}
                className={cn(tile, "tandem-focus block cursor-zoom-in bg-[var(--surface)]")}
              >
                <img
                  src={item.src}
                  alt=""
                  loading="lazy"
                  {...(item.width !== undefined && { width: item.width })}
                  {...(item.height !== undefined && { height: item.height })}
                  className="size-full object-cover"
                />
              </button>
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
