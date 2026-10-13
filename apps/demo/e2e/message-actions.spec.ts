import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/* Своя кнопка приложения под ответом агента: Тандем рисует её в ряду действий, нажатие зовёт обработчик демо. Только компьютер. */

test("«Нравится» под законченным ответом зовёт обработчик приложения с id ответа", async ({ page }) => {
  await signIn(page);
  await send(page, "Привет");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");

  await answer.getByRole("button", { name: "Нравится" }).click();
  const liked = () => page.evaluate(() => (window as unknown as { demoLikedAnswers?: string[] }).demoLikedAnswers ?? []);
  await expect.poll(async () => (await liked()).length).toBe(1);
  expect((await liked())[0]).toEqual(expect.any(String));
});
