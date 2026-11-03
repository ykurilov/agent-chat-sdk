import { expect, test } from "@playwright/test";
import { signIn } from "./support/chat";
import { saveScreenshot, screenshotFolder } from "./support/screen";

for (const theme of ["light", "dark"] as const) {
  test(`Одуванчик: выбранный чат серый, наведение и тема ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page, "Анна", "/", "default");
    const response = await page.request.post("/api/chat");
    expect(response.status()).toBe(201);
    const { id } = await response.json() as { id: string };
    await page.reload();
    await page.evaluate(theme => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.dataset.theme = theme;
    }, theme);
    const token = (name: string) => page.evaluate(name => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = `var(${name})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    }, name);
    const surface3 = await token("--yk-surface-3"), surface2 = await token("--yk-surface-2"), text = await token("--yk-text");
    const current = page.locator('[data-chat-id] button[aria-current="true"]');
    await expect(current).toHaveCount(1);
    const selectedRow = current.locator("..");
    const background = () => selectedRow.evaluate(e => getComputedStyle(e).backgroundColor);
    await expect.poll(background).toBe(surface3);
    await expect.poll(() => current.evaluate(e => getComputedStyle(e).color)).toBe(text);
    await current.hover();
    await expect.poll(background).toBe(surface3);
    const other = page.locator(`[data-chat-id="${id}"] > div`);
    await other.hover();
    await expect.poll(() => other.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(surface2);
    await saveScreenshot(page, screenshotFolder("neutral-navigation"), `sdk-chat-list-${theme}`);
  });
}
