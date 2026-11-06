import { test, expect } from "@playwright/test";
const luminance = (color: string) => {
  const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722;
};
const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
for (const theme of ["light", "dark"]) test(`visible selection on chat surfaces (${theme})`, async ({ page }, info) => {
  await page.goto(`/selection.html?theme=${theme}`);
  for (const id of ["agent", "user", "code", "raised", "composer", "portal"]) {
    const colors = await page.locator(`#${id}`).evaluate((node) => {
      const selection = getComputedStyle(node, "::selection");
      let at: Element | null = node;
      while (at && getComputedStyle(at).backgroundColor === "rgba(0, 0, 0, 0)") at = at.parentElement;
      return { bg: selection.backgroundColor, fg: selection.color, surface: at ? getComputedStyle(at).backgroundColor : "rgb(255, 255, 255)" };
    });
    expect(contrast(colors.bg, colors.fg), `${id}: text contrast`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.bg, colors.surface), `${id}: selection/surface contrast`).toBeGreaterThanOrEqual(3);
  }
  const outside = await page.locator("#outside").evaluate((node) => getComputedStyle(node, "::selection").backgroundColor);
  expect(outside).toBe("rgba(0, 0, 0, 0)");
  // Select real glyphs across the message surfaces, then capture the painted highlight.
  await page.locator("#agent").evaluate((node) => {
    const range = document.createRange(); range.setStart(node.firstChild!, 0);
    range.setEnd(document.querySelector("#raised")!.firstChild!, document.querySelector("#raised")!.textContent!.length);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  expect(await page.evaluate(() => getSelection()?.toString())).toContain("Сообщение пользователя");
  await page.screenshot({ path: info.outputPath(`selection-${theme}.png`), fullPage: true, animations: "disabled" });
  await page.locator("#composer").focus();
  await page.locator("#composer").evaluate((node: HTMLTextAreaElement) => node.select());
  expect(await page.locator("#composer").evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart)).toBeGreaterThan(20);
  await page.screenshot({ path: info.outputPath(`selection-composer-${theme}.png`), fullPage: true, animations: "disabled" });
});
