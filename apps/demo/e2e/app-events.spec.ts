import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/* Итог хода и события приложения (фича 029, US2): хук демо на «зачёт» добавляет `lesson_passed`, страница рисует плашку. */

test("плашка «Урок зачтён» видна живьём и остаётся после перезагрузки", async ({ page }) => {
  await signIn(page);
  await send(page, "Сдаю урок на зачёт");

  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer.getByRole("status").filter({ hasText: "Урок зачтён" })).toBeVisible();

  await page.reload();
  const reloaded = lastAnswer(page);
  await expect(reloaded).toContainText("Работа принята: зачёт.");
  await expect(reloaded.getByRole("status").filter({ hasText: "Урок зачтён" })).toBeVisible();
});
