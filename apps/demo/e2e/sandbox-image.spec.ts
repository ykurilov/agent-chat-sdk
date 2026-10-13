import { expect, test } from "./support/own-server";
import { lastAnswer, send } from "./support/chat";
import { signInToSandbox } from "./support/sandbox";

/** Картинка агента в песочнице: заказ идёт у песочного владельца (поддельный Runware демо), миниатюра открывается в окне просмотра. */

test("песочница: картинка агента создаётся и открывается", async ({ page }) => {
  await signInToSandbox(page);
  await send(page, "Нарисуй картинку");
  await expect(page.locator('[data-tile="ready"]')).toHaveCount(1);
  await expect(lastAnswer(page)).toContainText("Создано 1 из 1.");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  await page.locator('[data-tile="ready"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("img").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
