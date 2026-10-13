import { expect, test } from "./support/own-server";
import { chooseModel, lastAnswer, modelButton, send } from "./support/chat";
import { chatRow, chooseInRowMenu, renameChat } from "./support/chat-list";
import { signInToSandbox } from "./support/sandbox";

/*
 * Песочница агента (фича 026), один сценарий на компьютере: чат, журнал, правка ответа и результата инструмента,
 * инструкция и модель, переименование и удаление. Модель — заглушка демо, платных вызовов нет.
 */

test("админ: чат, журнал, правка ответа и результата, инструкция, модель, переименование и удаление", async ({ page }) => {
  await signInToSandbox(page);
  const journal = page.getByRole("region", { name: "Журнал" });

  // Вопрос с инструментом: в журнале обращение к модели, вызов инструмента и второе обращение.
  await send(page, "Сколько времени в Токио и в Москве и какая разница?");
  await expect(lastAnswer(page)).toContainText("Разница между Токио и Москвой — 6 часов.");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const rows = journal.getByRole("button", { expanded: false });
  await expect(rows.first()).toBeVisible();
  const modelRow = journal.getByRole("button", { name: /^Ответ/ }).first();
  await modelRow.click();
  await expect(modelRow).toHaveAttribute("aria-expanded", "true");
  await expect(journal.getByRole("heading", { name: "Сообщения" })).toBeVisible();
  const toolRow = journal.getByRole("button", { name: /current_time|Время/ }).first();
  await toolRow.click();
  await expect(journal.getByText("Результат", { exact: true }).first()).toBeVisible();

  // Правка ответа и результата инструмента: новая ветка 2/2 с отметками.
  await lastAnswer(page).getByRole("button", { name: "Изменить ответ" }).click();
  const editor = page.getByRole("region", { name: "Правка ответа" });
  await editor.getByRole("textbox", { name: "Текст ответа" }).fill("Разница между Токио и Москвой — ровно шесть часов.");
  await editor.getByRole("textbox", { name: /^Результат/ }).first().fill('{"timezone":"Asia/Tokyo","time":"2026-01-01T09:00:00+09:00","edited":true}');
  await editor.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("group", { name: /Вариант 2 из 2/ })).toBeVisible();
  await expect(lastAnswer(page)).toContainText("ровно шесть часов");
  await expect(page.getByText("Изменено человеком")).toBeVisible();
  await expect(page.getByText("Результат изменён").first()).toBeVisible();

  // Следующий вопрос: в журнале исправленный текст в истории.
  await send(page, "Как меня зовут?");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const nextTurn = journal.getByRole("combobox", { name: "Выбор хода" });
  await nextTurn.selectOption({ label: "Ответ 2" });
  await journal.getByRole("button", { name: /^Ответ/ }).first().click();
  await expect(journal.getByText("ровно шесть часов").first()).toBeVisible();

  // Инструкция чата: изменить, увидеть пометку в журнале, вернуть боевую.
  await page.getByRole("button", { name: "Инструкция чата" }).click();
  await page.getByRole("textbox", { name: "Текст инструкции" }).fill("Отвечай одним словом.");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Инструкция изменена")).toBeVisible();
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await nextTurn.selectOption({ label: "Ответ 3" });
  await expect(journal.getByText("Инструкция изменилась").first()).toBeVisible();
  await page.getByRole("button", { name: "Вернуть боевую" }).click();
  await expect(page.getByText("Инструкция изменена")).toHaveCount(0);

  // Модель этого чата меняется в поле ввода; следующий ответ идёт уже от неё.
  await chooseModel(page, "OpenRouter", "GPT 6 Luna");
  await expect(modelButton(page)).toContainText("GPT 6 Luna");
  await send(page, "Привет ещё раз");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await nextTurn.selectOption({ label: "Ответ 4" });
  await expect(journal.getByRole("button", { name: /gpt-6-luna/ }).first()).toBeVisible();

  // Переименование и удаление чата.
  const title = "Сколько времени в Токио и в Москве и какая разница?";
  await renameChat(page, title, "Часовые пояса");
  await chooseInRowMenu(page, "Часовые пояса", "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(chatRow(page, "Часовые пояса")).toHaveCount(0);
});
