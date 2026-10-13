import { expect, test } from "./support/own-server";
import { expectConsecutiveFromOne, lastAnswer, send } from "./support/chat";
import { chatList, chatRowButton, chatRows, chooseInRowMenu, newChatButton, renameChat } from "./support/chat-list";

/*
 * Панель агента в приложении (фича 021, US1–US5): один сценарий на компьютере. Светлая и тёмная тема панели — снимки в
 * галерее скина (skin-gallery/panel-skin.spec.ts); узкий экран — agent-panel-phone.spec.ts.
 * У теста свой сервер: список чатов один на человека, общий сервер смешал бы чаты соседних тестов.
 */

async function signInAs(page: import("@playwright/test").Page, user: "anna" | "boris") {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "demo-user", value: user, domain: "localhost", path: "/" }]);
  await page.goto("/panel-app");
}

const launcher = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^(Открыть агента|Закрыть панель агента)$/ }).first();
const panel = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Панель агента" });
const field = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "Сообщение" });

test("панель в приложении: место, переходы между страницами, закрытие во время ответа, чаты, перезагрузка, другой человек", async ({ page }) => {
  await signInAs(page, "anna");
  await expect(page.getByRole("heading", { name: "Задачи" })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  // Открыть кнопкой: фокус в поле ввода.
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(launcher(page)).toHaveAttribute("aria-expanded", "true");
  await expect(field(page)).toBeFocused();

  // Страница под панелью кликается: переход на карточку и кнопка на ней.
  await page.getByRole("link", { name: /Подготовить отчёт/ }).click();
  await expect(page.getByRole("heading", { name: "Подготовить отчёт" })).toBeVisible();
  await page.getByRole("button", { name: "Взять в работу" }).click();
  await expect(page.getByRole("button", { name: "В работе" })).toBeVisible();

  // Агент знает, на какой карточке человек.
  await send(page, "Где я сейчас?");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(lastAnswer(page)).toContainText("Карточка задачи «Подготовить отчёт», id 1");

  // Браузерный инструмент: агент открывает другую карточку функцией страницы, ответ дописывается после неё.
  await send(page, "Открой задачу 2");
  await expect(page).toHaveURL(/\/panel-app\/tasks\/2$/);
  await expect(page.getByRole("heading", { name: "Позвонить клиенту" })).toBeVisible();
  await expect(lastAnswer(page).getByRole("button", { name: "open_task: готово" })).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(lastAnswer(page)).toContainText("Открыл задачу 2");

  // Другая страница приложения: панель открыта, тот же чат, место сменилось.
  await page.getByRole("link", { name: "К списку задач" }).click();
  await expect(page.getByRole("heading", { name: "Задачи" })).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByText("Где я сейчас?").first()).toBeVisible();
  await send(page, "Где я сейчас?");
  await expect(lastAnswer(page)).toContainText("Не вижу, где вы сейчас");
  await page.getByRole("link", { name: /Позвонить клиенту/ }).click();
  await expect(page.getByRole("heading", { name: "Позвонить клиенту" })).toBeVisible();
  await send(page, "Где я сейчас?");
  await expect(lastAnswer(page)).toContainText("Карточка задачи «Позвонить клиенту», id 2");

  // Закрыть во время ответа и открыть: ответ целиком, без пропусков и повторов.
  await send(page, "Дай огромный ответ");
  await expect(lastAnswer(page)).toContainText("Раздел 3");
  await panel(page).getByRole("button", { name: "Закрыть панель агента" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
  await launcher(page).click();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  // Разделы огромного ответа заглушки идут 1, 2, 3… без пропусков и повторов, до самого конца.
  const sections = [...(await lastAnswer(page).innerText()).matchAll(/Раздел (\d+)/g)].map((match) => Number(match[1]));
  expect(sections.length).toBeGreaterThan(20);
  expectConsecutiveFromOne(sections);

  // Чаты: создать, переименовать, удалить.
  await panel(page).getByRole("button", { name: "Чаты" }).click();
  await expect(chatList(page)).toBeVisible();
  await expect(chatRows(page)).toHaveCount(1);
  await newChatButton(page).click();
  await expect(chatList(page)).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Чаты" }).click();
  await expect(chatRows(page)).toHaveCount(2);
  await renameChat(page, "Новый чат", "Черновик");
  await chooseInRowMenu(page, "Черновик", "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(chatRowButton(page, "Черновик")).toHaveCount(0);
  await expect(chatRows(page)).toHaveCount(1);

  // Перезагрузка: панель открыта на том же чате.
  await chatRowButton(page, "Где я сейчас?").click();
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Где я сейчас?" })).toBeVisible();
  await expect(field(page)).toBeVisible();

  // Другой человек: панель закрыта, чатов прошлого нет.
  await signInAs(page, "boris");
  await expect(panel(page)).toHaveCount(0);
  await launcher(page).click();
  await expect(field(page)).toBeFocused();
  await expect(panel(page).getByRole("heading", { name: "Где я сейчас?" })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Чаты" }).click();
  await expect(chatRows(page)).toHaveCount(1);
  await expect(chatRowButton(page, "Где я сейчас?")).toHaveCount(0);

  // Esc из списка — назад к чату (фокус в поле), второй Esc — панель закрыта.
  await newChatButton(page).focus();
  await page.keyboard.press("Escape");
  await expect(chatList(page)).toHaveCount(0);
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
});

test("агент создаёт задачу: список на странице обновляется сам, не позже 1 с после «готово» (SC-004)", async ({ page }) => {
  await signInAs(page, "anna");
  await expect(page.getByRole("heading", { name: "Задачи" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Подготовить отчёт/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Купить молоко/ })).toHaveCount(0);
  await launcher(page).click();
  await expect(field(page)).toBeFocused();

  await send(page, "Создай задачу Купить молоко");
  const answer = lastAnswer(page);
  await expect(answer.getByRole("button", { name: "create_task: готово" })).toBeVisible();
  // Сообщение уходит раньше конца вызова, так что это верхняя граница: список обновился за секунду после строки «готово».
  await expect(page.getByRole("link", { name: /Купить молоко/ })).toBeVisible({ timeout: 1000 });
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Создал задачу «Купить молоко»");

  // Страница не перезагружалась, а задача настоящая: она же в списке после перезагрузки.
  await page.reload();
  await expect(page.getByRole("link", { name: /Купить молоко/ })).toBeVisible();
  // Задачи у каждого человека свои.
  await signInAs(page, "boris");
  await expect(page.getByRole("link", { name: /Подготовить отчёт/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Купить молоко/ })).toHaveCount(0);
});

test.describe("срок браузерного инструмента", () => {
  test.use({ browserToolTimeoutMs: 3000 });

  test("страница не ответила за 3 с: строка вызова «ошибка», ответ дописан (FR-022)", { tag: "@long" }, async ({ page }) => {
    await signInAs(page, "anna");
    await launcher(page).click();
    await expect(field(page)).toBeFocused();

    await send(page, "Зависни");
    const answer = lastAnswer(page);
    await expect(answer.getByRole("button", { name: "freeze_page: ошибка" })).toBeVisible({ timeout: 10_000 });
    await expect(answer).toHaveAttribute("data-status", "complete");
    await expect(answer).toContainText("Страница не ответила вовремя");
    await answer.getByRole("button", { name: "freeze_page: ошибка" }).click();
    await expect(answer).toContainText("Страница не ответила за 3 с");
  });
});
