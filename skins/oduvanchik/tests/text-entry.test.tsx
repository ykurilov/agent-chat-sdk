import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OduvanchikAgentText } from "../src/text";

describe("text-only server renderer", () => {
  it("renders paragraphs, GFM, code and local images without providers or a DOM", () => {
    const html = renderToStaticMarkup(<OduvanchikAgentText markdown={'Первый\n\n**Второй**\n\n- [x] Готово\n\n```js\nconst a = 1\n```\n\n![Фото](/photo.png)'} />);
    expect(html).toContain("<p>Первый</p>");
    expect(html).toContain("<strong>Второй</strong>");
    expect(html).toContain('aria-label="Выполнено"');
    expect(html).toContain("language-js");
    expect(html).toContain('src="/photo.png"');
  });
  it("does not execute HTML, load external images or leave unsafe links clickable", () => {
    const html = renderToStaticMarkup(<OduvanchikAgentText markdown={'![Внешнее](https://attacker.test/pixel)\n\n[Опасно](javascript:alert)\n\n<script>boom()</script>'} />);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href=""');
    expect(html).not.toContain('<script>');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
