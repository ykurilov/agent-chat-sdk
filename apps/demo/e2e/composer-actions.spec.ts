import { expect, test } from "@playwright/test";
import { lastAnswer, signIn } from "./support/chat";

/* Своя кнопка приложения у поля ввода (фича 029, US8): нажатие отправляет сообщение. Только компьютер; телефон — composer-actions-phone. */

test("«Проверить работу» у поля отправляет сообщение в чат", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Проверить работу" }).click();

  await expect(page.getByRole("log").getByText("Проверь мою работу")).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("button", { name: "Проверить работу" })).toBeEnabled();
});
