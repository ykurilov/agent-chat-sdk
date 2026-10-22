import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { OduvanchikDiagram } from "./diagram";
import { OduvanchikLiveDemo } from "./live-demo";
import { splitAnswerBlocks } from "./markdown-blocks";
import { SafeMarkdown } from "./safe-markdown";

/*
 * На сенсорном экране кнопка копирования кода видна всегда, а длинная строка кода
 * прокручивается вбок и уезжает под неё. Там код начинается под кнопкой.
 * `!`: стили Тандема лежат вне слоёв и иначе перебивают утилиты.
 */
const codeBelowCopyButtonOnTouch = "[@media(hover:none)]:[&_.tandem-code_pre]:pt-10! [@media(hover:none)]:[&_.tandem-code_pre]:pr-3.5!";

/*
 * Каждый блок — свой `Markdown`, а Тандем обнуляет отступы у первого и последнего элемента.
 * На стыке блоков отступы возвращаются теми же, что задаёт Тандем внутри текста,
 * и схлопываются так же, как в одном `Markdown`.
 *
 * «Не первый» и «не последний» блок решает код, а не селекторы `:not(:first-child)` и `:not(:last-child)`:
 * когда у элемента меняется «последний ли он», браузер пересчитывает стили всех его потомков по такому
 * селектору. Под ответом появляется строка с кнопками, ответ перестаёт быть последним, и на огромном
 * ответе браузер разом пересчитывает стили тысяч элементов (research.md, R16).
 */
const spacingAfterPreviousBlock =
  "[&>.tandem-markdown>:first-child]:mt-[.75em]! [&>.tandem-markdown>:is(h1,h2,h3,h4,h5,h6):first-child]:mt-[1.25em]!";
const spacingBeforeNextBlock =
  "[&>.tandem-markdown>:last-child]:mb-[.75em]! [&>.tandem-markdown>:is(h1,h2,h3,h4,h5,h6):last-child]:mb-[.4em]!";

// Схема и демонстрация — не Markdown: их отступы от соседних блоков — те же .75em, что у блоков кода внутри текста.
const diagramAfterPreviousBlock = "mt-[.75em]";
const diagramBeforeNextBlock = "mb-[.75em]";

/**
 * Текст ответа с разметкой: списки, таблицы, код с кнопкой копирования. Готовые блоки не перерисовываются.
 * Картинки с чужих адресов показываются ссылкой: браузер не ходит по ним сам. Со схемами (`renderDiagram`) блок
 * ```mermaid рисуется схемой; без них — кодом. С демонстрациями (`renderDemo`) блок ```html-demo запускается в рамке.
 */
export function OduvanchikAgentText({ markdown, renderDiagram, onOpenDiagram, renderDemo }: ComponentProps<ChatSkin["AgentText"]>) {
  const blocks = splitAnswerBlocks(markdown, { diagrams: renderDiagram !== undefined, demos: renderDemo !== undefined });
  return (
    <div className={codeBelowCopyButtonOnTouch}>
      {blocks.map((block, index) => {
        const notFirst = index > 0;
        const notLast = index < blocks.length - 1;
        if (block.kind === "diagram" && renderDiagram) {
          return (
            <OduvanchikDiagram
              key={index}
              view={renderDiagram(block.source, block.index)}
              markdown={block.markdown}
              className={`${notFirst ? diagramAfterPreviousBlock : ""} ${notLast ? diagramBeforeNextBlock : ""}`}
              {...(onOpenDiagram && { onOpen: (trigger: HTMLElement) => onOpenDiagram(block.index, trigger) })}
            />
          );
        }
        if (block.kind === "demo" && renderDemo) {
          return (
            <OduvanchikLiveDemo
              key={index}
              view={renderDemo(block.source, block.index)}
              markdown={block.markdown}
              className={`${notFirst ? diagramAfterPreviousBlock : ""} ${notLast ? diagramBeforeNextBlock : ""}`}
            />
          );
        }
        return (
          <div key={index} className={`${notFirst ? spacingAfterPreviousBlock : ""} ${notLast ? spacingBeforeNextBlock : ""}`}>
            <SafeMarkdown markdown={block.markdown} />
          </div>
        );
      })}
    </div>
  );
}
