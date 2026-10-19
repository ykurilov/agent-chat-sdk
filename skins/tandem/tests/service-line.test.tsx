// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TandemServiceLine } from "../src/service-line";
import { tandemSkin } from "../src";

afterEach(cleanup);

describe("100 служебная строка Тандема", () => {
  it("текст строкой без пузыря; скин её отдаёт", () => {
    const { container } = render(<TandemServiceLine text="Агент написал первым — человек молчал 1 ч 7 мин" />);
    expect(screen.getByText("Агент написал первым — человек молчал 1 ч 7 мин").tagName).toBe("P");
    expect(container.querySelector("[data-service-line]")).not.toBeNull();
    expect(tandemSkin.ServiceLine).toBe(TandemServiceLine);
  });
});
