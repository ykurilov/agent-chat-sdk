import { expect, test } from "./support/own-server";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";

/*
 * Лимит сообщений (029, US5): у каждого человека 5 сообщений. После четвёртого — «Осталось 1 сообщение», после
 * пятого — «Лимит сообщений исчерпан», отправка закрыта, сервер отвечает отказом. Окно на всё время: окно суток
 * у полуночи сменилось бы посреди теста. Дата обновления в надписи проверена в тестах React.
 * Свой сервер: лимит задаётся его окружением.
 */

test.use({ messageLimit: { messages: 5, window: "total" } });

const notice = (page: import("@playwright/test").Page) => page.locator("[data-spending-state]");
const field = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "Сообщение" });

/** Отправляет вопрос и ждёт конца ответа. Ответы заглушки длинные, лента рисует не все, поэтому без счёта ответов. */
async function ask(page: import("@playwright/test").Page, text: string) {
  await send(page, text);
  await expect(page.getByRole("log").getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

test("лимит сообщений: остаток, исчерпание, отказ сервера", async ({ page }) => {
  await signIn(page, "Анна");
  for (const text of ["Первое", "Второе", "Третье", "Четвёртое"]) await ask(page, text);
  await expect(notice(page)).toHaveAttribute("data-spending-state", "warning");
  await expect(notice(page)).toHaveText("Осталось 1 сообщение");

  await ask(page, "Пятое");
  await expect(notice(page)).toHaveAttribute("data-spending-state", "exhausted");
  await expect(notice(page)).toHaveText("Лимит сообщений исчерпан");
  await expect(page.getByRole("button", { name: "Отправить" })).toBeDisabled();
  await expect(field(page)).toBeDisabled();

  // Шестое мимо экрана: сервер отказывает сам и ничего не записывает.
  const refused = await page.request.post(`/api/chat/${chatIdOf(page)}/messages`, {
    data: { message: { id: "sixth", role: "user", parts: [{ type: "text", text: "Шестое" }] } },
  });
  expect(refused.status()).toBe(429);
  expect(await refused.json()).toMatchObject({ error: { kind: "spending_limit_reached", unit: "messages", windowId: "total-messages" } });
});
