import { cn } from "@tandem/ui";
import type { AgentVideoView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Film, Maximize, Play } from "./icons";
import { useRef, useState } from "react";

const frameBase = "relative aspect-video w-full overflow-hidden rounded-[var(--radius-nested)] border border-[var(--border)]";

const canFullscreen = () => typeof document !== "undefined" && document.fullscreenEnabled === true;

/**
 * Видео агента (договор скина, версия 14): карточка 16:9 с обложкой из каталога или заглушкой. Плеер грузится только
 * по нажатию — до этого к площадке не уходит ни одного запроса. «На весь экран» — если браузер умеет.
 */
export function OduvanchikAgentVideo({ title, embedUrl, poster, duration, start }: AgentVideoView) {
  const labels = useChatLabels();
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const details = [duration, start && labels.videos.from(start)].filter(Boolean).join(" · ");

  return (
    <figure className="flex w-full max-w-xl flex-col gap-1.5">
      <div ref={frameRef} data-video-frame className={cn(frameBase, "bg-[var(--canvas)]")}>
        {playing ? (
          <iframe
            src={embedUrl}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <button
            type="button"
            aria-label={`${labels.videos.play}: ${title}`}
            onClick={() => setPlaying(true)}
            className="tandem-focus group absolute inset-0 block size-full cursor-pointer"
          >
            {poster ? (
              <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
            ) : (
              <span data-video-placeholder className="grid size-full place-items-center bg-[var(--surface)]">
                <Film aria-hidden="true" className="size-8 text-[var(--foreground-subtle)]" />
              </span>
            )}
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-12 place-items-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105">
                <Play aria-hidden="true" className="ml-0.5 size-5 fill-current" />
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="flex min-w-0 items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="break-words text-sm font-medium text-[var(--foreground)]">{title}</span>
          {details && <span className="text-xs text-[var(--foreground-muted)]">{details}</span>}
        </span>
        {playing && canFullscreen() && (
          <button
            type="button"
            onClick={() => void frameRef.current?.requestFullscreen()}
            className="tandem-focus flex shrink-0 items-center gap-1 rounded-[var(--radius-nested)] px-2 py-1 text-xs text-[var(--foreground-muted)] hover:bg-[var(--surface)]"
          >
            <Maximize aria-hidden="true" className="size-3.5" />
            {labels.videos.fullscreen}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
