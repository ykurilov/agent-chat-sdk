import { expect, test } from "./support/own-server";
import { chatIdOf, chooseModel, lastAnswer, modelButton, send, signIn } from "./support/chat";
import { chatRowButton, newChatButton } from "./support/chat-list";

/*
 * Выбор модели запоминается за человеком (фича 015): новый чат открывается на последнем выбранном провайдере,
 * модели и уровне, а не на выборе по умолчанию. Свой сервер: выбор один на человека, общий сервер передал бы его
 * соседним тестам, которые входят тем же демо-пользователем. Что выбор одного человека другой не видит, проверяют
 * модульные тесты ядра и хранилищ.
 */

test("сменил модель — новый чат открывается на ней, и после перезагрузки тоже", async ({ page }) => {
  await signIn(page);
  await expect(modelButton(page)).toHaveAccessibleName("Модель: DeepSeek 4.1 Flash, DeepSeek");

  await chooseModel(page, "Fireworks", "GLM 5.3 Flash");
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");
  // Чат должен перестать быть пустым: «Новый чат» пустой чат не плодит, а открывает уже созданный.
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const firstId = chatIdOf(page);

  await newChatButton(page).click();
  await expect(page.locator("[data-status]")).toHaveCount(0);
  expect(chatIdOf(page)).not.toBe(firstId);
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");

  await page.reload();
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");

  // Не только надпись: ответ в новом чате идёт от выбранной пары.
  await send(page, "Кто отвечает?");
  await expect(lastAnswer(page)).toContainText("Отвечает fireworks: accounts/fireworks/models/glm-5p3-flash");
});

test("«Новый чат» открывает уже созданный пустой чат — и он тоже на последнем выборе, без отправки сообщения", async ({ page }) => {
  await signIn(page);
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Пустой чат создан, пока последним выбором была модель по умолчанию.
  const firstId = chatIdOf(page);
  await newChatButton(page).click();
  await expect.poll(() => chatIdOf(page)).not.toBe(firstId);
  const emptyId = chatIdOf(page);
  await expect(modelButton(page)).toHaveAccessibleName("Модель: DeepSeek 4.1 Flash, DeepSeek");

  // Выбор меняется в другом, старом чате.
  await chatRowButton(page, "Привет").click();
  await chooseModel(page, "Fireworks", "GLM 5.3 Flash");
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");

  // «Новый чат» не создаёт второй пустой, а открывает первый — и в нём уже новая модель.
  await newChatButton(page).click();
  await expect.poll(() => chatIdOf(page)).toBe(emptyId);
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");

  // Не только надпись: первый ответ в этом чате идёт от той же пары.
  await send(page, "Кто отвечает?");
  await expect(lastAnswer(page)).toContainText("Отвечает fireworks: accounts/fireworks/models/glm-5p3-flash");
});
