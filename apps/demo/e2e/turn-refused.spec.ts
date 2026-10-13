import { expect, test } from "@playwright/test";
import { send, signIn, simulateFailure } from "./support/chat";

/*
 * Двадцать девятая фича, Э1: приложение отказывает ходу до его начала (`beforeTurn`). Стенд при режиме «Урок закрыт»
 * отвечает отказом с кодом `demo_closed`. Один сценарий: слова приложения на экране, вопрос вернулся в поле,
 * ничего не записано и модель не вызвана; режим сняли — тот же вопрос получает ответ.
 */

test("приложение закрыло урок: виден его текст, вопрос в поле, ответа и записи нет; режим сняли — ход идёт", async ({ page }) => {
  await signIn(page);
  await simulateFailure(page, "Урок закрыт (проверка перед ходом)");

  await send(page, "Привет");

  await expect(page.locator("[data-error-kind]")).toContainText("Урок закрыт");
  await expect(page.getByText("Что-то пошло не так", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveValue("Привет");
  // Модель не вызвана и сообщение не записано: ответов нет ни сейчас, ни после перезагрузки.
  await expect(page.locator("[data-status]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveCount(0);

  // Приложение пустило снова: тот же вопрос идёт как обычный ход.
  await simulateFailure(page, "Без сбоев");
  await send(page, "Привет");
  await expect(page.locator("[data-status]").last()).toHaveAttribute("data-status", "complete");
  await expect(page.locator("[data-error-kind]")).toHaveCount(0);
});
