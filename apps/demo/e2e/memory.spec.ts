import type { Page } from "@playwright/test";
import { expect, test } from "./support/own-server";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";
import { newChatButton } from "./support/chat-list";

/*
 * Долгая память агента (фича 017): один сквозной сценарий. Запомнил в чате → запись на экране памяти → новый чат её видит →
 * правка на экране → удаление → «Стереть всю память». Свой сервер: память одна на человека, общий сервер передал бы записи
 * соседним тестам, которые входят тем же демо-пользователем. Правила записей, границы и ошибки проверяют модульные тесты.
 */

test.use({ memory: true });

const memoryScreen = (page: Page) => page.getByRole("region", { name: "Память" });

/** С экрана памяти — в чат и сразу в новый пустой чат: сообщение уходит, когда новый чат уже открыт. */
async function openNewChat(page: Page) {
  await page.getByRole("button", { name: "Чат", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("chat")).not.toBeNull();
  const openedId = chatIdOf(page);
  await newChatButton(page).click();
  await expect.poll(() => chatIdOf(page)).not.toBe(openedId);
}

test("запомнил в чате → запись на экране → новый чат её видит → правка → удаление → «Стереть всю память»", async ({ page }) => {
  await signIn(page);

  // 1. Человек просит запомнить: агент вызывает инструмент памяти, строка ленты названа по-русски.
  await send(page, "Запомни, что я пишу на TypeScript");
  const answer = lastAnswer(page);
  await expect(answer.getByRole("button", { name: "Работа с памятью: готово" })).toBeVisible();
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Запомнил: Я пишу на TypeScript.");

  // 2. Запись на экране памяти, в своём разделе.
  await page.getByRole("button", { name: "Память агента" }).click();
  const screen = memoryScreen(page);
  await expect(screen.getByText("Записей: 1 из 200")).toBeVisible();
  await expect(screen.getByRole("group", { name: "О себе, записей: 1" })).toBeVisible();
  await expect(screen.getByText("Я пишу на TypeScript")).toBeVisible();

  // 3. Новый чат видит запись: агент получает её блоком в запросе и пересказывает.
  await openNewChat(page);
  await send(page, "Что ты помнишь?");
  await expect(lastAnswer(page)).toContainText("В памяти: Я пишу на TypeScript.");

  // 4. Правка на экране: новый чат видит новый текст, а не старый.
  await page.getByRole("button", { name: "Память агента" }).click();
  await screen.getByRole("button", { name: "Изменить запись «Я пишу на TypeScript»" }).click();
  const content = screen.getByRole("textbox", { name: "Запись" });
  await content.fill("Я пишу на Rust");
  await screen.getByRole("button", { name: "Сохранить" }).click();
  await expect(screen.getByText("Я пишу на Rust")).toBeVisible();
  await expect(screen.getByText("Я пишу на TypeScript")).toHaveCount(0);

  await openNewChat(page);
  await send(page, "Что ты помнишь?");
  await expect(lastAnswer(page)).toContainText("В памяти: Я пишу на Rust.");

  // 5. Удаление записи с подтверждением.
  await page.getByRole("button", { name: "Память агента" }).click();
  await screen.getByRole("button", { name: "Удалить запись «Я пишу на Rust»" }).click();
  await page.getByRole("dialog", { name: "Удалить запись?" }).getByRole("button", { name: "Удалить" }).click();
  await expect(screen.getByText("Память пуста.", { exact: false })).toBeVisible();
  await expect(screen.getByText("Записей: 0 из 200")).toBeVisible();

  // 6. «Стереть всю память»: две записи исчезают разом, новый чат ничего не помнит.
  await screen.getByRole("button", { name: "Добавить" }).click();
  await screen.getByRole("textbox", { name: "Раздел" }).fill("Работа / Проекты");
  await screen.getByRole("textbox", { name: "Запись" }).fill("Ведёт проект «Север»");
  await screen.getByRole("button", { name: "Сохранить" }).click();
  await expect(screen.getByRole("group", { name: "Проекты, записей: 1" })).toBeVisible();
  await screen.getByRole("button", { name: "Добавить" }).click();
  await screen.getByRole("textbox", { name: "Раздел" }).fill("О себе");
  await screen.getByRole("textbox", { name: "Запись" }).fill("Любит кофе без сахара");
  await screen.getByRole("button", { name: "Сохранить" }).click();
  await expect(screen.getByText("Записей: 2 из 200")).toBeVisible();

  await screen.getByRole("button", { name: "Стереть всю память" }).click();
  await page.getByRole("dialog", { name: "Стереть всю память?" }).getByRole("button", { name: "Стереть всё" }).click();
  await expect(screen.getByText("Записей: 0 из 200")).toBeVisible();

  await openNewChat(page);
  await send(page, "Что ты помнишь?");
  await expect(lastAnswer(page)).toContainText("В памяти ничего нет.");
});

/*
 * Склейка повторов: две записи об одном и том же → после ответа оптимизатор (в демо его модель — заглушка) сливает их в одну →
 * экран показывает «Объединено: было… стало…» → «Вернуть как было» возвращает обе записи. Проверка слияния, пределов и отказов —
 * модульные тесты; здесь только то, что части работают вместе от чата до экрана.
 */
test("две записи об одном → «Объединено» на экране → «Вернуть как было»", async ({ page }) => {
  await signIn(page);
  const shorter = "Я пишу код на TypeScript каждый день";
  const fuller = `${shorter} в компании Acme`;

  await send(page, `Запомни, что ${shorter.replace("Я", "я")}`);
  await expect(lastAnswer(page)).toContainText(`Запомнил: ${shorter}.`);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await send(page, `Запомни, что ${fuller.replace("Я", "я")}`);
  await expect(lastAnswer(page)).toContainText(`Запомнил: ${fuller}.`);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Оптимизатор работает после ответа, не блокируя его: ждём слияния по адресу сервера, потом открываем экран.
  await expect
    .poll(async () => ((await (await page.request.get("/api/chat/memory/merges")).json()) as { merges: unknown[] }).merges.length)
    .toBe(1);

  await page.getByRole("button", { name: "Память агента" }).click();
  const screen = memoryScreen(page);
  await expect(screen.getByText("Записей: 1 из 200")).toBeVisible();
  const merged = screen.getByRole("region", { name: "Объединено" });
  await expect(merged.getByRole("listitem")).toHaveText([fuller, shorter]);
  await expect(merged.getByText(fuller, { exact: true })).toHaveCount(2);

  await merged.getByRole("button", { name: /^Вернуть как было/ }).click();
  await expect(screen.getByRole("region", { name: "Объединено" })).toHaveCount(0);
  await expect(screen.getByText("Записей: 2 из 200")).toBeVisible();
  await expect(screen.getByText(shorter, { exact: true })).toBeVisible();
  await expect(screen.getByText(fuller, { exact: true })).toBeVisible();

  // Вернули, значит, срок между проверками не вышел: новых слияний нет, записи остались двумя.
  expect(((await (await page.request.get("/api/chat/memory/merges")).json()) as { merges: unknown[] }).merges).toHaveLength(0);
});
