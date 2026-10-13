// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { ChatSkin } from "../src/skin-contract";
import { stubSkin } from "./support/stub-skin";

afterEach(cleanup);

type ComposerProps = ChatSkin["Composer"] extends ComponentType<infer P> ? P : never;

describe("договор скина, версия 19: кнопки приложения у поля ввода (типы проверяет typecheck)", () => {
  it("Composer.actions — необязательный готовый узел", () => {
    expectTypeOf<ComposerProps["actions"]>().toEqualTypeOf<ReactNode | undefined>();
    expect(true).toBe(true);
  });

  it("скин версии 18 работает без правок: его поле ввода рисуется и с actions, и без них", () => {
    const v18: ChatSkin = { ...stubSkin };
    const { Composer } = v18;
    const props: ComposerProps = { value: "", onValueChange: () => {}, onSubmit: () => {}, canSubmit: false, busy: false, onStop: () => {} };
    const { rerender } = render(<Composer {...props} />);
    expect(screen.getByLabelText("поле")).toBeTruthy();
    rerender(<Composer {...props} actions={<button type="button">Подсказка</button>} />);
    expect(screen.getByLabelText("поле")).toBeTruthy();
  });
});
