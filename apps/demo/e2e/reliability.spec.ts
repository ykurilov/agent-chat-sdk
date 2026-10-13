import type { Page } from "@playwright/test";
import { expect, test } from "./support/own-server";
import { lastAnswer, send } from "./support/chat";

/*
 * Надёжность хода (фича 022, US1, US2 и US7) на странице с панелью: там есть инструменты задач и браузерный инструмент,
 * который не отвечает. Один сценарий на требование; тонкости — юнит-тесты службы.
 * У теста свой сервер и свой человек: список задач и чатов не смешивается с соседними тестами.
 */

async function openPanelAs(page: Page, user: "anna" | "boris") {
  await page.context().addCookies([{ name: "demo-user", value: user, domain: "localhost", path: "/" }]);
  await page.goto("/panel-app");
  await expect(page.getByRole("heading", { name: "Задачи" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть агента" }).first().click();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeFocused();
}

test("«Стоп» во время инструмента: следующее сообщение получает ответ (US1)", async ({ page }) => {
  await openPanelAs(page, "boris");

  // Страница не отвечает на вызов: инструмент выполняется, пока его не остановят.
  await send(page, "Зависни");
  const stopped = lastAnswer(page);
  await expect(stopped.getByRole("button", { name: "freeze_page: выполняется" })).toBeVisible();
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(stopped).toHaveAttribute("data-status", "stopped");

  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
});

test("«Повторить» продолжает оборванный ход: две задачи не создаются заново, всего их три (US2, SC-002)", async ({ page }) => {
  await openPanelAs(page, "anna");
  const tasks = page.getByRole("link", { name: /Покупки \d/ });
  const done = (scope: ReturnType<typeof lastAnswer>) => scope.getByRole("button", { name: "create_task: готово" });

  // Провайдер обрывает ход перед третьей задачей.
  await send(page, "Создай три задачи Покупки");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "error");
  await expect(done(lastAnswer(page))).toHaveCount(2);
  await expect(tasks).toHaveCount(2);

  // Новый ответ сразу начинается с двух выполненных вызовов, затем модель делает третий.
  await page.getByRole("button", { name: "Повторить" }).click();
  const continued = lastAnswer(page);
  await expect(done(continued)).toHaveCount(2);
  await expect(done(continued)).toHaveCount(3);
  await expect(continued).toHaveAttribute("data-status", "complete");
  await expect(continued).toContainText("Создал три задачи «Покупки».");
  await expect(tasks).toHaveCount(3);
  await page.reload();
  await expect(tasks).toHaveCount(3);

  // Оборванный вариант остаётся соседним, как был (панель после перезагрузки открыта).
  await expect(page.getByRole("group", { name: "Вариант 2 из 2" })).toBeVisible();
  await page.getByRole("button", { name: "Предыдущий вариант" }).click();
  await expect(page.getByRole("group", { name: "Вариант 1 из 2" })).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "error");
  await expect(done(lastAnswer(page))).toHaveCount(2);
});

test("«Переделать ответ» у оборванного хода пишет с чистого листа: прежние вызовы не переносятся", async ({ page }) => {
  await openPanelAs(page, "anna");
  const tasks = page.getByRole("link", { name: /Склад \d/ });
  const done = (scope: ReturnType<typeof lastAnswer>) => scope.getByRole("button", { name: "create_task: готово" });

  await send(page, "Создай три задачи Склад");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "error");
  await expect(tasks).toHaveCount(2);

  // Рядом с «Повторить» (продолжение) — «Переделать ответ»: новый ответ начинается с первого шага, вызовы — заново.
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  const regenerated = page.waitForRequest((request) => request.url().endsWith("/regenerate") && request.method() === "POST");
  await page.getByRole("button", { name: "Переделать ответ" }).click();
  await regenerated;
  await expect(page.getByRole("group", { name: "Вариант 2 из 2" })).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "error");
  await expect(done(lastAnswer(page))).toHaveCount(2);
  await expect(tasks).toHaveCount(4);
});

test("обрыв посреди ответа: ответ дописан в том же сообщении, без ошибки и «Повторить» (US7)", async ({ page }) => {
  await openPanelAs(page, "anna");
  const errorNotice = page.locator("[data-error-kind]");

  // Провайдер рвёт поток посреди текста; через паузу около 2 с ядро продолжает ответ само.
  await send(page, "Оборвись посреди ответа");
  const answer = lastAnswer(page);
  await expect(answer).toContainText("Начало ответа пишется по кусочкам,");
  await expect(errorNotice).toHaveCount(0);
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 15_000 });
  await expect(answer).toContainText("а конец дописан после обрыва.");
  await expect(answer.getByText("Начало ответа пишется по кусочкам,")).toHaveCount(1);
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(errorNotice).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
});
