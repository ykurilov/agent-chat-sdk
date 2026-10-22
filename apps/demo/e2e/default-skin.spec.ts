import { expect, test } from "./support/own-server";
import { signIn, send, lastAnswer } from "./support/chat";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "./support/screen";

// The demo always enables spending UI; provide its optional server endpoint as well.
test.use({ spendingLimitUsd: 10 });

const shots = screenshotFolder("agent-chat-default-oduvanchik");

test("standard entry defaults to Oduvanchik; explicit Tandem remains usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await signIn(page, "Анна", "/", "default");
  expect(new URL(page.url()).searchParams.has("skin")).toBe(false);
  await expect(page.locator(".oduvanchik-field-standard")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--yk-bg").trim())).not.toBe("");
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  await field.fill("Привет");
  await field.press("Shift+Enter");
  await expect(field).toHaveValue("Привет\n");
  await field.press("Enter");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, shots, `default-${theme}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".oduvanchik-chat > aside")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(field).toBeVisible();
  await saveScreenshot(page, shots, "default-phone");
  await signIn(page, "Анна", "/", "tandem");
  await expect(page.locator(".oduvanchik-chat")).toHaveCount(0);
  await expect(page.locator(".oduvanchik-field")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--yk-bg").trim())).toBe("");
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  expect(errors).toEqual([]);
});
