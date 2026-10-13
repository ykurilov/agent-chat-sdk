import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/* Первая фича, User Story 2 (FR-010, FR-011): строки вызовов инструментов, падающий инструмент. */

test("два вызова «текущего времени»: «выполняется» → «готово», затем ответ", async ({ page }) => {
  await signIn(page);
  await send(page, "Сколько времени в Токио и в Москве и какая разница?");
  const answer = lastAnswer(page);

  await expect(answer.getByRole("button", { name: "current_time: выполняется" }).first()).toBeVisible();
  const done = answer.getByRole("button", { name: "current_time: готово" });
  await expect(done).toHaveCount(2);
  await expect(answer.getByRole("button", { name: /выполняется/ })).toHaveCount(0);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Разница между Токио и Москвой — 6 часов.");

  // Строки идут до ответа, в порядке вызовов.
  const text = await answer.innerText();
  expect(text.indexOf("current_time: готово")).toBeLessThan(text.indexOf("Разница между"));

  await done.first().click();
  await expect(done.first()).toHaveAttribute("aria-expanded", "true");
  await expect(answer.getByText(/current_time\(\{/).first()).toBeVisible();
  await expect(answer.getByText("Asia/Tokyo", { exact: false }).first()).toBeVisible();
});

test("падающий инструмент — строка «ошибка», ответ продолжается", async ({ page }) => {
  await signIn(page);
  await send(page, "Найди курс через справочную службу");
  const answer = lastAnswer(page);

  const failed = answer.getByRole("button", { name: "broken_lookup: ошибка" });
  await expect(failed).toBeVisible();
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Справочная служба сейчас недоступна");

  await failed.click();
  await expect(answer.getByText("сервис недоступен")).toBeVisible();

  // После обновления страницы строки вызовов на месте.
  await page.reload();
  const restored = lastAnswer(page);
  await expect(restored.getByRole("button", { name: "broken_lookup: ошибка" })).toBeVisible();
  await expect(restored).toContainText("Справочная служба сейчас недоступна");
});
