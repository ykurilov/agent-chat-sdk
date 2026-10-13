import { expect, test } from "./support/own-server";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";
import { signInToSandbox } from "./support/sandbox";

/*
 * Сотрудник проверяет чат человека (фича 029, Э5): админ находит Бориса, открывает его чат только на чтение, делает
 * копию в песочнице и пишет в ней. Чат Бориса не меняется. Свой сервер: чаты людей и список песочницы — только этого теста.
 */

test("админ: находит человека, читает его чат, проверяет в копии; чат человека не меняется", async ({ page, browser, ownServer }) => {
  const borisContext = await browser.newContext({ baseURL: ownServer.webUrl });
  const boris = await borisContext.newPage();
  await signIn(boris, "Борис");
  await send(boris, "Тайна Бориса");
  await expect(lastAnswer(boris)).toHaveAttribute("data-status", "complete");
  const borisChatId = chatIdOf(boris);
  const before = await boris.request.get(`/api/chat/${borisChatId}`);
  const borisMessages = ((await before.json()) as { messages: unknown[] }).messages;

  await signInToSandbox(page);
  await page.getByRole("navigation", { name: "Разделы песочницы" }).getByRole("button", { name: "Чаты людей" }).click();
  // Кнопки ищутся внутри раздела: в шапке демо есть своя кнопка «Борис» — смена пользователя.
  const people = page.getByRole("region", { name: "Чаты людей" });
  await people.getByRole("textbox", { name: "Найти человека" }).fill("бор");
  await people.getByRole("button", { name: "Найти" }).click();
  await people.getByRole("list", { name: "Найти человека" }).getByRole("button", { name: /Борис/ }).click();
  await people.getByRole("list", { name: "Чаты людей" }).getByRole("button").first().click();
  await expect(page.getByRole("log").getByText("Тайна Бориса")).toBeVisible();
  await expect(page.getByText("Только чтение: чат человека не меняется")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveCount(0);

  await people.getByRole("button", { name: "Проверить в копии" }).click();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  await expect(page.getByRole("log").getByText("Тайна Бориса")).toBeVisible();
  await send(page, "Что дальше?");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("log").getByText("Что дальше?")).toBeVisible();

  const after = await boris.request.get(`/api/chat/${borisChatId}`);
  expect(((await after.json()) as { messages: unknown[] }).messages).toEqual(borisMessages);
  await borisContext.close();
});
