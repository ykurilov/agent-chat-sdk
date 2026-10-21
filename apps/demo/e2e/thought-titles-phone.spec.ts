import { expect, test } from "@playwright/test";
import { send, signIn } from "./support/chat";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Фича 106 на узком экране (320 px): ряд значков и список шагов с заголовками раздумий не шире экрана, снимок.
 * Логика — thought-titles.spec.ts. Простой вид на телефоне включается записью в `localStorage`.
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: ряд значков в одну строку, список шагов в экране", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-simple-work-view", "on"));
  await signIn(page, "Борис");
  await send(page, "Сделай игру крестики-нолики");
  const answer = page.locator("[data-status]").first();
  await expect(answer).toHaveAttribute("data-status", "complete");
  const toggle = answer.getByRole("button", { name: /Сделан 1 шаг/ });
  const row = toggle.locator("[data-step-icons]");
  await expect(row.locator("[data-step-icon]")).toHaveCount(3);
  // Ряд в одну строку: высота — как у одного значка.
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(20);
  await toggle.tap();
  await expect(answer.locator("[data-work-step]")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await saveScreenshot(page, screenshotFolder("agent-chat-e2e"), "106-thought-titles-phone");
});
