import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * SC-007: браузер ходит только на свой сервер. Ни одного запроса к провайдерам моделей,
 * ключи живут на сервере. Разговор с ответом, вызовом инструмента и остановкой.
 */

const providerHosts = /deepseek|fireworks|together|openrouter/i;

test("браузер не обращается к провайдерам моделей", async ({ page, baseURL }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  await signIn(page);
  // Перед следующим вопросом ждём новый ответ: вопрос во время ответа ушёл бы поправкой к нему.
  await send(page, "Привет");
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await send(page, "Который час в Токио?");
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await send(page, "Напиши длинный ответ");
  await expect(page.locator("[data-status]")).toHaveCount(3);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "streaming");
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "stopped");

  const ownOrigin = new URL(baseURL!).origin;
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.filter((url) => providerHosts.test(new URL(url).host))).toEqual([]);
  expect(requested.filter((url) => !url.startsWith(ownOrigin) && !url.startsWith("data:"))).toEqual([]);
});
