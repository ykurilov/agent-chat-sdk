import { Markdown } from "@tandem/ui";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { memo, useEffect } from "react";
import { withoutExternalImages } from "./external-images";

/**
 * Обезвреженная ссылка (`javascript:` и другие опасные адреса) остаётся с пустым адресом: клик по ней перезагрузил бы
 * страницу и оборвал бы чат, средняя кнопка мыши (`auxclick`) открыла бы её же в новой вкладке. Такой клик не делает
 * ничего; обычные ссылки работают как прежде.
 */
function ignoreDisarmedLinkClick(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.(".tandem-markdown a");
  if (link && !link.getAttribute("href")?.trim()) event.preventDefault();
}

/**
 * Один слушатель на документ, пока на странице есть текст модели. Не обёртка: лишний узел вокруг `.tandem-markdown`
 * сломал бы отступы блоков, которые задаются селектором `&>.tandem-markdown`.
 */
const LINK_CLICKS = ["click", "auxclick"] as const;
let mountedCount = 0;
function useDisarmedLinkGuard() {
  useEffect(() => {
    if (mountedCount++ === 0) for (const type of LINK_CLICKS) document.addEventListener(type, ignoreDisarmedLinkClick, true);
    return () => {
      if (--mountedCount === 0) for (const type of LINK_CLICKS) document.removeEventListener(type, ignoreDisarmedLinkClick, true);
    };
  }, []);
}

/**
 * Markdown текста модели (ответ, сводка сжатия): картинки с чужих адресов показываются ссылкой, браузер не ходит
 * по ним сам. Весь текст модели в скине рисуется через него, голый `Markdown` из `@tandem/ui` — только здесь.
 */
export const SafeMarkdown = memo(function SafeMarkdown({ markdown }: { markdown: string }) {
  const labels = useChatLabels();
  useDisarmedLinkGuard();
  return <Markdown>{withoutExternalImages(markdown, labels.externalImageLink)}</Markdown>;
});
