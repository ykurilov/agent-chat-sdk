import { Markdown } from "@tandem/ui";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { memo } from "react";
import { withoutExternalImages } from "./external-images";

/**
 * Markdown текста модели (ответ, сводка сжатия): картинки с чужих адресов показываются ссылкой, браузер не ходит
 * по ним сам. Весь текст модели в скине рисуется через него, голый `Markdown` из `@tandem/ui` — только здесь.
 */
export const SafeMarkdown = memo(function SafeMarkdown({ markdown }: { markdown: string }) {
  const labels = useChatLabels();
  return <Markdown>{withoutExternalImages(markdown, labels.externalImageLink)}</Markdown>;
});
