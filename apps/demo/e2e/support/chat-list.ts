import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Шаги сценариев со списком чатов. На узком экране список лежит в панели: сначала её нужно открыть. */

export const chatList = (page: Page) => page.getByRole("navigation", { name: "Чаты" });
export const chatRows = (page: Page) => chatList(page).locator("[data-chat-id]");
/** Кнопка «Новый чат» первая в списке; строка чата без названия называется так же. */
export const newChatButton = (page: Page) => chatList(page).getByRole("button", { name: "Новый чат" }).first();
export const chatRow = (page: Page, title: string) => chatList(page).locator("[data-chat-id]").filter({ hasText: title });
export const chatRowButton = (page: Page, title: string) => chatRow(page, title).getByRole("button", { name: title, exact: true });

/** Открывает меню строки чата и выбирает пункт. */
export async function chooseInRowMenu(page: Page, title: string, item: "Переименовать" | "Удалить") {
  await chatRow(page, title).getByRole("button", { name: `Действия с чатом «${title}»` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

export async function renameChat(page: Page, title: string, newTitle: string) {
  await chooseInRowMenu(page, title, "Переименовать");
  const field = page.getByRole("textbox", { name: "Название чата" });
  await expect(field).toBeFocused();
  await field.fill(newTitle);
  await field.press("Enter");
  await expect(chatRowButton(page, newTitle)).toBeVisible();
}

/** Чат открыт: у его строки в списке `aria-current`. */
export const openedRow = (page: Page): Locator => chatList(page).locator("[aria-current=true]");
