import { expect, test } from "@playwright/test";
import { send, signIn } from "./support/chat";
import { saveScreenshot, screenshotFolder } from "./support/screen";

const screenshotDir = screenshotFolder("agent-chat-e2e");

/*
 * Фича 106: значки шагов и заголовки раздумий. Один сценарий: у Бориса включены `thoughtTitles` (у Анны — нет, её
 * тесты видят «Думал N сек»). Первое раздумье — с заголовком провайдера, второе пересказывает модель заголовков
 * (заглушка). Логика — тесты ядра и react; тёмная тема — снимком, телефон — thought-titles-phone.spec.ts.
 */

test("значки шагов и заголовки раздумий: простой и подробный вид, тёмная тема", async ({ page }) => {
  await signIn(page, "Борис");
  await page.getByRole("button", { name: "Простой вид" }).click();
  await send(page, "Сделай игру крестики-нолики");
  const answer = page.locator("[data-status]").first();
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Игра готова");

  const toggle = answer.getByRole("button", { name: /Сделан 1 шаг/ });
  await expect(toggle.locator("[data-step-icon]")).toHaveCount(3);
  expect(await toggle.locator("[data-step-icon]").evaluateAll((icons) => icons.map((icon) => icon.getAttribute("data-step-icon")))).toEqual(["thinking", "task", "thinking"]);
  await toggle.click();
  await expect(answer.locator("[data-work-step]")).toHaveText(["Продумываю правила игры", "Узнал время в Москве", "Собираю поле и ходы"]);
  await saveScreenshot(page, screenshotDir, "106-thought-titles-light");

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await saveScreenshot(page, screenshotDir, "106-thought-titles-dark");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Подробный вид: те же заголовки вместо «Думал N сек», после перезагрузки — на месте.
  await page.getByRole("button", { name: "Простой вид" }).click();
  await expect(answer.getByRole("button", { name: "Продумываю правила игры" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Простой вид" }).waitFor();
  await expect(page.locator("[data-status]").first().getByRole("button", { name: "Собираю поле и ходы" })).toBeVisible();
});
