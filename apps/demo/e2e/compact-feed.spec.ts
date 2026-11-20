import { expect, test } from "@playwright/test";
import { lastAnswer, signIn } from "./support/chat";
import { finished, started, wakeAfterGenerations } from "./support/compact-feed";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Компактная лента (договор скина 37), сценарий — на компьютере, скин по умолчанию («Одуванчик»). Приложение будит агента
 * невидимым служебным сообщением: новый ответ — продолжение прошлого, «Скопировать ответ» последнего копирует оба. Четыре
 * одинаковых шага — одна строка «×4», раскрывается с клавиатуры. Вёрстка телефона — compact-feed-phone.spec.ts.
 */

const shots = screenshotFolder("agent-chat-compact-feed");
test("ответ после невидимого касания приложения — продолжение прошлого; одинаковые шаги — одна строка ×4", async ({ page }) => {
  await signIn(page, "Анна", "/", "default");
  await wakeAfterGenerations(page);

  const answers = page.locator("[data-status]");
  await expect(answers).toHaveCount(2);
  const [first, last] = [answers.first(), answers.last()];
  await expect(first).toHaveAttribute("data-continued", "");
  await expect(first.getByRole("button", { name: "Скопировать ответ" })).toHaveCount(0);
  // Промежутка между частями нет: низ прошлой части — низ её текста.
  const [firstBox, textBox] = [await first.boundingBox(), await first.locator(".oduvanchik-agent-body").boundingBox()];
  expect(firstBox!.y + firstBox!.height - (textBox!.y + textBox!.height)).toBeLessThanOrEqual(1);

  const group = last.getByRole("button", { name: "Просмотр работы: готово, 4 раза" });
  await expect(group).toContainText("×4");
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(last.locator("[data-tool-state]")).toHaveCount(1);
  await group.focus();
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(last.locator("[data-tool-state]:not([data-tool-group])")).toHaveCount(4);
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("aria-expanded", "false");

  await last.getByRole("button", { name: "Скопировать ответ" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${started}\n\n${finished}`);

  // Широкий экран: карандаш под пузырём, как раньше.
  const user = page.locator(".oduvanchik-user").first();
  const [bubble, pencil] = [await user.locator("[data-user-text] > div").boundingBox(), await user.getByRole("button", { name: "Изменить сообщение" }).boundingBox()];
  expect(pencil!.y).toBeGreaterThanOrEqual(bubble!.y + bubble!.height);

  await page.mouse.move(0, 0);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, shots, `desktop-${theme}`);
  }
});
