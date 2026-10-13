import { expect, test } from "./support/own-server";
import { signIn } from "./support/chat";

/** Подключение Telegram: код в панели, `/start <код>` в боте, «Подключено», разговор из бота виден в веб-списке чатов (US5). */

test("подключить Telegram: код, привязка, сообщение из бота — чат в списке с пометкой", async ({ page, ownServer }) => {
  const person = { personId: 770001, name: "Анна Тест", username: "anna_test" };
  await signIn(page);
  await page.goto("/messengers");

  const telegram = page.getByRole("region", { name: "Мессенджеры" }).getByRole("group", { name: "Telegram" });
  await telegram.getByRole("button", { name: "Подключить" }).click();
  await expect(telegram).toContainText("Откройте ссылку в мессенджере");
  const code = /Код:\s*(\S+)/.exec(await telegram.innerText())?.[1];
  expect(code, "в панели виден код привязки").toBeTruthy();

  await ownServer.telegramSay(person, `/start ${code}`);
  await expect(telegram.getByText("Подключено")).toBeVisible();
  await expect(telegram).toContainText("@anna_test");

  await ownServer.telegramSay(person, "Привет из Telegram");
  await expect.poll(async () => (await ownServer.telegramMessages(person.personId)).map((message) => message.text).join("\n")).toContain("Вот короткий пример");

  await page.goto("/");
  const origin = page.locator('[data-chat-origin="telegram"]');
  await expect(origin.first()).toBeVisible();
});
