import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Фича 043: блок ```html-demo в ответе запускается в изолированной рамке. Один сценарий подряд: чат у теста свой;
 * телефон — live-demos-phone.spec.ts, темы — themes.spec.ts.
 */

test("демонстрация: плашка при печати, рамка во всю ширину, ползунок и кнопка меняют текст, после перезагрузки снова работает", async ({ page }) => {
  await signIn(page);
  await send(page, "Покажи демонстрацию");

  // Пока блок дописывается — плашка; запускается только закрытый блок.
  await expect(page.locator('[data-live-demo="streaming"]')).toContainText("Готовлю демонстрацию…");
  const ready = page.locator('[data-live-demo="ready"]');
  await expect(ready).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Рамка без доступа к странице: только скрипты.
  const iframe = ready.locator("iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");

  // Ширина — во весь ответ (колонка ответа без аватара и отступов пузыря); высота пришла от самой демонстрации.
  const answerBox = (await lastAnswer(page).boundingBox())!;
  const frameBox = (await iframe.boundingBox())!;
  expect(frameBox.width).toBeGreaterThan(answerBox.width * 0.8);
  await expect.poll(async () => (await iframe.boundingBox())!.height).not.toBe(160);

  const demo = page.frameLocator('[data-live-demo="ready"] iframe').frameLocator("iframe");
  await expect(demo.locator("#value")).toHaveText("Скорость: 40");
  await demo.locator("#speed").fill("75");
  await expect(demo.locator("#value")).toHaveText("Скорость: 75");
  await demo.getByRole("button", { name: "Сбросить" }).click();
  await expect(demo.locator("#value")).toHaveText("Скорость: 0");

  // После перезагрузки демонстрация показывается снова и работает.
  await page.reload();
  await expect(page.locator('[data-live-demo="ready"]')).toBeVisible();
  await demo.locator("#speed").fill("10");
  await expect(demo.locator("#value")).toHaveText("Скорость: 10");
});

test("демонстрация больше 30 КБ: показан код с пометкой, рамки нет", async ({ page }) => {
  await signIn(page);
  await send(page, "Покажи большую демонстрацию");
  const code = page.locator('[data-live-demo="code"]');
  await expect(code).toContainText("Демонстрация слишком большая для запуска, показан её код");
  await expect(code).toContainText("<p>Большая</p>");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.locator("[data-live-demo-frame]")).toHaveCount(0);
});

test("выключатель: после веб-поиска в чате демонстрации показаны кодом с пометкой — и прежняя, и новая, и после перезагрузки", async ({ page }) => {
  const notice = "В этом чате есть текст из интернета или файлов, поэтому демонстрации не запускаются — показан код";
  await signIn(page);
  await send(page, "Покажи демонстрацию");
  await expect(page.locator('[data-live-demo="ready"]')).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Веб-инструменты помечены: сервер шлёт признак сразу после их итога, прежняя демонстрация гаснет.
  await send(page, "Найди в интернете, какая сейчас версия Node.js");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.locator("[data-live-demo-frame]")).toHaveCount(0);
  await expect(page.locator('[data-live-demo="code"]').first()).toContainText(notice);

  await send(page, "Покажи демонстрацию");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.locator('[data-live-demo="code"]')).toHaveCount(2);
  await expect(page.locator("[data-live-demo-frame]")).toHaveCount(0);

  // Признак хранит сервер: после перезагрузки рамок нет.
  await page.reload();
  await expect(page.locator('[data-live-demo="code"]')).toHaveCount(2);
  await expect(page.locator('[data-live-demo="code"]').last()).toContainText(notice);
  await expect(page.locator("[data-live-demo-frame]")).toHaveCount(0);
});
