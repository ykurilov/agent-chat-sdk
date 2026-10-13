import { TooltipProvider } from "@tandem/ui";
import type { MediaViewerItem } from "@ykurilov/agent-chat-react";
import { TandemMediaViewer, TandemUserMessage } from "@ykurilov/agent-chat-skin-tandem";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина окна просмотра скина Тандем (T011 плана 024): без сервера, картинки — рисунки прямо в странице. Что показать, задаёт адрес:
 *   theme=light|dark, show=single|carousel|diagram|thumbs (thumbs — миниатюры в ленте, окно закрыто), index=<номер с нуля>.
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

/** Картинка-рисунок нужной пропорции: цвет фона, круг и подпись, чтобы на снимке было видно, какая открыта. */
function picture(n: number, width: number, height: number, color: string): MediaViewerItem {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#ffffff" fill-opacity="0.5"/><text x="50%" y="54%" font-family="sans-serif" font-size="${Math.min(width, height) / 6}" text-anchor="middle" fill="#1b1b1b">${n}</text></svg>`;
  return { kind: "image", key: `p${n}`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: `Картинка ${n}`, width, height };
}

const pictures = [
  picture(1, 1600, 900, "#7aa2f7"),
  picture(2, 900, 1600, "#e0af68"),
  picture(3, 1200, 1200, "#9ece6a"),
  picture(4, 1600, 1000, "#f7768e"),
  picture(5, 1000, 700, "#bb9af7"),
];

/** Схема, похожая на то, что рисует mermaid: блоки, стрелки, подписи текстом SVG. */
const diagram: MediaViewerItem = {
  kind: "diagram",
  key: "m1:0",
  source: "graph LR\n  A[Заявка] --> B{Проверка}\n  B -->|да| C[Оплата]\n  B -->|нет| D[Отказ]",
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 220" width="100%" style="max-width: 640px" font-family="sans-serif" font-size="16">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4a5568"/></marker></defs>
<rect x="10" y="85" width="130" height="50" rx="8" fill="#e8f0fe" stroke="#4a6cf7"/><text x="75" y="115" text-anchor="middle">Заявка</text>
<path d="M140 110 L220 110" stroke="#4a5568" stroke-width="2" marker-end="url(#arrow)"/>
<polygon points="300,60 370,110 300,160 230,110" fill="#fff4e5" stroke="#f0a020"/><text x="300" y="115" text-anchor="middle">Проверка</text>
<path d="M370 110 L450 50" stroke="#4a5568" stroke-width="2" marker-end="url(#arrow)"/><text x="405" y="68" fill="currentColor">да</text>
<path d="M370 110 L450 170" stroke="#4a5568" stroke-width="2" marker-end="url(#arrow)"/><text x="405" y="165" fill="currentColor">нет</text>
<rect x="455" y="25" width="130" height="50" rx="8" fill="#e6f7ec" stroke="#2f9e5b"/><text x="520" y="55" text-anchor="middle">Оплата</text>
<rect x="455" y="145" width="130" height="50" rx="8" fill="#fde8e8" stroke="#d64545"/><text x="520" y="175" text-anchor="middle">Отказ</text>
</svg>`,
};

const show = params.get("show") ?? "carousel";
const items = show === "single" ? [pictures[0]!] : show === "diagram" ? [diagram] : pictures;

function Gallery() {
  const [index, setIndex] = useState(Number(params.get("index") ?? 0));
  const [open, setOpen] = useState(show !== "thumbs");
  return (
    <TooltipProvider>
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-end gap-4 bg-[var(--canvas)] p-3 pb-4">
        <TandemUserMessage
          text="Вот фотографии с прогулки"
          attachments={{
            label: "Вложения",
            items: pictures.slice(0, 3).map((item, n) => ({
              id: item.key,
              name: `фото-${n + 1}.png`,
              kind: "image" as const,
              url: item.kind === "image" ? item.src : "",
              mediaType: "image/png",
              onOpen: () => {
                setIndex(n);
                setOpen(true);
              },
            })),
          }}
        />
        <p data-closed={String(!open)} className="text-sm text-[var(--foreground-muted)]">
          {open ? "Окно открыто" : "Окно закрыто"}
        </p>
      </main>
      {open && <TandemMediaViewer items={show === "thumbs" ? pictures : items} index={index} onIndexChange={setIndex} onClose={() => setOpen(false)} />}
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
