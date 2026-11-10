// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OduvanchikToolCallRow } from "../src/tool-call-row";

afterEach(cleanup);

describe("строка инструмента Одуванчика", () => {
  it("с названием от приложения показывает его, а не служебное имя", () => {
    render(<OduvanchikToolCallRow toolName="edit_lead_magnet" title="Правка лид-магнита" state="done" open={false} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Правка лид-магнита: готово" })).toBeTruthy();
    expect(screen.queryByText(/edit_lead_magnet/)).toBeNull();
  });

  it("без названия — служебное имя, как раньше", () => {
    render(<OduvanchikToolCallRow toolName="web_search" state="running" open={false} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "web_search: выполняется" })).toBeTruthy();
  });
});
