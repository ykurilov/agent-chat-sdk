import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectNoHorizontalOverflow, saveScreenshot } from "./support/screen";

/*
 * Фича 050: простой вид на узком экране (320 px) — только вёрстка и снимок. Логика — simple-work-view.spec.ts. Кнопки
 * простого вида на телефоне в шапке стенда нет (не помещается): вид включается записью в `localStorage`.
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: живая строка, длинная фраза и раскрытые шаги в экране, страница не шире экрана", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-simple-work-view", "on"));
  await signIn(page);
  await send(page, "Запусти долгую проверку");
  await expect(lastAnswer(page).locator("[data-work-live]")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveScreenshot(page, "/tmp/agent-chat-themes", "simple-work-view-live-phone");

  const checked = page.locator("[data-status]").first();
  await expect(checked).toHaveAttribute("data-status", "complete");
  // Длинная фраза шага переносится внутри пузыря.
  await checked.getByRole("button", { name: "Сделан 1 шаг" }).tap();
  const longStep = checked.locator("[data-work-step]");
  const [stepBox, bubbleBox] = [await longStep.boundingBox(), await checked.boundingBox()];
  expect(stepBox!.x + stepBox!.width).toBeLessThanOrEqual(bubbleBox!.x + bubbleBox!.width);
  await send(page, "Сколько времени в Токио и в Москве и какая разница?");
  const answer = page.locator("[data-status]").nth(1);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await answer.getByRole("button", { name: "Сделано 2 шага" }).tap();
  await expect(answer.locator("[data-work-step]")).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await saveScreenshot(page, "/tmp/agent-chat-themes", "simple-work-view-done-phone");
});
