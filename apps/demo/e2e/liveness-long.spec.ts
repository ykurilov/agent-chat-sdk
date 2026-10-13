import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * SC-006 фичи 002: агент молчит дольше минуты посреди ответа — вкладка не переподключается: сервер шлёт признаки
 * жизни. Настоящее долгое ожидание, один раз, с обычными сроками и обычным сервером стенда (имитация связи не нужна).
 */

test("долгое раздумье модели (70 с): вкладка ждёт без переподключений и получает ответ", { tag: "@long" }, async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page);
  const streamRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/stream")) streamRequests.push(request.url());
  });

  await send(page, "Подумай подольше");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 100_000 });
  await expect(answer).toContainText("Вот и ответ после долгого раздумья.");
  await expect(page.getByText("Переподключаемся…")).toHaveCount(0);
  await expect(page.getByText("Нет связи с сервером")).toHaveCount(0);
  expect(streamRequests, "вкладка не должна была переподключаться").toEqual([]);
});
