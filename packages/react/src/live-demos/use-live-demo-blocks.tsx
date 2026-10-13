import { useCallback, useMemo, useState } from "react";
import { usePageDark } from "../diagrams/use-diagram-colors";
import { useChatLabels } from "../labels";
import type { ChatSkin, LiveDemoColors, LiveDemoView } from "../skin-contract";
import { splitAnswerFences } from "./answer-fences";
import { FALLBACK_DEMO_COLORS, liveDemoFits } from "./live-demo-document";
import { LiveDemoFrame } from "./live-demo-frame";

/**
 * Цвета демонстраций для текущей темы страницы: `skin.demoColors(dark)`, без него — свои. Смена темы даёт новые цвета,
 * и демонстрации перерисовываются. `enabled: false` (демонстрации не подключены) — за темой не следит, `undefined`.
 */
export function useDemoColors(skin: ChatSkin, enabled: boolean): LiveDemoColors | undefined {
  const dark = usePageDark(enabled);
  return useMemo(() => {
    if (!enabled) return undefined;
    return skin.demoColors?.(dark) ?? FALLBACK_DEMO_COLORS[dark ? "dark" : "light"];
  }, [dark, enabled, skin]);
}

/**
 * Живые демонстрации одной текстовой части для скина (`AgentText.renderDemo`). Незакрытый блок, пока текст печатается,
 * — `streaming`; закрытый запускается сразу, не дожидаясь конца ответа. Код не запускается, если он больше предела, не
 * дописан к концу ответа, уже пытался уйти со своей страницы или в чате чужой текст (`blocked`: сервер сообщил, что в чат
 * попали веб, файл или инструмент с пометкой). Нет цветов (демонстрации не подключены) — `undefined`.
 */
export function useLiveDemoBlocks({ markdown, streaming, colors, blocked }: { markdown: string; streaming: boolean; colors: LiveDemoColors | undefined; blocked: boolean }) {
  const labels = useChatLabels();
  const blocks = useMemo(
    () => (colors ? splitAnswerFences(markdown, { demos: true }).flatMap((segment) => (segment.kind === "demo" ? [segment] : [])) : []),
    [colors, markdown],
  );
  const [leftPage, setLeftPage] = useState<ReadonlySet<string>>(() => new Set());
  const renderDemo = useCallback(
    (source: string, blockIndex: number): LiveDemoView => {
      if (blocks[blockIndex]?.closed === false) return streaming ? { state: "streaming" } : { state: "code", source, reason: "unfinished" };
      if (!liveDemoFits(source)) return { state: "code", source, reason: "tooLarge" };
      if (leftPage.has(source)) return { state: "code", source, reason: "leftPage" };
      if (blocked) return { state: "code", source, reason: "externalContent" };
      const onLeftPage = () => setLeftPage((sources) => new Set(sources).add(source));
      return { state: "ready", source, frame: <LiveDemoFrame source={source} colors={colors!} title={labels.demo.title} onLeftPage={onLeftPage} /> };
    },
    [blocked, blocks, colors, labels, leftPage, streaming],
  );
  return colors ? renderDemo : undefined;
}
