import { expect, test } from "./support/own-server";
import { chooseModel, chooseReasoning, lastAnswer, modelButton, reasoningButton, reasoningLevelNames, send, signIn } from "./support/chat";

/*
 * Третья фича, User Story 1 (FR-006–FR-010): выбор модели и уровня рассуждений в поле ввода.
 * Провайдеры в стенде отвечают заглушкой, но на вопрос «Кто отвечает?» она называет пару и настройки,
 * которые пришли в запрос: так видно, что ответ идёт от выбранной пары и с выбранным уровнем.
 *
 * Свой сервер на тест: выбор модели запоминается за человеком (фича 015), общий сервер передал бы его соседним
 * тестам, которые входят тем же демо-пользователем и ждут выбор по умолчанию.
 */

test("выбор по умолчанию: DeepSeek 4.1 Flash у DeepSeek, три силы и выключение, выбран «Высокий»", async ({ page }) => {
  await signIn(page);

  await expect(modelButton(page)).toHaveAccessibleName("Модель: DeepSeek 4.1 Flash, DeepSeek");
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Высокий");
  expect(await reasoningLevelNames(page)).toEqual(["Выкл", "Низкий", "Высокий", "Максимум"]);
});

test("меню с подменю по провайдерам: у каждого провайдера свои модели", async ({ page }) => {
  await signIn(page);
  await modelButton(page).click();

  const providers = await page.getByRole("menuitem").allInnerTexts();
  expect(providers).toEqual(["Fireworks", "DeepSeek", "Together AI", "OpenRouter"]);

  await page.getByRole("menuitem", { name: "OpenRouter", exact: true }).click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["DeepSeek 4.1 Flash", "GLM 5.3 Flash", "GPT 6 Luna", "Gemini 3.8 Flash", "Claude Haiku 5.5"]);
});

test("уровни рассуждений меняются вместе с моделью: у GLM нет «Выкл», у GPT пять уровней", async ({ page }) => {
  await signIn(page);
  await chooseReasoning(page, "Выкл");

  await chooseModel(page, "Fireworks", "GLM 5.3 Flash");
  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Средний");
  expect(await reasoningLevelNames(page)).toEqual(["Низкий", "Средний", "Высокий"]);

  await chooseModel(page, "OpenRouter", "GPT 6 Luna");
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Средний");
  expect(await reasoningLevelNames(page)).toEqual(["Выкл", "Низкий", "Средний", "Высокий", "Максимум"]);

  await chooseModel(page, "DeepSeek", "DeepSeek 4.1 Flash");
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Высокий");
  expect(await reasoningLevelNames(page)).toEqual(["Выкл", "Низкий", "Высокий", "Максимум"]);
});

test("ответ приходит от выбранной пары и с выбранным уровнем", async ({ page }) => {
  await signIn(page);
  await chooseModel(page, "OpenRouter", "GPT 6 Luna");
  await chooseReasoning(page, "Высокий");

  await send(page, "Кто отвечает?");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Отвечает openrouter: openai/gpt-6-luna");
  await expect(answer).toContainText('"effort":"high"');
});

test("выбор запоминается в чате и переживает перезагрузку страницы", async ({ page }) => {
  await signIn(page);
  await chooseModel(page, "Fireworks", "GLM 5.3 Flash");
  await chooseReasoning(page, "Высокий");
  // Выбор записан на сервере: в тексте кнопок он уже виден, ждём, пока запись дойдёт.
  await send(page, "Кто отвечает?");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  await page.reload();

  await expect(modelButton(page)).toHaveAccessibleName("Модель: GLM 5.3 Flash, Fireworks");
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Высокий");
});

test("выбор сохраняется и без вопроса: перезагрузка сразу после смены", async ({ page }) => {
  await signIn(page);
  const saved = page.waitForResponse((response) => response.url().includes("/model") && response.request().method() === "PUT");
  await chooseModel(page, "OpenRouter", "Gemini 3.8 Flash");
  await saved;

  await page.reload();

  await expect(modelButton(page)).toHaveAccessibleName("Модель: Gemini 3.8 Flash, OpenRouter");
  // high допустим у обеих моделей и сохраняется при смене пары.
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Высокий");
});

test("отказ сервера: выбор возвращается назад и под полем видно причину", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/chat/*/model", (route) => route.fulfill({ status: 500, body: "boom" }));

  await chooseModel(page, "Fireworks", "GLM 5.3 Flash");

  await expect(modelButton(page)).toHaveAccessibleName("Модель: DeepSeek 4.1 Flash, DeepSeek");
  await expect(page.getByRole("status").filter({ hasText: "Не удалось сменить модель" })).toBeVisible();
});


test("Flash1017: low/high/max сохраняются после reload и доходят до OpenRouter", async ({ page }) => {
  await signIn(page);
  const routeSaved = page.waitForResponse((response) => response.url().includes("/model") && response.request().method() === "PUT");
  await chooseModel(page, "OpenRouter", "DeepSeek 4.1 Flash");
  expect((await routeSaved).ok()).toBe(true);
  for (const [label, effort] of [["Низкий", "low"], ["Высокий", "high"], ["Максимум", "max"]]) {
    const saved = page.waitForResponse((response) => response.url().includes("/model") && response.request().method() === "PUT"
      && response.request().postDataJSON()?.reasoning === effort);
    await chooseReasoning(page, label!);
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(reasoningButton(page)).toHaveAccessibleName(`Рассуждения: ${label}`);
    await send(page, "Кто отвечает?");
    await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
    await expect(lastAnswer(page)).toContainText("deepseek/deepseek-v4.1-flash-1017");
    await expect(lastAnswer(page)).toContainText(`"effort":"${effort}"`);
  }
});
