// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it } from "vitest";
import { TandemAgentText } from "../src/agent-text";
import { withoutExternalImages } from "../src/external-images";

afterEach(cleanup);

const evil = "https://evil.example/p.png?d=Anna%2C%20diabetes";

describe("внешние картинки в ответе модели", () => {
  it("картинка с чужого адреса не грузится: на её месте ссылка с подписью", () => {
    const { container } = render(<TandemAgentText markdown={`Вот график:\n\n![график продаж](${evil})`} />);
    expect(container.querySelector("img")).toBeNull();
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(evil);
    expect(link.textContent).toBe("график продаж");
  });

  it("картинка без подписи, по ссылке-имени и внутри таблицы — тоже ссылка", () => {
    const markdown = [
      `Текст ![](${evil}) дальше.`,
      "",
      "![схема][s]",
      "",
      "| a | b |",
      "|---|---|",
      `| ![x](//evil.example/t.png) | 2 |`,
      "",
      `[s]: ${evil}`,
    ].join("\n");
    const { container } = render(<TandemAgentText markdown={markdown} />);
    expect(container.querySelector("img")).toBeNull();
    expect([...container.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["картинка", "схема", "x"]);
  });

  it("подпись из словаря экранируется: «]» и «*» не ломают разметку", () => {
    expect(withoutExternalImages(`![](${evil})`, "pic] *x*")).toBe(`[pic\\] \\*x\\*](${evil})`);
    const { container } = render(
      <ChatLabelsProvider labels={{ ...russianLabels, externalImageLink: "pic] *x*" }}>
        <TandemAgentText markdown={`![](${evil})`} />
      </ChatLabelsProvider>,
    );
    expect(container.querySelector("a")!.textContent).toBe("pic] *x*");
    expect(container.querySelector("em")).toBeNull();
  });

  it("свой словарь без externalImageLink: подпись по умолчанию", () => {
    const { externalImageLink: _omitted, ...withoutField } = russianLabels;
    const { container } = render(
      <ChatLabelsProvider labels={withoutField}>
        <TandemAgentText markdown={`![](${evil})`} />
      </ChatLabelsProvider>,
    );
    expect(container.querySelector("a")!.textContent).toBe(russianLabels.externalImageLink);
  });

  it("картинка внутри кода не трогается", () => {
    const markdown = `\`![a](${evil})\`\n\n\`\`\`md\n![b](${evil})\n\`\`\``;
    expect(withoutExternalImages(markdown, "картинка")).toBe(markdown);
  });

  it("своя картинка (адрес без домена) и data-адрес показываются картинкой", () => {
    const { container } = render(<TandemAgentText markdown={"![своя](/files/a.png)\n\n![точка](data:image/png;base64,iVBORw0KGgo=)"} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("текст без картинок не меняется", () => {
    const markdown = "Просто [ссылка](https://example.com) и **жирный** текст! Восклицание ![не картинка";
    expect(withoutExternalImages(markdown, "картинка")).toBe(markdown);
  });
});
