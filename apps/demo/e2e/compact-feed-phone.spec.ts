import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { lastAnswer, signIn } from "./support/chat";
import { wakeAfterGenerations } from "./support/compact-feed";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Компактная лента на телефоне (390 px, касание): только вёрстка и цели касания. Сценарий и логика — compact-feed.spec.ts.
 * Карандаш один — слева от пузыря, а не отдельной строкой; кнопки под ответом на вид 32 px, касание — 44 px.
 */

test.use({ viewport: { width: 390, height: 844 } });

const shots = screenshotFolder("agent-chat-compact-feed");

/** Точка экрана попадает в кнопку (или в её содержимое). */
async function hits(page: Page, button: Locator, x: number, y: number) {
  const handle = await button.elementHandle();
  return page.evaluate(([element, px, py]) => (element as Element).contains(document.elementFromPoint(px as number, py as number)), [handle, x, y] as const);
}

test("390 px: карандаш слева от пузыря, кнопки ответа низкие, но касание 44 px; страница не шире экрана", async ({ page }) => {
  await signIn(page, "Анна", "/", "default");
  await wakeAfterGenerations(page);

  const user = page.locator(".oduvanchik-user").first();
  await expect(user).toHaveAttribute("data-edit-beside", "");
  const pencil = user.getByRole("button", { name: "Изменить сообщение" });
  const [bubble, pencilBox] = [await user.locator("[data-user-text] > div").boundingBox(), await pencil.boundingBox()];
  expect(pencilBox!.x + pencilBox!.width).toBeLessThanOrEqual(bubble!.x);
  expect(Math.abs(pencilBox!.y + pencilBox!.height - (bubble!.y + bubble!.height))).toBeLessThanOrEqual(1);
  expect(Math.min(pencilBox!.width, pencilBox!.height)).toBeGreaterThanOrEqual(44);

  const copy = lastAnswer(page).getByRole("button", { name: "Скопировать ответ" });
  const box = (await copy.boundingBox())!;
  expect(box.height).toBe(32);
  expect(box.width).toBeGreaterThanOrEqual(44);
  // Поле касания — невидимое продолжение кнопки сверху и снизу: вместе с кнопкой не меньше 44 px.
  const touchHeight = await copy.evaluate((element) => parseFloat(getComputedStyle(element, "::after").height));
  expect(touchHeight).toBeGreaterThanOrEqual(44);
  // И его ничто не перекрывает. Браузер округляет точку касания до целого пикселя — пробуем на 5 px за видимым краем.
  const centerX = box.x + box.width / 2;
  expect(await hits(page, copy, centerX, box.y - 5)).toBe(true);
  expect(await hits(page, copy, centerX, box.y + box.height + 5)).toBe(true);

  const group = lastAnswer(page).getByRole("button", { name: "Просмотр работы: готово, 4 раза" });
  await group.tap();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await group.tap();

  await page.evaluate(() => window.scrollTo(0, 0));
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, shots, `phone-${theme}`);
  }
});
