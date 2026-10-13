// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { russianLabels } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it } from "vitest";
import { TandemAgentText } from "../src/agent-text";
import { tandemSkin } from "../src/index";

afterEach(cleanup);

const fence = "\x60\x60\x60";
const source = "<p>Привет</p>";
const markdown = `Смотрите:\n${fence}html-demo\n${source}\n${fence}\nИ всё.`;
const labels = russianLabels;

describe("Тандем: живая демонстрация в тексте ответа (043)", () => {
  it("без renderDemo блок ```html-demo — обычный код с кнопкой копирования", () => {
    const { container } = render(<TandemAgentText markdown={markdown} streaming={false} />);
    expect(container.querySelector(".tandem-code code")?.textContent).toContain("<p>Привет</p>");
    expect(container.querySelector("[data-live-demo]")).toBeNull();
  });

  it("streaming: плашка «Готовлю демонстрацию…», занятость для диктора; код не мелькает", () => {
    const { container } = render(<TandemAgentText markdown={markdown} streaming renderDemo={() => ({ state: "streaming" })} />);
    const placeholder = container.querySelector<HTMLElement>('[data-live-demo="streaming"]')!;
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
    expect(placeholder.textContent).toContain(labels.demo.loading);
    expect(labels.demo.loading).toBe("Готовлю демонстрацию…");
    expect(container.querySelector(".tandem-code")).toBeNull();
    expect(container.textContent).toContain("Смотрите:");
    expect(container.textContent).toContain("И всё.");
  });

  it("ready: рамка слоя поведения во всю ширину ответа, без своих стилей поверх неё", () => {
    const frame = <iframe title="рамка" data-testid="frame" />;
    const { container } = render(<TandemAgentText markdown={markdown} streaming={false} renderDemo={() => ({ state: "ready", source, frame })} />);
    const ready = container.querySelector<HTMLElement>('[data-live-demo="ready"]')!;
    expect(ready.querySelector('iframe[title="рамка"]')).not.toBeNull();
    expect(ready.className).toMatch(/w-full/);
    expect(container.querySelector(".tandem-code")).toBeNull();
  });

  it("code: исходник блоком кода и пометка по причине", () => {
    for (const reason of ["tooLarge", "unfinished", "leftPage", "externalContent"] as const) {
      const { container, unmount } = render(<TandemAgentText markdown={markdown} streaming={false} renderDemo={() => ({ state: "code", source, reason })} />);
      const code = container.querySelector<HTMLElement>('[data-live-demo="code"]')!;
      expect(code.querySelector(".tandem-code code")?.textContent).toContain("<p>Привет</p>");
      expect(code.textContent).toContain(labels.demo[reason]);
      unmount();
    }
  });

  it("цвета демонстраций в палитре Тандема: светлая и тёмная", () => {
    expect(tandemSkin.demoColors?.(false)).toMatchObject({ dark: false, background: expect.stringMatching(/^#/) });
    expect(tandemSkin.demoColors?.(true)).toMatchObject({ dark: true });
  });
});
