import { expect, test } from "./support/own-server";
import { chatIdOf, signIn, send, lastAnswer } from "./support/chat";

/** Фоновая задача переживает перезапуск сервера: вкладку закрыли, сервер перезапустили, итог ждёт в чате (US3). */

test("отчёт доделывается после перезапуска сервера: итог и ответ агента на месте при открытии чата", async ({ page, ownServer }) => {
  const topic = "перезапуск";
  await signIn(page);
  await send(page, `Запусти отчёт ${topic}`);
  await expect(lastAnswer(page)).toContainText(`Запустил отчёт «${topic}»`);
  await expect(page.locator("[data-task-id]")).toHaveCount(1);
  const chatId = chatIdOf(page);

  await page.close();
  await ownServer.stopApiGracefully();
  await ownServer.startApi();
  // Сервер встал заново: отчёт собирается снова и ждёт выпуска так же, как до перезапуска.
  await ownServer.releaseReport(topic);

  const reopened = await page.context().newPage();
  const done = `Отчёт «${topic}» готов: три раздела, шесть таблиц.`;
  await reopened.goto(`/?chat=${chatId}`);
  await expect(reopened.getByRole("note").filter({ hasText: done })).toBeVisible();
  await expect(lastAnswer(reopened)).toContainText(`Фоновая задача закончилась. Итог: ${done}`);
  await expect(reopened.locator("[data-task-id]")).toHaveCount(0);
});
