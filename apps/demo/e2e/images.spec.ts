import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { makePng } from "./support/sample-files";

/*
 * Фича 024: агент создаёт картинки, они ложатся в чат и открываются в окне просмотра.
 * Один сценарий подряд: чат у теста свой; телефон — images-phone.spec.ts. Поддельный Runware отвечает по сценарию
 * из описания картинки (server/mock-runware.ts): никакой сети и настоящих сроков.
 */

const redSquare = { name: "квадрат.png", mimeType: "image/png", buffer: Buffer.from(makePng(8, [220, 30, 30])) };

const readyTiles = (page: Page) => page.locator('[data-tile="ready"]');
const loadingTiles = (page: Page) => page.locator('[data-tile="loading"]');
const failedTiles = (page: Page) => page.locator('[data-tile="failed"]');
const viewer = (page: Page) => page.getByRole("dialog");

test("картинки: человек прислал свою, три заказа с одним сбоем, окно просмотра, перезагрузка", async ({ page }) => {
  await signIn(page);

  // Своя картинка человека: в карусели чата она идёт первой.
  await page.locator('input[type="file"]').setInputFiles(redSquare);
  await expect(page.getByRole("list", { name: "Вложения" }).getByAltText("квадрат.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  await send(page, "Вот моя картинка");
  await expect(lastAnswer(page)).toContainText("Вижу картинку");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Три картинки: сначала три заглушки, потом две картинки и пометка упавшей.
  await send(page, "Нарисуй три картинки");
  await expect(loadingTiles(page)).toHaveCount(3);
  await expect(readyTiles(page)).toHaveCount(2);
  await expect(failedTiles(page)).toHaveCount(1);
  await expect(failedTiles(page)).toContainText("Картинка не создалась");
  await expect(loadingTiles(page)).toHaveCount(0);
  await expect(lastAnswer(page)).toContainText("Создано 2 из 3.");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Окно просмотра: «2 из 3» (своя картинка + две созданные), стрелки.
  const first = readyTiles(page).first();
  await first.click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).getByText("2 из 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page).getByText("3 из 3")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer(page).getByText("2 из 3")).toBeVisible();

  // Закрыть крестиком, фоном, Esc и жестом «назад»: каждый раз фокус возвращается на картинку.
  await viewer(page).getByRole("button", { name: "Закрыть" }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(first).toBeFocused();

  await first.click();
  await expect(viewer(page)).toBeVisible();
  await page.locator("[data-viewer-stage]").click({ position: { x: 4, y: 4 } });
  await expect(viewer(page)).toHaveCount(0);
  await expect(first).toBeFocused();

  await first.click();
  await expect(viewer(page)).toBeVisible();
  // Клик по самой картинке не закрывает окно и не должен забирать у него клавиатуру.
  await viewer(page).getByRole("img").click();
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page).getByText("3 из 3")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
  await expect(first).toBeFocused();

  await first.click();
  await expect(viewer(page)).toBeVisible();
  await page.goBack();
  await expect(viewer(page)).toHaveCount(0);
  await expect(first).toBeFocused();

  // Перезагрузка: картинки и пометка упавшей на месте.
  await page.reload();
  await expect(readyTiles(page)).toHaveCount(2);
  await expect(failedTiles(page)).toHaveCount(1);
  await expect(readyTiles(page).first().locator("img")).toBeVisible();
  await expect.poll(() => readyTiles(page).first().locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test("одна картинка: заглушка, потом картинка, ответ модели", async ({ page }) => {
  await signIn(page);
  await send(page, "Нарисуй картинку");
  await expect(readyTiles(page)).toHaveCount(1);
  await expect(lastAnswer(page)).toContainText("Создано 1 из 1.");
  await expect(failedTiles(page)).toHaveCount(0);
});

test("«Стоп» на восьми картинках: создание остановлено", async ({ page }) => {
  await signIn(page);
  const label = `stop-${crypto.randomUUID()}`;
  await send(page, `Нарисуй восемь картинок, метка ${label}`);
  await expect(loadingTiles(page)).toHaveCount(8);
  // Заказ дошёл до провайдера: все восемь запросов у поддельного Runware ждут ответа.
  await expect
    .poll(async () => ((await (await page.request.get(`/api/demo/runware/pending/${label}`)).json()) as { pending: number }).pending)
    .toBe(8);
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "stopped");
  // Заглушки сменяются пометкой сразу; после перезагрузки (так сервер сохранил ответ) — то же самое.
  await expect(page.getByText("Создание остановлено")).toBeVisible();
  await expect(loadingTiles(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Создание остановлено")).toBeVisible();
  await expect(loadingTiles(page)).toHaveCount(0);
  await expect(readyTiles(page)).toHaveCount(0);
});
