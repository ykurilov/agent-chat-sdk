import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Фича 079: готовая картинка из библиотеки приложения в том же чате, что и созданная. Один сценарий подряд, чат у теста
 * свой. Тёмная тема и телефон — только снимками и проверкой вёрстки; логика показа проверена юнит-тестами.
 */

const screenshotDir = screenshotFolder("agent-chat-e2e");
const viewer = (page: Page) => page.getByRole("dialog");
const libraryImage = (page: Page) => page.getByRole("figure").filter({ hasText: "Строение клетки" });

test("библиотека картинок: показ по ширине ответа с подписью, общая карусель с созданной, перезагрузка, отказ, темы, телефон", async ({ page }) => {
  await signIn(page);

  await send(page, "Нарисуй картинку");
  await expect(lastAnswer(page)).toContainText("Создано 1 из 1.");

  await send(page, "Покажи картинку про клетку");
  await expect(lastAnswer(page)).toContainText("Вот картинка");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const figure = libraryImage(page);
  await expect(figure.locator("figcaption")).toHaveText("Строение клетки");
  const button = figure.getByRole("button", { name: /Схема клетки: ядро в центре/ });
  await expect(button.locator("img")).toHaveAttribute("src", "/library/cell.svg");
  await expect.poll(() => button.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  // По ширине ответа и своей пропорции 3:2.
  const box = (await button.boundingBox())!;
  expect(Math.abs(box.width / box.height - 1.5)).toBeLessThan(0.02);
  expect(box.width).toBeGreaterThan(500);
  await saveScreenshot(page, screenshotDir, "079-library-light");

  // Окно просмотра листает обе картинки ответа: созданную и из библиотеки.
  await button.click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).getByText("2 из 2")).toBeVisible();
  await saveScreenshot(page, screenshotDir, "079-library-viewer");
  await page.keyboard.press("ArrowLeft");
  await expect(viewer(page).getByText("1 из 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
  await expect(button).toBeFocused();

  // История: после перезагрузки картинка и подпись на месте.
  await page.reload();
  await expect(libraryImage(page).locator("figcaption")).toHaveText("Строение клетки");

  // id не из каталога: сервер отказывает ошибкой инструмента, картинки нет.
  await send(page, "Покажи несуществующую картинку");
  await expect(lastAnswer(page)).toContainText("Такой картинки в каталоге нет.");
  await expect(lastAnswer(page).getByRole("button", { name: "show_image: ошибка" })).toBeVisible();
  await expect(libraryImage(page)).toHaveCount(1);

  await libraryImage(page).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Тёмная тема" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await saveScreenshot(page, screenshotDir, "079-library-dark");

  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await libraryImage(page).scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const phoneBox = (await libraryImage(page).boundingBox())!;
  expect(phoneBox.x).toBeGreaterThanOrEqual(0);
  expect(phoneBox.x + phoneBox.width).toBeLessThanOrEqual(390);
  await saveScreenshot(page, screenshotDir, "079-library-phone");
});
