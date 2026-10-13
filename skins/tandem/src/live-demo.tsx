import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { LiveDemoColors, LiveDemoView } from "@ykurilov/agent-chat-react";
import { memo } from "react";
import { SafeMarkdown } from "./safe-markdown";

/** Цвета демонстраций в палитре Тандема (`tandem.css`): поверхность, приглушённая поверхность, текст, граница, действие. */
export function tandemDemoColors(dark: boolean): LiveDemoColors {
  return dark
    ? { background: "#1c1f22", surface: "#292d31", text: "#f3f4f2", muted: "#b1b5ba", border: "#2d3135", accent: "#46aeea", onAccent: "#0b2738", dark: true }
    : { background: "#ffffff", surface: "#f0f1ef", text: "#202226", muted: "#555b63", border: "#e4e5e2", accent: "#0870ab", onAccent: "#ffffff", dark: false };
}

const frame = "rounded-[var(--radius-nested)] border border-[var(--border)]";

/**
 * Живая демонстрация в тексте ответа: плашка, пока блок дописывается; рамка слоя поведения во всю ширину ответа (её
 * атрибуты не трогаются, высоту она держит сама); не запускается — исходник блоком кода с пометкой.
 */
export const TandemLiveDemo = memo(function TandemLiveDemo({
  view,
  markdown,
  className = "",
}: {
  view: LiveDemoView;
  /** Блок ```html-demo целиком: его показывает состояние `code`. */
  markdown: string;
  className?: string;
}) {
  const labels = useChatLabels();
  if (view.state === "streaming") {
    return (
      <div
        data-live-demo="streaming"
        aria-busy="true"
        className={`${className} ${frame} grid min-h-40 place-items-center bg-[var(--surface-muted)] p-4 text-sm text-[var(--foreground-subtle)]`}
      >
        <span className="motion-safe:animate-pulse">{labels.demo.loading}</span>
      </div>
    );
  }
  if (view.state === "code") {
    return (
      <div data-live-demo="code" className={className}>
        <SafeMarkdown markdown={markdown} />
        <p className="mt-1 text-xs text-[var(--foreground-subtle)]">{labels.demo[view.reason]}</p>
      </div>
    );
  }
  return (
    <div data-live-demo="ready" className={`${className} ${frame} w-full overflow-hidden bg-[var(--surface)]`}>
      {view.frame}
    </div>
  );
});
