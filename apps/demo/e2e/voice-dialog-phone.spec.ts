import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { signIn } from "./support/chat";
import { installFakeDialogMicrophone } from "./support/fake-dialog-microphone";

/*
 * Фича 016, телефон: только то, что зависит от экрана (сценарий разговора целиком проходит на компьютере, voice-dialog.spec.ts).
 * Узкая вёрстка, размер кнопок под палец, высота панели режима, касание вместо щелчка.
 */

const MIN_TOUCH = 44;
const start = (page: Page) => page.getByRole("button", { name: "Голосовой режим" });
const leave = (page: Page) => page.getByRole("button", { name: "Выйти", exact: true });
const panel = (page: Page) => page.locator("[data-state]").filter({ has: page.getByRole("status") }).first();

async function size(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("телефон: кнопки режима не меньше 44 пунктов, панель не выше трети экрана, страница не ползёт вбок", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);

  const opener = await size(start(page));
  expect(opener.width).toBeGreaterThanOrEqual(MIN_TOUCH);
  expect(opener.height).toBeGreaterThanOrEqual(MIN_TOUCH);

  await start(page).tap();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");
  const viewportHeight = page.viewportSize()!.height;
  expect((await size(panel(page))).height).toBeLessThanOrEqual(viewportHeight / 3);
  const exit = await size(leave(page));
  expect(exit.width).toBeGreaterThanOrEqual(MIN_TOUCH);
  expect(exit.height).toBeGreaterThanOrEqual(MIN_TOUCH);
  await expectNoSidewaysScroll(page);

  // Меню голосов: кнопка и пункты под палец, список помещается в экран.
  const menu = page.getByRole("button", { name: /Голос:/ });
  expect((await size(menu)).height).toBeGreaterThanOrEqual(MIN_TOUCH);
  await menu.tap();
  const options = page.getByRole("menuitemradio");
  await expect(options).toHaveCount(4);
  // Меню раскрывается анимацией (масштаб растёт до 100%): мерить можно, когда она кончилась.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  for (const option of await options.all()) {
    const box = await size(option);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.keyboard.press("Escape");

  await leave(page).tap();
  await expect(start(page)).toBeVisible();
});

test("телефон: длинная надпись об ошибке не раздувает панель выше трети экрана", async ({ page }) => {
  await installFakeDialogMicrophone(page, { microphone: "missing" });
  await signIn(page);

  await start(page).tap();
  await expect(page.getByRole("alert")).toHaveText("Микрофон недоступен: нужны микрофон, https и свежий браузер");
  expect((await size(panel(page))).height).toBeLessThanOrEqual(page.viewportSize()!.height / 3);
  await expectNoSidewaysScroll(page);
});
