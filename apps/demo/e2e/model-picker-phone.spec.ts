import { expect, test } from "./support/own-server";
import { modelButton, reasoningButton, send, signIn, lastAnswer } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow, settleAnimations } from "./support/screen";

/*
 * Выбор модели на телефоне: только то, что зависит от экрана. Меню провайдеров и подменю моделей вместе шире
 * телефона, поэтому там один список «модель · провайдер». Поле с двумя кнопками помещается в ширину, список
 * открывается касанием и не выходит за край, выбор доходит до кнопки и до ответа. Остальная логика — model-picker.spec.ts.
 *
 * Свой сервер на тест: выбор модели запоминается за человеком (фича 015), общий сервер передал бы его соседним
 * тестам, которые входят тем же демо-пользователем и ждут выбор по умолчанию.
 */

test("поле ввода с выбором модели помещается в узкий экран, список целиком в экране, выбор работает", async ({ page }) => {
  await signIn(page);
  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, modelButton(page), { horizontalOnly: true });
  await expectInsideViewport(page, reasoningButton(page), { horizontalOnly: true });

  await modelButton(page).tap();
  await settleAnimations(page);
  const list = page.getByRole("menu");
  await expect(list.getByRole("menuitem")).toHaveCount(0);
  await expect(list.getByRole("menuitemradio")).toHaveCount(10);
  await expectInsideViewport(page, list, { horizontalOnly: true });
  await list.getByRole("menuitemradio", { name: "GPT 6 Luna · OpenRouter", exact: true }).tap();

  await expect(modelButton(page)).toHaveAccessibleName("Модель: GPT 6 Luna · OpenRouter");
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Высокий");
  await expectNoHorizontalOverflow(page);

  await send(page, "Кто отвечает?");
  await expect(lastAnswer(page)).toContainText("Отвечает openrouter: openai/gpt-6-luna");
});

test("самое длинное название модели не выталкивает кнопки за край", async ({ page }) => {
  await signIn(page);
  await modelButton(page).tap();
  await page.getByRole("menuitemradio", { name: "DeepSeek 4.1 Flash · Together AI", exact: true }).tap();

  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, reasoningButton(page), { horizontalOnly: true });
  await expectInsideViewport(page, page.getByRole("button", { name: "Отправить" }), { horizontalOnly: true });
});
