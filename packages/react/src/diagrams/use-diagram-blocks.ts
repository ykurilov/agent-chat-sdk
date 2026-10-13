import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { MediaViewerItem } from "../media-viewer/media-viewer-types";
import type { DiagramColors, DiagramView } from "../skin-contract";
import type { DiagramRenders } from "./diagram-renders";
import { splitMermaidBlocks } from "./mermaid-blocks";
import { withUniqueIds } from "./unique-svg-ids";

/** Сколько блоков ```mermaid в тексте: по нему номера схем следующей текстовой части продолжают нумерацию ответа. */
export const countMermaidBlocks = (markdown: string) => splitMermaidBlocks(markdown).filter((segment) => segment.kind === "mermaid").length;

export interface UseDiagramBlocksOptions {
  markdown: string;
  /** Текстовая часть ещё печатается. */
  streaming: boolean;
  messageId: string;
  /** Номер первой схемы этой части в ответе: схемы прежних текстовых частей того же ответа. */
  firstBlock: number;
  renders: DiagramRenders;
  colors: DiagramColors;
  /** Открыть окно просмотра своим набором; нет — схема не открывается. */
  open?: (key: string, trigger: HTMLElement, items: readonly MediaViewerItem[]) => void;
}

/**
 * Схемы одной текстовой части для скина (`AgentText.renderDiagram`/`onOpenDiagram`). Незакрытый блок, пока текст
 * печатается, — `streaming`; закрытый рисуется сразу, не дожидаясь конца ответа; дальше `ready` или `failed`.
 */
export function useDiagramBlocks({ markdown, streaming, messageId, firstBlock, renders, colors, open }: UseDiagramBlocksOptions) {
  const blocks = useMemo(
    () => splitMermaidBlocks(markdown).flatMap((segment) => (segment.kind === "mermaid" ? [segment] : [])),
    [markdown],
  );
  const [version, setVersion] = useState(0);
  // Свой суффикс id у каждой вставки рисунка: в ленте и в окне просмотра (withUniqueIds).
  const insertion = useId();

  // Блок, который можно рисовать: закрыт или текст уже не печатается (незакрытый блок в готовом ответе — тоже схема).
  useEffect(() => {
    let alive = true;
    for (const block of blocks) {
      if ((block.closed || !streaming) && !renders.get(block.source, colors)) {
        void renders.request(block.source, colors).then(() => alive && setVersion((value) => value + 1));
      }
    }
    return () => {
      alive = false;
    };
  }, [blocks, colors, renders, streaming]);

  const renderDiagram = useCallback(
    (source: string, blockIndex: number): DiagramView => {
      const block = blocks[blockIndex];
      if (streaming && block && !block.closed) return { state: "streaming" };
      const result = renders.get(source, colors);
      if (!result) return { state: "streaming" };
      return "svg" in result ? { state: "ready", svg: withUniqueIds(result.svg, `${insertion}-${blockIndex}`), source } : { state: "failed", source };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version`: готов новый рисунок, функция новая, скин рисует блок заново
    [blocks, colors, insertion, renders, streaming, version],
  );

  const onOpenDiagram = useCallback(
    (blockIndex: number, trigger: HTMLElement) => {
      const block = blocks[blockIndex];
      const result = block && renders.get(block.source, colors);
      if (!open || !block || !result || !("svg" in result)) return;
      const key = `${messageId}:${firstBlock + blockIndex}`;
      const svg = withUniqueIds(result.svg, `${insertion}-${blockIndex}-viewer`);
      open(key, trigger, [{ kind: "diagram", key, svg, source: block.source }]);
    },
    [blocks, colors, firstBlock, insertion, messageId, open, renders],
  );

  return { renderDiagram, ...(open && { onOpenDiagram }) };
}
