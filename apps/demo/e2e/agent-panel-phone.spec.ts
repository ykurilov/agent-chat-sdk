import { expect, test } from "./support/own-server";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Панель агента на телефоне (фича 021): на весь экран, «Закрыть» видна, без прокрутки вбок, поле ввода не уходит под
 * экранную клавиатуру. Логика панели проверена на компьютере (agent-panel.spec.ts): здесь только то, что зависит от экрана.
 */

test.use({ hasTouch: true });

test("панель на весь экран; «Закрыть» видна; поле ввода остаётся на экране, когда его высота уменьшилась клавиатурой", async ({ page }) => {
  await page.context().addCookies([{ name: "demo-user", value: "anna", domain: "localhost", path: "/" }]);
  await page.goto("/panel-app");
  const viewport = page.viewportSize()!;
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /^(Открыть агента|Закрыть панель агента)$/ }).first().tap();
  const panel = page.getByRole("complementary", { name: "Панель агента" });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBe(viewport.width);
  expect(box.height).toBe(viewport.height);
  await expectInsideViewport(page, panel.getByRole("button", { name: "Закрыть панель агента" }));
  await expectNoHorizontalOverflow(page);

  // Экранная клавиатура съедает низ экрана: панель сжимается вместе с ним, поле ввода остаётся на виду.
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.tap();
  await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
  await expectInsideViewport(page, field);
  await expectInsideViewport(page, panel.getByRole("button", { name: "Закрыть панель агента" }));
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize(viewport);
  await panel.getByRole("button", { name: "Закрыть панель агента" }).tap();
  await expect(panel).toHaveCount(0);
});
