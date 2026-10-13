// @vitest-environment jsdom
// Живая проверка схем (024, SC-008): с `agent.diagrams: true` настоящая модель на «нарисуй схему процесса заказа» пишет блок
// ```mermaid; блок режется так же, как на экране (`splitMermaidBlocks`) и рисуется настоящим mermaid в jsdom в чистый SVG.
// Блок mermaid обязателен (SC-008): просьба и инструкция подобраны так, чтобы он случался стабильно (до двух попыток).
// Ключ — только из окружения (`pnpm secrets:load`). Запуск: `pnpm test:live diagrams`.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../../core/src/index";
import { splitMermaidBlocks } from "../../../react/src/diagrams/mermaid-blocks";
import { describe, expect, it } from "vitest";
import { diagramsClient } from "../../src/index";
import type { DiagramColors } from "../../src/index";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "deepseek-4.1-flash";
const providerId = "openrouter";
const ownerId = "diagrams-tester";
const maxAttempts = 2;
const colors: DiagramColors = { background: "#ffffff", text: "#111111", line: "#555555", node: "#f2f2f2", accent: "#3366ff", dark: false };

/** jsdom не меряет текст: mermaid просит у SVG размеры слов, ему даётся грубая линейка (9 × 18 пикселей на знак). */
function stubTextMeasuring() {
  const proto = window.SVGElement.prototype as unknown as Record<string, unknown>;
  const lengthOf = (element: Element) => (element.textContent ?? "").length * 9;
  proto.getComputedTextLength = function (this: Element) {
    return lengthOf(this);
  };
  proto.getBBox = function (this: Element) {
    return { x: 0, y: 0, width: Math.max(lengthOf(this), 10), height: 18 };
  };
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}

describe("схемы у настоящей модели (OpenRouter)", () => {
  it("«нарисуй схему процесса заказа»: модель пишет блок mermaid, он рисуется в чистый SVG", async () => {
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: { instructions: "Ты помощник. Отвечай по-русски, коротко.", diagrams: true },
      env: process.env,
    });

    stubTextMeasuring();
    let text = "";
    let source: string | undefined;
    let attempts = 0;
    for (; attempts < maxAttempts && source === undefined; attempts++) {
      const chat = await service.createChat(ownerId);
      await drain(
        await service.sendMessage(ownerId, chat.id, {
          id: `u-${attempts}`,
          role: "user",
          parts: [{ type: "text", text: "Нарисуй схему процесса заказа в интернет-магазине: от корзины до получения." }],
        }),
      );
      const { messages } = await service.getHistory(ownerId, chat.id);
      const answer = messages.filter((message) => message.role === "assistant").at(-1)!;
      expect(answer.metadata?.status, JSON.stringify(answer.metadata)).toBe("complete");
      text = answer.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
      const block = splitMermaidBlocks(text).find((segment) => segment.kind === "mermaid" && segment.closed);
      source = block?.kind === "mermaid" ? block.source : undefined;
    }
    console.info(`[diagrams-result] попыток до блока mermaid: ${attempts}, блок: ${source ? "да" : "нет"}`);

    // SC-008: блок должен реально случиться.
    expect(source, `в ответе нет закрытого блока mermaid: ${text.slice(0, 500)}`).toBeTruthy();

    const result = await diagramsClient.render(source!, colors);
    expect("error" in result ? result.error : "", "mermaid не нарисовал схему модели").toBe("");
    const svg = (result as { svg: string }).svg;
    expect(svg.startsWith("<svg")).toBe(true);
    // Чистый SVG (FR-027): ни скриптов, ни foreignObject, ни обработчиков, ни внешних ссылок.
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.querySelectorAll("script, foreignObject, a, image").length).toBe(0);
    expect(/\son\w+=/i.test(svg)).toBe(false);
    expect(/href=["'](?!#)/i.test(svg)).toBe(false);
    console.info(`[diagrams-result] SVG ${svg.length} знаков, узлов в источнике: ${source!.split("\n").length - 1} строк`);
  }, 240_000);
});
