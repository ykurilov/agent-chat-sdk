import { expect, test } from "./support/own-server";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";
import { chatRowButton, chatRows, chooseInRowMenu, newChatButton, openedRow, renameChat } from "./support/chat-list";

/*
 * У каждого теста свой сервер: список чатов один на пользователя, общий сервер смешал бы чаты соседних тестов.
 * Список чатов (фича 010) на компьютере: создать, названия по первому сообщению, переключиться, переименовать,
 * удалить, вернуться после перезагрузки, чужие чаты недоступны. Узкий экран — chat-list-phone.spec.ts.
 */

test("создать, назвать по первому сообщению, переключиться, переименовать, удалить", async ({ page }) => {
  await signIn(page);
  // Вход открыл пустой чат: в списке одна строка.
  await expect(chatRows(page)).toHaveCount(1);
  await expect(openedRow(page)).toHaveText("Новый чат");
  const firstId = chatIdOf(page);

  // Первое сообщение называет чат.
  await send(page, "Расскажи про Грецию");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(chatRowButton(page, "Расскажи про Грецию")).toBeVisible();

  // «Новый чат» — новый пустой чат наверху списка; адрес сменился.
  await newChatButton(page).click();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  await expect(page.locator("[data-status]")).toHaveCount(0);
  await expect(chatRows(page)).toHaveCount(2);
  expect(chatIdOf(page)).not.toBe(firstId);
  const secondId = chatIdOf(page);

  // Второй пустой чат не плодится: «Новый чат» открывает уже созданный пустой.
  await newChatButton(page).click();
  await expect(chatRows(page)).toHaveCount(2);
  expect(chatIdOf(page)).toBe(secondId);

  await send(page, "Как платить налоги");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(chatRowButton(page, "Как платить налоги")).toBeVisible();
  // Недавний чат выше.
  await expect(chatRows(page).first()).toContainText("Как платить налоги");

  // Переключение: открылась переписка первого чата, адрес сменился.
  await chatRowButton(page, "Расскажи про Грецию").click();
  await expect(page.getByText("Расскажи про Грецию", { exact: false }).first()).toBeVisible();
  await expect(openedRow(page)).toHaveText("Расскажи про Грецию");
  expect(chatIdOf(page)).toBe(firstId);

  // Переименование: название в списке и после перезагрузки. Порядок списка не меняется.
  await renameChat(page, "Расскажи про Грецию", "Отпуск");
  await expect(chatRows(page).first()).toContainText("Как платить налоги");
  await page.reload();
  await expect(chatRowButton(page, "Отпуск")).toBeVisible();

  // Удаление: «Отмена» ничего не трогает.
  await chooseInRowMenu(page, "Отпуск", "Удалить");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("«Отпуск»");
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chatRowButton(page, "Отпуск")).toBeVisible();

  // Подтверждение: чат исчез из списка и с сервера, открылся соседний.
  await chooseInRowMenu(page, "Отпуск", "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(chatRowButton(page, "Отпуск")).toHaveCount(0);
  await expect(chatRows(page)).toHaveCount(1);
  await expect(openedRow(page)).toHaveText("Как платить налоги");
  expect(chatIdOf(page)).toBe(secondId);
  expect((await page.request.get(`/api/chat/${firstId}`)).status()).toBe(404);
});

test("после перезагрузки без адреса открывается тот же чат; удалён последний чат — открывается новый пустой", async ({ page }) => {
  await signIn(page);
  await send(page, "Запомни меня");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const id = chatIdOf(page);

  await page.goto("/");
  await expect(chatRowButton(page, "Запомни меня")).toBeVisible();
  await expect(openedRow(page)).toHaveText("Запомни меня");
  expect(chatIdOf(page)).toBe(id);

  await chooseInRowMenu(page, "Запомни меня", "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(chatRows(page)).toHaveCount(1);
  await expect(openedRow(page)).toHaveText("Новый чат");
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  expect(chatIdOf(page)).not.toBe(id);
});

test("чужие чаты не видны и не удаляются", async ({ page, context }) => {
  await signIn(page, "Анна");
  await send(page, "Тайна Анны");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const annaChatId = chatIdOf(page);
  const origin = new URL(page.url()).origin;

  await context.clearCookies();
  await context.addCookies([{ name: "demo-user", value: "boris", url: origin }]);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  await expect(page.getByText("Тайна Анны")).toHaveCount(0);
  await expect(chatRows(page)).toHaveCount(1);

  for (const request of [
    page.request.patch(`/api/chat/${annaChatId}`, { data: { title: "Взлом" } }),
    page.request.delete(`/api/chat/${annaChatId}`),
  ]) {
    const response = await request;
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: { kind: "not_found" } });
  }

  await context.clearCookies();
  await context.addCookies([{ name: "demo-user", value: "anna", url: origin }]);
  await page.goto(`/?chat=${annaChatId}`);
  await expect(chatRowButton(page, "Тайна Анны")).toBeVisible();
});
