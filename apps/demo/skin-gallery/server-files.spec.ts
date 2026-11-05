import { expect, test } from "@playwright/test";
for (const theme of ["light", "dark"]) test(`server files and custom menu on 375px (${theme})`, async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/server-files.html?theme=${theme}`);
  await page.getByRole("button", { name: "Открыть стенд" }).click();
  await expect(page.locator("[data-field-ready]")).toHaveAttribute("data-field-ready", "true");
  await page.getByRole("button", { name: "Файл", exact: true }).click();
  await expect(page.locator(".oduvanchik-add-menu button")).toHaveText(["Мои загрузки", "С компьютера"]);
  const rect = await page.locator(".oduvanchik-add-menu").boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: info.outputPath(`menu-${theme}.png`) });
  await page.getByRole("button", { name: "Мои загрузки" }).click();
  await expect(page.locator(".oduvanchik-field-files")).toContainText("library.png");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate("window.attachmentStats.ingests")).toBe(1);
  await page.getByRole("button", { name: "Завершить ingest" }).click();
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`ready-${theme}.png`) });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => page.evaluate("window.attachmentStats.posts.length")).toBe(1);
  expect(JSON.stringify(await page.evaluate("window.attachmentStats.posts"))).toContain("attachment:server-file");
  expect(await page.evaluate("window.attachmentStats.uploads")).toBe(0);
  await expect(page.locator(".oduvanchik-field-files")).toHaveCount(0);
  // A custom drop on the actual textarea reaches the panel ancestor, without an OS file.
  const field = page.getByRole("textbox", { name: "Сообщение", exact: true });
  await expect(page.locator("[data-field-ready]")).toHaveAttribute("data-field-ready", "true");
  await field.evaluate((element) => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [], types: ["application/x-ykcreator-result"] } });
    element.dispatchEvent(event);
  });
  await expect.poll(() => page.evaluate("window.attachmentStats.customDrops")).toBe(1);
  await expect.poll(() => page.evaluate("window.attachmentStats.ingests")).toBe(2);
  expect(errors).toEqual([]);
});
