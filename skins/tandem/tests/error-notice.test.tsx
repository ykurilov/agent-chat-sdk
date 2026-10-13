// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemErrorNotice } from "../src/error-notice";

afterEach(cleanup);

describe("ошибка ответа в Тандеме", () => {
  it("context_overflow показывает надпись по виду", () => {
    render(
      <ChatLabelsProvider labels={russianLabels}>
        <TandemErrorNotice kind="context_overflow" onRetry={vi.fn()} />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Переписка не помещается в модель. Начните новый чат или выберите модель с большим окном")).toBeTruthy();
  });
});

describe("отказ сервера своими словами в Тандеме", () => {
  it("показывает текст сервера вместо общей надписи, разметку — как текст, без «Повторить»", () => {
    render(
      <ChatLabelsProvider labels={russianLabels}>
        <TandemErrorNotice kind="other" text="<b>Разговор</b> завершён" />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("<b>Разговор</b> завершён")).toBeTruthy();
    expect(screen.queryByText(russianLabels.errors.other)).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
