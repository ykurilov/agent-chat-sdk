import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Первая фича, User Story 1 (FR-001, FR-002, FR-004–FR-006): сообщение, растущий ответ, рассуждения,
 * таблица и код, копирование. «Стоп» и восстановление после обновления — в us3-resume.spec.ts.
 */

test("сообщение сразу в ленте, ответ растёт, рассуждения свёрнуты и раскрываются", async ({ page }) => {
  await signIn(page);
  await send(page, "Привет");
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toBeVisible();

  const answer = lastAnswer(page);
  await expect(answer).toContainText("Привет!");
  const early = (await answer.innerText()).length;
  await expect.poll(async () => (await answer.innerText()).length).toBeGreaterThan(early);

  await expect(answer).toHaveAttribute("data-status", "complete");
  const reasoning = answer.getByRole("button", { name: /Думал \d+ сек/ });
  await expect(reasoning).toHaveAttribute("aria-expanded", "false");
  await expect(answer.getByText("Разбираю вопрос")).toHaveCount(0);
  await reasoning.click();
  await expect(reasoning).toHaveAttribute("aria-expanded", "true");
  await expect(answer.getByText("Разбираю вопрос и прикидываю, как ответить понятнее.")).toBeVisible();
});

test("таблица и код отформатированы, копирование ответа и кода работает", async ({ page }) => {
  await signIn(page);
  await send(page, "Покажи таблицу и код");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");

  await expect(answer.locator("table")).toBeVisible();
  await expect(answer.locator("th").first()).toHaveText("Город");
  await expect(answer.locator("pre code")).toContainText("const sum");

  await answer.getByRole("button", { name: "Скопировать код" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("const sum");

  await answer.getByRole("button", { name: "Скопировать ответ" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("| Москва | 12:00 |");
  expect(copied).toContain("Спрашивайте ещё.");
});
