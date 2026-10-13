// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { DiagramView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentText } from "../src/agent-text";
import { tandemSkin } from "../src/index";

afterEach(cleanup);

const fence = "\x60\x60\x60";
const source = "graph TD\nA-->B";
const markdown = `Вот процесс:\n${fence}mermaid\n${source}\n${fence}\nИ всё.`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" width="100%" style="max-width: 1200px;"><text>A</text></svg>';
const labels = russianLabels;

describe("Тандем: схема в тексте ответа (T038)", () => {
  it("без renderDiagram блок ```mermaid — обычный код с кнопкой копирования, как в 0.15", () => {
    const { container } = render(<TandemAgentText markdown={markdown} streaming={false} />);
    expect(container.querySelector(".tandem-code code")?.textContent).toContain("A-->B");
    expect(container.querySelector("[data-diagram]")).toBeNull();
  });

  it("streaming: заглушка с надписью, занятость для диктора; исходник кодом не мелькает", () => {
    const { container } = render(<TandemAgentText markdown={markdown} streaming renderDiagram={() => ({ state: "streaming" })} />);
    const placeholder = container.querySelector<HTMLElement>('[data-diagram="streaming"]')!;
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
    expect(placeholder.textContent).toContain(labels.diagram.loading);
    expect(placeholder.className).toMatch(/min-h-/);
    expect(container.querySelector(".tandem-code")).toBeNull();
    expect(container.textContent).toContain("Вот процесс:");
    expect(container.textContent).toContain("И всё.");
  });

  it("ready: SVG в блоке с прокруткой вбок, во всю свою ширину; диктору — «схема» и исходник", () => {
    const { container } = render(
      <TandemAgentText markdown={markdown} streaming={false} renderDiagram={() => ({ state: "ready", svg, source })} />,
    );
    const figure = container.querySelector<HTMLElement>('[data-diagram="ready"]')!;
    expect(figure.querySelector(".overflow-x-auto svg")).not.toBeNull();
    expect(figure.querySelector<HTMLElement>("[data-diagram-canvas]")!.style.width).toBe("1200px");
    expect(figure.querySelector("[data-diagram-canvas]")!.getAttribute("aria-hidden")).toBe("true");
    const spoken = figure.querySelector(".sr-only")!.textContent!;
    expect(spoken).toContain(labels.voice.diagramOnScreen);
    expect(spoken).toContain(source);
    expect(figure.querySelector('[role="button"]')).toBeNull();
  });

  it("ready с onOpenDiagram: курсор и значок «открыть»; клик, Enter и пробел открывают со схемой-источником", () => {
    const onOpenDiagram = vi.fn();
    render(
      <TandemAgentText
        markdown={markdown}
        streaming={false}
        renderDiagram={() => ({ state: "ready", svg, source })}
        onOpenDiagram={onOpenDiagram}
      />,
    );
    const opener = screen.getByRole("button", { name: labels.diagram.open });
    expect(opener.tabIndex).toBe(0);
    expect(opener.className).toMatch(/cursor-zoom-in|cursor-pointer/);
    expect(opener.querySelector("svg.lucide")).not.toBeNull();
    fireEvent.click(opener);
    fireEvent.keyDown(opener, { key: "Enter" });
    fireEvent.keyDown(opener, { key: " " });
    fireEvent.keyDown(opener, { key: "a" });
    expect(onOpenDiagram).toHaveBeenCalledTimes(3);
    expect(onOpenDiagram).toHaveBeenCalledWith(0, opener);
  });

  it("failed: исходный текст блоком кода с «копировать», без красной ошибки", () => {
    const { container } = render(
      <TandemAgentText markdown={markdown} streaming={false} renderDiagram={() => ({ state: "failed", source })} />,
    );
    const failed = container.querySelector<HTMLElement>('[data-diagram="failed"]')!;
    expect(failed.querySelector(".tandem-code code")?.textContent).toContain("A-->B");
    expect(failed.querySelector(".tandem-code button")).not.toBeNull();
    expect(failed.textContent).toContain(labels.diagram.failed);
    expect(failed.innerHTML).not.toMatch(/danger|error|red/);
  });

  it("несколько схем: renderDiagram получает исходники по порядку с номерами 0, 1", () => {
    const renderDiagram = vi.fn((): DiagramView => ({ state: "streaming" }));
    render(
      <TandemAgentText
        markdown={`${fence}mermaid\nA\n${fence}\nтекст\n\n${fence}mermaid\nB\n${fence}`}
        streaming={false}
        renderDiagram={renderDiagram}
      />,
    );
    expect(renderDiagram.mock.calls).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
  });

  it("diagramColors: цвета Тандема светлой и тёмной темы конкретными значениями", () => {
    const light = tandemSkin.diagramColors!(false);
    const dark = tandemSkin.diagramColors!(true);
    expect(light.dark).toBe(false);
    expect(dark.dark).toBe(true);
    for (const colors of [light, dark]) {
      for (const key of ["background", "text", "line", "node", "accent"] as const) expect(colors[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(dark.background).not.toBe(light.background);
  });
});
