import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Фича 024: агент задаёт вопрос виджетом, человек отвечает нажатием, ответ идёт в тот же ход.
 * Один сценарий подряд: чат у теста свой, повторов на других экранах нет (телефон — widgets-phone.spec.ts).
 */

const tariffQuestion = "Какой тариф выберете?";
const tariffGroup = (scope: Page | Locator) => scope.getByRole("radiogroup", { name: tariffQuestion });
const option = (scope: Page | Locator, name: string) => scope.getByRole("radio", { name, exact: true });

test("виджеты: ответ нажатием, перезагрузка, ответ сообщением, форма с клавиатуры, подсказка, свой виджет", async ({ page }) => {
  await signIn(page);

  // Выбор: одно нажатие отвечает, агент продолжает в том же ответе.
  await send(page, "Спроси тариф");
  await expect(tariffGroup(page)).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "awaiting_approval");
  await option(page, "Про").click();
  await expect(lastAnswer(page)).toContainText("Выбран тариф «Про».");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(option(page, "Про")).toHaveAttribute("aria-checked", "true");
  await expect(option(page, "Про")).toHaveAttribute("aria-disabled", "true");

  // Перезагрузка (SC-002): виджет отвечен и не нажимается.
  await page.reload();
  await expect(lastAnswer(page)).toContainText("Выбран тариф «Про».");
  await expect(option(page, "Про")).toHaveAttribute("aria-checked", "true");
  await expect(option(page, "Базовый")).toHaveAttribute("aria-disabled", "true");
  await option(page, "Базовый").click({ force: true });
  await expect(option(page, "Про")).toHaveAttribute("aria-checked", "true");

  // Новый вопрос, ответ сообщением вместо виджета.
  await send(page, "Спроси тариф");
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(option(lastAnswer(page), "Команда")).not.toHaveAttribute("aria-disabled", "true");
  await send(page, "Лучше расскажи про время в Токио и Москве");
  await expect(page.locator("[data-status]")).toHaveCount(3);
  await expect(lastAnswer(page)).toContainText("Разница между Токио и Москвой");
  const bySecondQuestion = page.locator("[data-status]").nth(1);
  await expect(bySecondQuestion.getByText("Ответ дан сообщением")).toBeVisible();
  await expect(option(bySecondQuestion, "Команда")).toHaveAttribute("aria-disabled", "true");

  // Форма: ответ с клавиатуры, без мыши (SC-007).
  await send(page, "Заполни форму");
  const form = page.getByRole("group", { name: "Контакты" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Имя")).toBeEnabled();
  await form.getByLabel("Имя").focus();
  await page.keyboard.type("Анна");
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Почта")).toBeFocused();
  await page.keyboard.type("anna@example.com");
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Сколько мест")).toBeFocused();
  await page.keyboard.type("3");
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Отправить" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lastAnswer(page)).toContainText("Получил контакты: Анна.");
  await expect(form.getByLabel("Имя")).toHaveValue("Анна");
  await expect(form.getByLabel("Имя")).toBeDisabled();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Подсказка: нажатие отправляет её текст сообщением.
  await send(page, "Подскажи");
  const hint = page.getByRole("button", { name: "Что там с временем в Токио?" });
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(page.getByRole("log").getByText("Что там с временем в Токио?")).toBeVisible();
  await expect(lastAnswer(page)).toContainText("Разница между Токио и Москвой");
  await expect(hint).toHaveCount(0);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Свой виджет приложения.
  await send(page, "Выбери время");
  const slots = page.getByRole("group", { name: "Время встречи" });
  await expect(slots).toBeVisible();
  await slots.getByRole("button", { name: "12:30" }).click();
  await expect(lastAnswer(page)).toContainText("Записал на 12:30.");
  await expect(slots.getByRole("button", { name: "12:30" })).toBeDisabled();
});

test("«спроси дважды»: виден один вопрос, второй не показан", async ({ page }) => {
  await signIn(page);
  await send(page, "Спроси дважды");
  await expect(tariffGroup(page)).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(1);
  await option(page, "Базовый").click();
  await expect(lastAnswer(page)).toContainText("Спросил один вопрос, выбран тариф «Базовый».");
  await expect(page.getByRole("radiogroup")).toHaveCount(1);
});
