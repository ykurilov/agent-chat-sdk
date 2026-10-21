// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels } from "@ykurilov/agent-chat-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TandemAgentMessage } from "../src/agent-message";
import { TandemReasoning } from "../src/reasoning";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-06T10:00:00.000Z") });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const [firstPhrase] = russianLabels.thinkingPhrases;
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** Текст, который видит экранный диктор: без частей, скрытых `aria-hidden`. */
function spokenText(element: Element): string {
  if (element.getAttribute("aria-hidden") === "true") return "";
  return [...element.childNodes].map((node) => (node.nodeType === Node.TEXT_NODE ? node.textContent : node instanceof Element ? spokenText(node) : "")).join("");
}

function waitingAnswer() {
  return render(
    <TooltipProvider>
      <TandemAgentMessage status="streaming" onCopy={vi.fn()} empty={false} notice={null} />
    </TooltipProvider>,
  );
}

describe("строка ожидания ответа без текста", () => {
  it("видна и тогда, когда AgentChat передаёт пустой список частей и ничего", () => {
    const { container } = render(
      <TooltipProvider>
        <TandemAgentMessage status="streaming" onCopy={vi.fn()} empty={false} notice={null}>
          {[]}
          {undefined}
        </TandemAgentMessage>
      </TooltipProvider>,
    );
    expect(container.querySelector("[data-thinking-status]")).not.toBeNull();
  });


  it("видна фраза и время; через 4 с — другая фраза и «4 с», через 65 с — «1 мин 5 с»", () => {
    const { container } = waitingAnswer();
    const line = container.querySelector("[data-thinking-status]")!;
    expect(line.textContent).toContain(firstPhrase);
    expect(line.textContent).toContain("0 с");
    tick(4_000);
    expect(line.textContent).not.toContain(firstPhrase);
    expect(line.textContent).toContain("4 с");
    tick(61_000);
    expect(line.textContent).toContain("1 мин 5 с");
  });

  it("диктор слышит одну постоянную надпись: фразы и время от него скрыты, живая область не меняется", () => {
    waitingAnswer();
    const status = screen.getByRole("status");
    expect(spokenText(status)).toBe(russianLabels.reasoningRunning);
    tick(10_000);
    expect(spokenText(status)).toBe(russianLabels.reasoningRunning);
    for (const live of document.querySelectorAll("[aria-live]")) expect(spokenText(live)).toBe(russianLabels.reasoningRunning);
  });

  it("смена фразы анимируется только без prefers-reduced-motion", () => {
    const { container } = waitingAnswer();
    const phrase = container.querySelector("[data-thinking-phrase]")!;
    const animations = phrase.className.split(/\s+/).filter((name) => name.includes("animate-"));
    expect(animations.length).toBeGreaterThan(0);
    for (const name of animations) expect(name.startsWith("motion-safe:")).toBe(true);
  });

  it("ответ дописан — таймеров нет", () => {
    render(
      <TooltipProvider>
        <TandemAgentMessage status="complete" onCopy={vi.fn()} empty={false} notice={null}>
          <p>Ответ</p>
        </TandemAgentMessage>
      </TooltipProvider>,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("блок рассуждений, пока модель думает", () => {
  it("кнопка с постоянным именем «Думает…», на экране — меняющаяся фраза и время; после — «Думал N сек»", () => {
    const props = { text: "", open: false, onOpenChange: vi.fn() };
    const { rerender } = render(<TandemReasoning {...props} streaming durationMs={null} />);
    const button = screen.getByRole("button", { name: russianLabels.reasoningRunning });
    expect(button.textContent).toContain(firstPhrase);
    tick(4_000);
    expect(button.textContent).not.toContain(firstPhrase);
    expect(button.textContent).toContain("4 с");
    expect(screen.getByRole("button", { name: russianLabels.reasoningRunning })).toBe(button);

    rerender(<TandemReasoning {...props} streaming={false} durationMs={3_000} />);
    expect(screen.getByRole("button").textContent).toBe("Думал 3 сек");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("заголовок раздумья в подробном виде (договор 28)", () => {
  it("есть заголовок — он вместо «Думал N сек»; пока думает — живая надпись", () => {
    const props = { text: "мысль", open: false, onOpenChange: vi.fn() };
    const { rerender } = render(<TandemReasoning {...props} streaming={false} durationMs={3_000} title="Продумываю правила игры" />);
    expect(screen.getByRole("button").textContent).toBe("Продумываю правила игры");
    rerender(<TandemReasoning {...props} streaming durationMs={null} title="Продумываю правила игры" />);
    expect(screen.getByRole("button", { name: russianLabels.reasoningRunning })).toBeTruthy();
  });
});
