import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { LiveDemoColors, LiveDemoView } from "@ykurilov/agent-chat-react";
import { memo } from "react";
import { SafeMarkdown } from "./safe-markdown";

/** Цвета демонстраций Одуванчик: поверхность, приглушённая поверхность, текст, граница, действие. */
export function oduvanchikDemoColors(dark: boolean): LiveDemoColors {
  return dark
    ? { background: "#161616", surface: "#222222", text: "#F2F2F0", muted: "#9B9B97", border: "#2C2C2C", accent: "#F27D52", onAccent: "#141414", dark: true }
    : { background: "#ffffff", surface: "#F4F4F3", text: "#141414", muted: "#6E6E6B", border: "#E9E9E6", accent: "#EE6A3C", onAccent: "#ffffff", dark: false };
}

const frame = "rounded-[var(--radius-nested)] border border-[var(--border)]";

/**
 * Живая демонстрация в тексте ответа: плашка, пока блок дописывается; рамка слоя поведения во всю ширину ответа (её
 * атрибуты не трогаются, высоту она держит сама); не запускается — исходник блоком кода с пометкой.
 */
export const OduvanchikLiveDemo = memo(function OduvanchikLiveDemo({
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
