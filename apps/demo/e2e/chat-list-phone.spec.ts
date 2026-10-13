import { expect, test } from "./support/own-server";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";
import { chatList, chatRowButton, chatRows, chooseInRowMenu, newChatButton, renameChat } from "./support/chat-list";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Список чатов на телефоне (фича 010): список спрятан в панель, открывается кнопкой «Чаты», закрывается выбором чата
 * и «Новый чат»; всё нажимается пальцем. Логика списка проверена на компьютере (chat-list.spec.ts): здесь только то,
 * что зависит от экрана. У теста свой сервер: список чатов один на пользователя.
 */

test.use({ hasTouch: true });

test("панель со списком: закрыта, пока не открыли; выбор и «Новый чат» её закрывают; касания работают", async ({ page }) => {
  await signIn(page);
  await send(page, "Расскажи про Грецию");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const firstId = chatIdOf(page);

  // На виду только название чата и кнопка «Чаты»; списка нет, поле ввода на месте.
  const openButton = page.getByRole("button", { name: "Чаты", exact: true });
  await expect(page.getByText("Расскажи про Грецию").first()).toBeVisible();
  await expect(chatList(page)).toHaveCount(0);
  await expectInsideViewport(page, openButton, { horizontalOnly: true });
  await expectNoHorizontalOverflow(page);

  // «Новый чат» из панели: панель закрылась, открыт пустой чат.
  await openButton.tap();
  await expect(chatList(page)).toBeVisible();
  await expectInsideViewport(page, chatList(page), { horizontalOnly: true });
  await newChatButton(page).tap();
  await expect(chatList(page)).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveCount(0);
  expect(chatIdOf(page)).not.toBe(firstId);

  // Выбор чата из панели: панель закрылась, открылся первый чат.
  await openButton.tap();
  await expect(chatRows(page)).toHaveCount(2);
  await chatRowButton(page, "Расскажи про Грецию").tap();
  await expect(chatList(page)).toHaveCount(0);
  expect(chatIdOf(page)).toBe(firstId);
  await expect(page.getByRole("banner").locator("xpath=following::span[normalize-space()='Расскажи про Грецию']").first()).toBeVisible();

  // Переименование и удаление пальцем, внутри панели.
  await openButton.tap();
  await renameChat(page, "Расскажи про Грецию", "Отпуск");
  await chooseInRowMenu(page, "Отпуск", "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).tap();
  await expect(chatRowButton(page, "Отпуск")).toHaveCount(0);
  await expect(chatRows(page)).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
