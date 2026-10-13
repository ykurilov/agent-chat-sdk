import { expect, test } from "@playwright/test";
import { signIn } from "./support/chat";
import { installFakeDialogMicrophone } from "./support/fake-dialog-microphone";
import { saveScreenshot } from "./support/screen";

/* Телефон, фича 029 (US8): только узкая вёрстка. Кнопка приложения у поля помещается в экран, страница не ползёт вбок; снимок для глаз. */

test("телефон: «Проверить работу» помещается в экран, поле и кнопки не вылезают за край", async ({ page }) => {
  await signIn(page);
  const button = page.getByRole("button", { name: "Проверить работу" });
  await expect(button).toBeVisible();

  const box = (await button.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  // Кнопка «Отправить» не вылезает за рамку поля: её правый край не правее края самого поля ввода.
  const field = (await page.getByRole("textbox", { name: "Сообщение" }).boundingBox())!;
  const submit = (await page.getByRole("button", { name: "Отправить" }).boundingBox())!;
  expect(submit.x + submit.width).toBeLessThanOrEqual(field.x + field.width + 1);
  // Кнопка приложения не налезает на «Отправить»: целиком левее неё.
  expect(box.x + box.width).toBeLessThanOrEqual(submit.x + 1);
  expect(box.height).toBeGreaterThanOrEqual(32);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await saveScreenshot(page, "/tmp/agent-chat-029-e6", "composer-actions-phone");
});

test("телефон, голосовой режим: длинная подпись кнопки не выталкивает панель режима и «Стоп» за экран", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);
  // Худший случай: приложение дало длинную подпись и на телефоне.
  await page.getByRole("button", { name: "Проверить работу" }).evaluate((button) => {
    const label = button.querySelector("span")!;
    label.className = "";
    label.textContent = "Проверить работу над домашним заданием";
  });
  await page.getByRole("button", { name: "Голосовой режим" }).tap();
  const leave = page.getByRole("button", { name: "Выйти", exact: true });
  await expect(leave).toBeVisible();

  const width = page.viewportSize()!.width;
  const action = (await page.getByRole("button", { name: "Проверить работу" }).boundingBox())!;
  expect(action.x).toBeGreaterThanOrEqual(0);
  expect(action.x + action.width).toBeLessThanOrEqual(width);
  const exit = (await leave.boundingBox())!;
  expect(exit.x + exit.width).toBeLessThanOrEqual(width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
