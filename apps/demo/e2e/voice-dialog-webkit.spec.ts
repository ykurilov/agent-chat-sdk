import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signIn } from "./support/chat";
import { audioContextStates, installFakeDialogMicrophone } from "./support/fake-dialog-microphone";

/*
 * Фича 016, Safari (WebKit): только то, в чём браузеры различаются. Звук разблокируется внутри нажатия, а не позже;
 * страница, ушедшая в фон, выключает режим. Остальное (сценарий, вёрстка) — в Chromium.
 */

const start = (page: Page) => page.getByRole("button", { name: "Голосовой режим" });
const panel = (page: Page) => page.locator("[data-state]").filter({ has: page.getByRole("status") }).first();

test("звук разблокирован нажатием: контекст идёт, режим слушает", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);

  await start(page).tap();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");
  await expect.poll(() => audioContextStates(page)).toContain("running");
});

test("страница ушла в фон: режим выключается с понятной надписью, микрофон отпущен", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);
  await start(page).tap();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.getByRole("alert")).toHaveText("Режим выключен: страница ушла в фон");
  await page.getByRole("button", { name: "Выйти", exact: true }).tap();
  await expect(start(page)).toBeVisible();
});
