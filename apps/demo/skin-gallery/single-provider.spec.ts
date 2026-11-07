import { test, expect } from "@playwright/test";
for (const theme of ["light", "dark"]) for (const width of [390, 1100]) test(`providers ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/single-provider.html?theme=${theme}`);
  await page.getByRole("button", { name: /Модель:/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Все модели через WildWest", { exact: true })).toHaveCount(1);
  await expect(dialog.locator(".oduvanchik-model-option")).toHaveCount(11);
  await expect(dialog.locator(".oduvanchik-model-tags .oduvanchik-tag")).toHaveCount(6);
  await expect(dialog.locator(".oduvanchik-via")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`single-${theme}-${width}.png`), fullPage: true });
  await dialog.getByRole("button", { name: "Модель 4", exact: true }).click();
  await expect(page.getByRole("button", { name: "Модель: Модель 4", exact: true })).toBeVisible();
  await page.goto(`/single-provider.html?theme=${theme}&multi=1`);
  await page.getByRole("button", { name: /Модель:/ }).click();
  await expect(page.getByRole("group", { name: "Через", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Другой", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-current", "other");
});
