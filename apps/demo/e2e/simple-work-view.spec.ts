import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { send, signIn } from "./support/chat";

/** Отправить и дождаться законченного нового ответа; ответ — по номеру, а не «последний»: дальше придут новые. */
async function ask(page: Page, text: string) {
  const answers = page.locator("[data-status]");
  const index = await answers.count();
  await send(page, text);
  const answer = answers.nth(index);
  await expect(answer).toHaveAttribute("data-status", "complete");
  return answer;
}

/*
 * Фича 050: простой вид работы агента. Один сценарий на компьютере: живая строка, пока ход идёт; после хода — «Сделано
 * N шагов» с понятными фразами; нет мыслей и строк вызовов; ошибка шага — своей фразой; смена вида на лету без
 * перезагрузки. Логика раскладки — в тестах пакета react; тема и телефон — снимками (themes.spec.ts, simple-work-view-phone.spec.ts).
 */

test("простой вид: живая строка, свёрнутые шаги, переключение на лету", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Простой вид" }).click();
  await expect(page.getByRole("button", { name: "Простой вид" })).toHaveAttribute("aria-pressed", "true");

  await send(page, "Запусти долгую проверку");
  const checking = page.locator("[data-status]").first();
  await expect(checking.locator("[data-work-live]")).toContainText("Проверяю макет…");
  await expect(checking).toHaveAttribute("data-status", "complete");
  await expect(checking.locator("[data-work-live]")).toHaveCount(0);
  const checked = checking.getByRole("button", { name: "Сделан 1 шаг" });
  await checked.click();
  await expect(checking.locator("[data-work-step]")).toHaveText(["Проверил макет: кнопки, отступы, шрифты, тёмную тему, узкий экран и подписи на двух языках"]);

  const answer = await ask(page, "Сколько времени в Токио и в Москве и какая разница?");
  await expect(answer).toContainText("Разница между Токио и Москвой — 6 часов.");
  await answer.getByRole("button", { name: "Сделано 2 шага" }).click();
  await expect(answer.locator("[data-work-step]")).toHaveText(["Узнал время в Токио", "Узнал время в Москве"]);
  await expect(answer.locator("[data-tool-state]")).toHaveCount(0);
  await expect(answer.getByRole("button", { name: /Думал/ })).toHaveCount(0);
  await expect(answer).not.toContainText("Asia/Tokyo");

  const failed = await ask(page, "Найди курс через справочную службу");
  await failed.getByRole("button", { name: "Сделан 1 шаг" }).click();
  await expect(failed.locator('[data-work-step][data-failed="true"]')).toHaveText("Справочная не ответила");

  // Подробный вид на лету: те же ответы, строки вызовов на месте, новых запросов к модели нет.
  await page.getByRole("button", { name: "Простой вид" }).click();
  await expect(answer.getByRole("button", { name: "current_time: готово" })).toHaveCount(2);
  await expect(page.locator("[data-work-step]")).toHaveCount(0);
  await page.getByRole("button", { name: "Простой вид" }).click();
  await expect(answer.getByRole("button", { name: "Сделано 2 шага" })).toBeVisible();
});
