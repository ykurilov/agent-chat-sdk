import { expect, test } from "@playwright/test";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";

/* Фича 011: опасное действие ждёт решения человека; ответ агента при этом остаётся на сервере. */

const ask = "Очисти заметки в старой папке";
// Пометка решения в строке вызова. Такой же текст лежит в невидимой области для читалки (data-approval-outcome), её здесь не считаем.
const mark = (scope: import("@playwright/test").Locator | import("@playwright/test").Page, text: string) =>
  scope.locator("[data-tool-state] span", { hasText: new RegExp(`^${text}$`) });
const card = (page: import("@playwright/test").Page) => page.getByText("Агент хочет: Очистить заметки");

test("«Разрешить»: карточка с названием и данными, действие выполняется, ответ дописывается в то же сообщение", async ({ page }) => {
  await signIn(page);
  await send(page, ask);

  await expect(card(page)).toBeVisible();
  await expect(page.getByText("старое")).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "awaiting_approval");
  // Ход стоит, но поле ввода свободно: человек может написать, не отвечая на карточку.
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);

  await page.getByRole("button", { name: "Разрешить", exact: true }).click();
  const answer = lastAnswer(page);
  await expect(answer).toContainText("Заметки очищены.");
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(answer.getByRole("button", { name: "clear_notes: готово" })).toBeVisible();
  await expect(mark(answer, "Разрешено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(lastAnswer(page)).toContainText("Заметки очищены.");
  await expect(mark(lastAnswer(page), "Разрешено")).toBeVisible();
});

test("«Отклонить»: действие не выполняется, модель это знает и отвечает", async ({ page }) => {
  await signIn(page);
  await send(page, ask);
  await expect(card(page)).toBeVisible();

  await page.getByRole("button", { name: "Отклонить", exact: true }).click();
  const answer = lastAnswer(page);
  await expect(answer).toContainText("Хорошо, заметки не трогаю.");
  await expect(mark(answer, "Отклонено")).toBeVisible();
  await expect(answer).not.toContainText("Заметки очищены.");
});

test("«Всегда в этом чате»: следующий такой вызов в этом чате идёт без вопроса, в новом чате — снова с вопросом", async ({ page }) => {
  await signIn(page);
  await send(page, ask);
  await expect(card(page)).toBeVisible();
  await page.getByRole("button", { name: "Всегда в этом чате", exact: true }).click();
  await expect(lastAnswer(page)).toContainText("Заметки очищены.");
  await expect(mark(lastAnswer(page), "Разрешено в этом чате")).toBeVisible();

  await send(page, ask);
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(lastAnswer(page)).toContainText("Заметки очищены.");
  await expect(page.getByRole("button", { name: "Разрешить", exact: true })).toHaveCount(0);

  // Новый чат создаётся заранее и открывается по адресу, как в signIn: кнопка «Новый чат» открывает уже готовый пустой чат
  // пользователя, а на общем сервере им может оказаться чат соседнего теста, где уже идёт ход («занято»).
  const firstChat = chatIdOf(page);
  const created = await page.request.post("/api/chat");
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/?chat=${id}`);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  expect(chatIdOf(page)).not.toBe(firstChat);
  await expect(page.locator("[data-status]")).toHaveCount(0);
  await send(page, ask);
  await expect(card(page)).toBeVisible();
});

test("страница перезагружена, пока действие ждёт решения: карточка на месте, решение принимается", async ({ page }) => {
  await signIn(page);
  await send(page, ask);
  await expect(card(page)).toBeVisible();

  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "awaiting_approval");

  await page.getByRole("button", { name: "Разрешить", exact: true }).click();
  await expect(lastAnswer(page)).toContainText("Заметки очищены.");
});

test("решение из другой вкладки: вторая вкладка открывает чат с карточкой, отвечает, первая после перезагрузки видит итог", async ({
  page,
  context,
}) => {
  await signIn(page);
  await send(page, ask);
  await expect(card(page)).toBeVisible();

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(card(other)).toBeVisible();
  await other.getByRole("button", { name: "Разрешить", exact: true }).click();
  await expect(lastAnswer(other)).toContainText("Заметки очищены.");

  await page.reload();
  await expect(lastAnswer(page)).toContainText("Заметки очищены.");
  await expect(page.getByRole("button", { name: "Разрешить", exact: true })).toHaveCount(0);
});

test("новое сообщение вместо ответа на карточку: действие считается отклонённым, ход не блокируется", async ({ page }) => {
  await signIn(page);
  await send(page, ask);
  await expect(card(page)).toBeVisible();

  await send(page, "Лучше расскажи коротко про время в Токио и Москве");
  await expect(page.getByRole("button", { name: "Разрешить", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(mark(page.locator("[data-status]").first(), "Отклонено")).toBeVisible();
  await expect(lastAnswer(page)).toContainText("Разница между Токио и Москвой");

  await page.reload();
  await expect(mark(page.locator("[data-status]").first(), "Отклонено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить", exact: true })).toHaveCount(0);
});
