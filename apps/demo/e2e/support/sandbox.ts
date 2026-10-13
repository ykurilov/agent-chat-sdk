import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Входит администратором (Анна) и открывает песочницу. Список песочных чатов один на админа, поэтому тесты песочницы
 * идут на своём сервере (support/own-server.ts): на свежем сервере открывается новый пустой чат.
 */
export async function signInToSandbox(page: Page, origin = "") {
  await page.context().addCookies([{ name: "demo-user", value: "anna", domain: "localhost", path: "/" }]);
  await page.goto(`${origin}/sandbox`);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
}
