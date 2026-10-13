import { TooltipProvider } from "@tandem/ui";
import type { GeneratedImagesView, MediaViewerItem } from "@ykurilov/agent-chat-react";
import { TandemAgentText, TandemGeneratedImages, TandemMediaViewer } from "@ykurilov/agent-chat-skin-tandem";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина картинок агента скина Тандем (T047 плана 024): без сервера, картинки — рисунки прямо в странице. Что показать,
 * задаёт адрес: theme=light|dark, show=one|three|eight|partial|loading.
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const colors = ["#7aa2f7", "#e0af68", "#9ece6a", "#f7768e", "#bb9af7", "#7dcfff", "#ff9e64", "#c0caf5"];

/** Картинка-рисунок 16:9 с номером: на снимке видно, какая где. */
function picture(n: number): MediaViewerItem & { kind: "image" } {
  const [width, height] = [1088, 608];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${colors[(n - 1) % colors.length]}"/><circle cx="${width / 2}" cy="${height / 2}" r="${height / 4}" fill="#ffffff" fill-opacity="0.5"/><text x="50%" y="56%" font-family="sans-serif" font-size="${height / 5}" text-anchor="middle" fill="#1b1b1b">${n}</text></svg>`;
  return { kind: "image", key: `img-${n}`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: "Маяк на рассвете", width, height };
}

const show = params.get("show") ?? "three";
const counts: Record<string, number> = { one: 1, three: 3, eight: 8, partial: 4, loading: 3 };
const ordered = counts[show] ?? 3;
const pictures = Array.from({ length: ordered }, (_, i) => picture(i + 1));

function Gallery() {
  const [viewer, setViewer] = useState<number | null>(null);
  const view: GeneratedImagesView = {
    ordered,
    aspectRatio: "16:9",
    stopped: show === "partial",
    items: pictures.flatMap((item, index): GeneratedImagesView["items"] => {
      if (show === "loading") return [{ state: "loading", key: `g1:${index + 1}` }];
      if (show === "partial" && index === 1) return [{ state: "failed", key: `g1:${index + 1}`, reason: "contentModeration: запрос отклонён фильтром провайдера" }];
      if (show === "partial" && index === 3) return [];
      return [{ state: "ready", key: item.key, src: item.src, alt: item.alt, width: item.width!, height: item.height!, onOpen: () => setViewer(index) }];
    }),
  };
  const ready = pictures.filter((_, index) => !(show === "partial" && index !== 0 && index !== 2));
  return (
    <TooltipProvider>
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-end gap-3 bg-[var(--canvas)] p-3 pb-4">
        <TandemAgentText markdown="Вот что получилось:" streaming={false} />
        <TandemGeneratedImages {...view} />
        <p data-viewer={viewer === null ? "closed" : "open"} className="text-sm text-[var(--foreground-muted)]">
          {viewer === null ? "Окно закрыто" : "Окно открыто"}
        </p>
      </main>
      {viewer !== null && (
        <TandemMediaViewer items={ready} index={Math.max(0, ready.indexOf(pictures[viewer]!))} onIndexChange={setViewer} onClose={() => setViewer(null)} />
      )}
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
