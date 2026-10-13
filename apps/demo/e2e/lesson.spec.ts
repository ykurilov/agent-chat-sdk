import { expect, test } from "@playwright/test";
import { lastAnswer } from "./support/chat";

/* Чат урока (чат объекта): первым пишет агент, у человека один чат на урок. Только компьютер. */

const greeting = "Здравствуйте! Сегодня разбираем дроби.";

test("урок: приветствие агента, ответ на вопрос; повторное открытие — тот же чат с одним приветствием", async ({ page }) => {
  await page.context().addCookies([{ name: "demo-user", value: "anna", domain: "localhost", path: "/" }]);
  await page.goto("/lesson");
  const feed = page.getByRole("log");
  await expect(feed.getByText(greeting)).toBeVisible();

  // Повтор теста на той же базе открывает тот же чат урока: своё сообщение у каждого прогона.
  const question = `Готов, давайте пример ${crypto.randomUUID().slice(0, 8)}`;
  // Чат с прошлой перепиской открывается дольше: Enter до готовности оставил бы текст в поле.
  await page.getByRole("textbox", { name: "Сообщение" }).fill(question);
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Сообщение" }).press("Enter");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(feed.getByText(question)).toHaveCount(1);

  await page.reload();
  await expect(feed.getByText(question)).toHaveCount(1);
  await expect(feed.getByText(greeting)).toHaveCount(1);
});

test("урок: зачёт в чате урока — плашка с ключом урока из итога хода", async ({ page }) => {
  // Свой человек: у каждого один чат урока, а первый тест в нём же пишет параллельно.
  await page.context().addCookies([{ name: "demo-user", value: "boris", domain: "localhost", path: "/" }]);
  await page.goto("/lesson");
  await expect(page.getByRole("log").getByText(greeting)).toBeVisible();
  await page.getByRole("textbox", { name: "Сообщение" }).fill("Сдаю урок на зачёт");
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Сообщение" }).press("Enter");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer.getByRole("status").filter({ hasText: "Урок зачтён" })).toHaveAttribute("data-lesson", "lesson:demo");
});
