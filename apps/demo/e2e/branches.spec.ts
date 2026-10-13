import { expect, test } from "@playwright/test";
import { feedThumbnail, lastAnswer, send, signIn } from "./support/chat";
import { makePng } from "./support/sample-files";

/*
 * Седьмая фича: переключатель веток «‹ 2/3 ›», «Переделать ответ» и правка отправленного сообщения.
 * Заглушка на «по-разному» отвечает по-новому при каждом повторе, на «как меня зовут» — по тому, что ей передали в истории:
 * так видно, какая ветка ушла модели. Вопросы в тестах разные: счётчик повторов у заглушки общий на сервер.
 */

const switcher = (page: import("@playwright/test").Page, position: number, count: number) =>
  page.getByRole("group", { name: `Вариант ${position} из ${count}` });

test("переделка ответа: второй вариант, переключатель, выбор переживает обновление страницы", async ({ page }) => {
  await signIn(page);
  await send(page, "Ответь по-разному, раз");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(lastAnswer(page)).toContainText("Вариант ответа 1.");
  // Вариант один — переключателя нет.
  await expect(page.getByRole("group", { name: /^Вариант \d+ из \d+$/ })).toHaveCount(0);

  await lastAnswer(page).getByRole("button", { name: "Переделать ответ" }).click();
  await expect(lastAnswer(page)).toContainText("Вариант ответа 2.");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(switcher(page, 2, 2)).toBeVisible();

  // Назад к первому варианту и вперёд: вопрос один, ответ один.
  await page.getByRole("button", { name: "Предыдущий вариант" }).click();
  await expect(lastAnswer(page)).toContainText("Вариант ответа 1.");
  await expect(switcher(page, 1, 2)).toBeVisible();
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(page.getByRole("log").getByText("Ответь по-разному, раз")).toHaveCount(1);

  // Выбор хранится на сервере: после обновления открывается тот же вариант.
  await page.reload();
  await expect(lastAnswer(page)).toContainText("Вариант ответа 1.");
  await expect(switcher(page, 1, 2)).toBeVisible();
  await page.getByRole("button", { name: "Следующий вариант" }).click();
  await expect(lastAnswer(page)).toContainText("Вариант ответа 2.");
});

test("правка сообщения: новая ветка, модель не знает прежнюю; переключение возвращает прежнюю", async ({ page }) => {
  await signIn(page);
  await send(page, "Меня зовут Пётр");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  await page.getByRole("button", { name: "Изменить сообщение" }).first().click();
  const editor = page.getByRole("textbox", { name: "Изменить сообщение" });
  await expect(editor).toHaveValue("Меня зовут Пётр");
  await editor.fill("Меня зовут Иван");
  await editor.press("Enter");
  await expect(page.getByRole("log").getByText("Меня зовут Иван")).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("log").getByText("Меня зовут Пётр")).toHaveCount(0);
  await expect(switcher(page, 2, 2)).toBeVisible();

  // Модель видит только новую ветку.
  await send(page, "Как меня зовут?");
  await expect(lastAnswer(page)).toContainText("Вас зовут Иван.");

  // Возврат к прежней ветке: там «Пётр», и модель узнаёт об этом.
  await page.getByRole("button", { name: "Предыдущий вариант" }).click();
  await expect(page.getByRole("log").getByText("Меня зовут Пётр")).toBeVisible();
  await expect(page.getByRole("log").getByText("Меня зовут Иван")).toHaveCount(0);
  await send(page, "Как меня зовут?");
  await expect(lastAnswer(page)).toContainText("Вас зовут Пётр.");
});

test("отмена правки ничего не меняет", async ({ page }) => {
  await signIn(page);
  await send(page, "Привет, не меняй меня");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await page.getByRole("button", { name: "Изменить сообщение" }).first().click();
  const editor = page.getByRole("textbox", { name: "Изменить сообщение" });
  await editor.fill("Совсем другое");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("log").getByText("Привет, не меняй меня")).toBeVisible();
  await expect(page.getByRole("group", { name: /^Вариант \d+ из \d+$/ })).toHaveCount(0);
});

test("правка сообщения с файлом: файл остаётся над полем и в новом варианте, новая ветка получает и файл, и новый текст", async ({ page }) => {
  await signIn(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "квадрат.png", mimeType: "image/png", buffer: Buffer.from(makePng(8, [220, 30, 30])) });
  await expect(page.getByRole("list", { name: "Вложения" }).getByAltText("квадрат.png")).toBeVisible();
  // Файл ещё грузится: отправка закрыта, пока он не готов.
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  await send(page, "Что на картинке?");
  await expect(lastAnswer(page)).toContainText("Вижу картинку (image/png)");

  await page.getByRole("button", { name: "Изменить сообщение" }).first().click();
  const editor = page.getByRole("textbox", { name: "Изменить сообщение" });
  await expect(editor).toHaveValue("Что на картинке?");
  await expect(feedThumbnail(page, "квадрат.png")).toBeVisible();
  await editor.fill("А теперь опиши подробнее");
  await editor.press("Enter");

  await expect(page.getByRole("log").getByText("А теперь опиши подробнее")).toBeVisible();
  await expect(lastAnswer(page)).toContainText("Вижу картинку (image/png)");
  await expect(feedThumbnail(page, "квадрат.png")).toBeVisible();
  await expect(switcher(page, 2, 2)).toBeVisible();

  // Прежний вариант со своим текстом и тем же файлом.
  await page.getByRole("button", { name: "Предыдущий вариант" }).click();
  await expect(page.getByRole("log").getByText("Что на картинке?")).toBeVisible();
  await expect(feedThumbnail(page, "квадрат.png")).toBeVisible();
});
