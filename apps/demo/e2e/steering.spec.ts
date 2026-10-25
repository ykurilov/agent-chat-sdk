import { expect, test } from "@playwright/test";
import { send, signIn } from "./support/chat";

/*
 * Фича 034: поправка на лету. Пока идёт долгий инструмент (`slow_check`, пять секунд), человек пишет поправку: она сразу
 * в ленте с пометкой, агент берёт её после инструмента и отвечает с её учётом, сделанное до поправки остаётся.
 */

const pending = (page: import("@playwright/test").Page) => page.getByRole("log").locator("[data-steering-pending]");

for (const skin of ["tandem", "default"] as const) {
test.describe(`steering: ${skin}`, () => {
test("поправка во время инструмента: пометка, затем ответ с её учётом; вызов инструмента остаётся", async ({ page }) => {
  await signIn(page, "Анна", "/", skin);
  await send(page, "Запусти долгую проверку кнопки");
  const log = page.getByRole("log");
  await expect(log.getByRole("button", { name: /slow_check/ })).toBeVisible();

  // Ответ идёт: «Остановить» на месте, поле свободно.
  await expect(page.getByRole("button", { name: "Остановить" })).toBeVisible();
  await send(page, "Поправка: кнопка синяя");
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveValue("");
  await expect(pending(page)).toHaveText("Агент учтёт на следующем шаге");
  await expect(log.getByText("Поправка: кнопка синяя")).toBeVisible();

  await expect(log.getByText("Учёл поправку: Поправка: кнопка синяя")).toBeVisible({ timeout: 15_000 });
  await expect(pending(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);

  // Прерванный ради поправки ответ — не «модель не дала ответа».
  await expect(log.getByText("Модель не дала ответа")).toHaveCount(0);

  // После перезагрузки — тот же порядок: вопрос, ответ с вызовом инструмента, поправка, ответ на неё.
  await page.reload();
  await expect(log.getByText("Учёл поправку: Поправка: кнопка синяя")).toBeVisible();
  await expect(log.getByRole("button", { name: "slow_check: готово" })).toBeVisible();
  const order = await log.innerText();
  const positions = ["Запусти долгую проверку кнопки", "Поправка: кнопка синяя", "Учёл поправку"].map((text) => order.indexOf(text));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  await expect(pending(page)).toHaveCount(0);
  await expect(log.getByText("Модель не дала ответа")).toHaveCount(0);
});

test("перезагрузка, пока поправка ждёт: она видна с пометкой, затем агент её берёт", async ({ page }) => {
  await signIn(page, "Анна", "/", skin);
  await send(page, "Запусти долгую проверку кнопки");
  await expect(page.getByRole("log").getByRole("button", { name: /slow_check/ })).toBeVisible();
  await send(page, "Поправка: и крупнее");
  await expect(pending(page)).toBeVisible();

  await page.reload();
  const log = page.getByRole("log");
  await expect(log.getByText("Учёл поправку: Поправка: и крупнее")).toBeVisible({ timeout: 15_000 });
  await expect(pending(page)).toHaveCount(0);
  await expect(log.getByText("Поправка: и крупнее", { exact: true })).toHaveCount(1);
});

});
}
