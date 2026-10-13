import { expect, test } from "./support/own-server";
import { chooseModel, lastAnswer, modelButton, send, signIn } from "./support/chat";

/*
 * Третья фича, User Story 3 (FR-011, FR-012): смена модели посреди чата. Рассуждения прежней модели остаются
 * на экране и после перезагрузки; что они не уходят новой модели, проверено модульными тестами ядра.
 *
 * Свой сервер на тест: выбор модели запоминается за человеком (фича 015), общий сервер передал бы его соседним
 * тестам, которые входят тем же демо-пользователем и ждут выбор по умолчанию.
 */

test("после смены модели прежний ответ с рассуждением на месте, следующий ответ идёт от новой пары", async ({ page }) => {
  await signIn(page);
  await send(page, "Привет");
  const answers = page.locator("[data-status]");
  const first = answers.nth(0);
  await expect(first).toHaveAttribute("data-status", "complete");

  await chooseModel(page, "Fireworks", "GLM 5.3 Flash");
  await send(page, "Кто отвечает?");
  await expect(answers).toHaveCount(2);
  const second = answers.nth(1);
  await expect(second).toContainText("Отвечает fireworks: accounts/fireworks/models/glm-5p3-flash");

  for (const answer of [first, second]) {
    const reasoning = answer.getByRole("button", { name: /Думал \d+ сек/ });
    await reasoning.click();
    await expect(answer.getByText(/Разбираю вопрос|Смотрю, кто я/)).toBeVisible();
  }

  await page.reload();
  await expect(answers).toHaveCount(2);
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");
  await answers.nth(0).getByRole("button", { name: /Думал \d+ сек/ }).click();
  await expect(answers.nth(0).getByText("Разбираю вопрос")).toBeVisible();
});

test("смена модели во время ответа: идущий ответ дописывает прежняя модель, выбор уже новый", async ({ page }) => {
  await signIn(page);
  await send(page, "Дай длинный ответ");
  const answer = lastAnswer(page);
  await expect(answer).toContainText("Абзац 2:");

  await chooseModel(page, "OpenRouter", "GPT 6 Luna");
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GPT 6 Luna, OpenRouter");

  const before = (await answer.innerText()).length;
  await expect.poll(async () => (await answer.innerText()).length).toBeGreaterThan(before);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(answer.getByText("Остановлено")).toBeVisible();

  await send(page, "Кто отвечает?");
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(lastAnswer(page)).toContainText("Отвечает openrouter: openai/gpt-6-luna");
});
