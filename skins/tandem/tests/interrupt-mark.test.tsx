// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentMessage } from "../src/agent-message";
import { TandemInterruptMark } from "../src/interrupt-mark";

afterEach(cleanup);

describe("отметка обрыва озвучки", () => {
  it("«Вы перебили: озвучено до «…»» по словарю", () => {
    render(<TandemInterruptMark spokenTail="Завтра будет солнечно" />);

    expect(screen.getByText(russianLabels.voiceDialog.interruptedMark("Завтра будет солнечно"))).toBeTruthy();
    expect(screen.getByText("Вы перебили: озвучено до «Завтра будет солнечно»")).toBeTruthy();
  });

  it("длинный хвост переносится по словам, а не растягивает строку", () => {
    const { container } = render(<TandemInterruptMark spokenTail={"очень".repeat(60)} />);

    expect(container.firstElementChild!.className).toContain("break-words");
  });

  it("пустой хвост — отметки нет: не сказано ни слова, отмечать нечего", () => {
    const { container } = render(<TandemInterruptMark spokenTail="  " />);

    expect(container.firstChild).toBeNull();
  });
});

describe("ответ агента: отметка обрыва", () => {
  const message = (extra: Partial<ComponentProps<typeof TandemAgentMessage>> = {}) => (
    <TooltipProvider>
      <TandemAgentMessage status="complete" onCopy={vi.fn()} empty={false} notice={null} {...extra}>
        <p>Текст ответа</p>
      </TandemAgentMessage>
    </TooltipProvider>
  );

  it("есть voiceInterrupted — отметка под ответом", () => {
    render(message({ voiceInterrupted: { spokenTail: "Завтра" } }));

    expect(screen.getByText("Вы перебили: озвучено до «Завтра»")).toBeTruthy();
  });

  it("нет voiceInterrupted — отметки нет: ответ как раньше", () => {
    render(message());

    expect(screen.queryByText(/Вы перебили/)).toBeNull();
  });

  it("отметка стоит после ответа и до строки с кнопками", () => {
    render(message({ voiceInterrupted: { spokenTail: "Завтра" } }));

    const mark = screen.getByText(/Вы перебили/);
    expect(screen.getByText("Текст ответа").compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mark.compareDocumentPosition(screen.getByRole("button", { name: /копировать/i })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ответ агента: оборван по длине (FR-054)", () => {
  const message = (extra: Partial<ComponentProps<typeof TandemAgentMessage>> = {}) => (
    <TooltipProvider>
      <TandemAgentMessage status="complete" onCopy={vi.fn()} empty={false} notice={null} {...extra}>
        <p>Текст ответа</p>
      </TandemAgentMessage>
    </TooltipProvider>
  );

  it("cutByLength — отметка «Ответ оборван по длине» в строке под ответом", () => {
    render(message({ cutByLength: true }));
    expect(screen.getByText(russianLabels.answerCutByLength)).toBeTruthy();
  });

  it("без cutByLength — отметки нет", () => {
    render(message());
    expect(screen.queryByText(russianLabels.answerCutByLength)).toBeNull();
  });
});
