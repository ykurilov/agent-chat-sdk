import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { DiagramColors, DiagramView } from "@ykurilov/agent-chat-react";
import { Maximize2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { memo } from "react";
import { SafeMarkdown } from "./safe-markdown";

/** Цвета схем в палитре Тандема (`tandem.css`): поверхность, текст, сильная граница, приглушённая поверхность, действие. */
export function tandemDiagramColors(dark: boolean): DiagramColors {
  return dark
    ? { background: "#1c1f22", text: "#f3f4f2", line: "#73787d", node: "#292d31", accent: "#46aeea", dark: true }
    : { background: "#ffffff", text: "#202226", line: "#8b8d87", node: "#f0f1ef", accent: "#0870ab", dark: false };
}

/** Своя ширина рисунка из `viewBox`: схема рисуется в ней и шире ленты прокручивается вбок, а не сжимается. */
function naturalWidth(svg: string): number | undefined {
  const width = Number(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/.exec(svg)?.[1]);
  return Number.isFinite(width) && width > 0 ? Math.ceil(width) : undefined;
}

const frame = "rounded-[var(--radius-nested)] border border-[var(--border)]";

/**
 * Схема в тексте ответа: заглушка, пока блок печатается и рисуется; рисунок — векторный SVG, шире ленты
 * прокручивается вбок (FR-029); не нарисовалась — исходник обычным блоком кода с «копировать» (FR-026).
 */
export const TandemDiagram = memo(function TandemDiagram({
  view,
  markdown,
  onOpen,
  className = "",
}: {
  view: DiagramView;
  /** Блок ```mermaid целиком: его показывает состояние `failed`. */
  markdown: string;
  onOpen?: (trigger: HTMLElement) => void;
  className?: string;
}) {
  const labels = useChatLabels();
  if (view.state === "streaming") {
    return (
      <div
        data-diagram="streaming"
        aria-busy="true"
        className={`${className} ${frame} grid min-h-40 place-items-center bg-[var(--surface-muted)] p-4 text-sm text-[var(--foreground-subtle)]`}
      >
        <span className="motion-safe:animate-pulse">{labels.diagram.loading}</span>
      </div>
    );
  }
  if (view.state === "failed") {
    return (
      <div data-diagram="failed" className={className}>
        <SafeMarkdown markdown={markdown} />
        <p className="mt-1 text-xs text-[var(--foreground-subtle)]">{labels.diagram.failed}</p>
      </div>
    );
  }
  const width = naturalWidth(view.svg);
  const open = onOpen && ((target: HTMLElement) => onOpen(target));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    open(event.currentTarget);
  };
  return (
    <div data-diagram="ready" className={`${className} relative`}>
      <div
        {...(open && {
          role: "button",
          tabIndex: 0,
          "aria-label": labels.diagram.open,
          title: labels.diagram.open,
          onClick: (event) => open(event.currentTarget),
          onKeyDown,
        })}
        className={`${frame} group/diagram relative bg-[var(--surface)] ${open ? "cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] hover:border-[var(--border-strong)]" : ""}`}
      >
        <div className="overflow-x-auto overscroll-x-contain p-3">
          <div
            data-diagram-canvas=""
            aria-hidden="true"
            {...(width && { style: { width: `${width}px` } })}
            className="mx-auto max-w-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none"
            dangerouslySetInnerHTML={{ __html: view.svg }}
          />
        </div>
        {open && (
          <span className="pointer-events-none absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-[var(--surface-raised)] text-[var(--foreground-muted)] shadow-[var(--shadow-xs)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/diagram:opacity-100 [@media(hover:hover)]:group-focus-visible/diagram:opacity-100">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="sr-only">{`${labels.voice.diagramOnScreen}: ${view.source}`}</p>
    </div>
  );
});
