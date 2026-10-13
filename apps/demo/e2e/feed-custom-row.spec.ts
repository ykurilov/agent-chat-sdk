import { expect, test } from "@playwright/test";
import { FEED_ITEMS_LIMIT, feedItems, openLongChat } from "./support/feed";

/* Фича 002, US1-7 (FR-008): свой ToolCallRow рисуется в окне длинной ленты. Не зависит от экрана: только компьютер. */

test("свой ToolCallRow рисуется в окне ленты", async ({ page }) => {
  await openLongChat(page, 500);

  await page.getByRole("button", { name: "Свой ToolCallRow" }).click();
  await expect(page.locator("[data-feed-item] [data-custom-tool-row]").first()).toBeVisible();
  expect(await feedItems(page).count()).toBeLessThanOrEqual(FEED_ITEMS_LIMIT);
  expect(await page.locator("[data-tool-state]").count(), "строк вызова скина Тандема при своей строке").toBe(0);
});
