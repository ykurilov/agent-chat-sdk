import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Ранний «Стоп»: человек жмёт «Остановить» сразу после отправки, и запрос остановки доходит до сервера раньше, чем тот
 * начал ход. Сервер запоминает «Стоп» по id запроса и останавливает ход, как только он начнётся. Порядок запросов
 * задаёт перехват: «Стоп» — на сервер первым, отправка — следом. Тонкости (другая копия сервера, чужой ход) — юнит-тесты.
 */
test("«Остановить», обогнавший отправку: ход остановлен на сервере, после обновления ответ остановлен", async ({ page }) => {
  await signIn(page);
  let stopReachedServer!: () => void;
  const stopFirst = new Promise<void>((resolve) => (stopReachedServer = resolve));
  let sendReachedServer!: () => void;
  const sendSecond = new Promise<void>((resolve) => (sendReachedServer = resolve));
  await page.route("**/api/chat/*/messages", async (route) => {
    await stopFirst;
    const response = await route.fetch();
    sendReachedServer();
    await route.fulfill({ response });
  });
  await page.route("**/api/chat/*/stop", async (route) => {
    const response = await route.fetch();
    stopReachedServer();
    await sendSecond;
    await route.fulfill({ response });
  });

  await send(page, "Дай длинный ответ");
  await page.getByRole("button", { name: "Остановить" }).click();
  await sendSecond;

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.reload();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "stopped");
});
