import { expect, test } from "@playwright/test";
import { signIn } from "./support/chat";

/** Песочница только для админов: остальным страница «не найдена», а API отвечает 404 на любом адресе. */

test("не админ: страницы песочницы нет, API отвечает 404", async ({ page }) => {
  await signIn(page, "Борис");
  await page.goto("/sandbox");
  await expect(page.getByRole("heading", { name: "Чат не найден" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveCount(0);

  for (const path of ["/api/sandbox", "/api/sandbox/chats/any", "/api/sandbox/chats/any/journal"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  expect((await page.request.post("/api/sandbox")).status()).toBe(404);
});
