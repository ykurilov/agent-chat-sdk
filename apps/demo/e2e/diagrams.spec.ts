import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Фича 024: блок ```mermaid в ответе рисуется схемой, клик открывает её в окне просмотра.
 * Один сценарий подряд: чат у теста свой; телефон — diagrams-phone.spec.ts.
 */

const diagram = (page: Page) => page.locator("[data-diagram]");
const openButton = (page: Page) => page.getByRole("button", { name: "Открыть схему" });
const viewer = (page: Page) => page.getByRole("dialog", { name: "схема на экране" });
const scaleOf = async (page: Page) => Number(await page.locator("[data-viewer-content]").getAttribute("data-scale"));

test("схема: заглушка при печати, рисунок, окно во весь экран, масштаб колесом, «вписать», Esc и Enter", async ({ page }) => {
  await signIn(page);
  await send(page, "Нарисуй схему");

  // Блок печатается кусками: пока он не закрыт, на его месте заглушка; потом рисунок.
  await expect(page.locator('[data-diagram="streaming"]')).toBeVisible();
  await expect(page.locator('[data-diagram="ready"]')).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(diagram(page)).toHaveCount(1);
  await expect(page.locator('[data-diagram="ready"] [data-diagram-canvas] svg')).toBeVisible();

  // Клик: окно просмотра во весь экран.
  await openButton(page).click();
  await expect(viewer(page)).toBeVisible();
  const size = page.viewportSize()!;
  expect(await viewer(page).boundingBox()).toMatchObject({ x: 0, y: 0, width: size.width, height: size.height });
  await expect(viewer(page).locator("[data-viewer-content] svg")).toBeVisible();
  await expect(viewer(page).getByRole("button", { name: "Закрыть" })).toBeFocused();

  // Колесо меняет масштаб, «вписать» возвращает.
  expect(await scaleOf(page)).toBe(1);
  await page.locator("[data-viewer-stage]").hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(1);
  await viewer(page).getByRole("button", { name: "Вписать в экран" }).click();
  await expect.poll(() => scaleOf(page)).toBe(1);

  // Esc закрывает окно, фокус возвращается на схему.
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
  await expect(openButton(page)).toBeFocused();

  // Enter на схеме в фокусе открывает окно снова.
  await page.keyboard.press("Enter");
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
});

test("сломанная схема: показан исходный текст кода, а не рисунок", async ({ page }) => {
  await signIn(page);
  await send(page, "Нарисуй сломанную схему");
  const failed = page.locator('[data-diagram="failed"]');
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("graph TD");
  await expect(failed).toContainText("Схему не удалось нарисовать, показан её текст");
  await expect(page.locator('[data-diagram="ready"]')).toHaveCount(0);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
});
