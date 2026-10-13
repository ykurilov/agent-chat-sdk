// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemSkin } from "../src";
import { TandemComposer } from "../src/composer";
import { TandemChatClosedNotice } from "../src/chat-closed-notice";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("надпись закрытого чата", () => {
  it("слова приложения как текст, роль status, id и код в атрибутах, фокусируется программно", () => {
    render(<TandemChatClosedNotice id="closed-1" code="form_submitted" message="Заявка отправлена, чат закрыт" />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Заявка отправлена, чат закрыт");
    expect(notice.id).toBe("closed-1");
    expect(notice.getAttribute("data-closed-code")).toBe("form_submitted");
    // Атрибут нужен самому по себе: без него `focus()` на элементе ничего не делает (у `div` в jsdom `tabIndex` и так -1).
    expect(notice.getAttribute("tabindex")).toBe("-1");
  });

  it("разметка в словах приложения не разбирается", () => {
    render(<TandemChatClosedNotice id="n" code="x" message="<b>жирно</b>" />);
    expect(screen.getByRole("status").textContent).toContain("<b>жирно</b>");
    expect(document.querySelector("b")).toBeNull();
  });

  it("поле в фокусе, чат закрыли: фокус уходит на надпись (её находит поле по id), а не пропадает", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const tree = (props: Partial<ComponentProps<typeof TandemComposer>>) => (
      <TooltipProvider>
        {props.sendingBlocked && <TandemChatClosedNotice id="closed-1" code="form_submitted" message="Заявка отправлена, чат закрыт" />}
        <TandemComposer value="Привет" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
      </TooltipProvider>
    );
    const { rerender } = render(tree({}));
    const field = screen.getByLabelText("Сообщение");
    field.focus();

    rerender(tree({ sendingBlocked: true, sendingBlockedReasonId: "closed-1" }));
    expect(document.activeElement).toBe(document.getElementById("closed-1"));
  });

  it("скин Тандема отдаёт компонент договора версии 20", () => {
    expect(tandemSkin.ChatClosedNotice).toBe(TandemChatClosedNotice);
  });
});
