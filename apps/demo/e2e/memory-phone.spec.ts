import { expect, test } from "./support/own-server";
import { signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Экран памяти на узком экране (фича 017): ничто не вылезает за край, даже с длинным словом без пробелов.
 * Логика экрана на телефоне не повторяется: она проверена на компьютере (memory.spec.ts).
 */

test.use({ memory: true });

test("экран памяти на телефоне: кнопки, запись и форма помещаются в экран, горизонтальной прокрутки нет", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Память агента" }).click();
  const screen = page.getByRole("region", { name: "Память" });
  await screen.getByRole("button", { name: "Добавить" }).click();
  await screen.getByRole("textbox", { name: "Раздел" }).fill("О себе / Работа / Очень длинное название раздела");
  const longWord = "ОченьДлинноеСловоБезПробеловКотороеДолжноПеренестисьПоСтрокамАНеВылезтиЗаКрайЭкрана";
  await screen.getByRole("textbox", { name: "Запись" }).fill(longWord);
  await expectInsideViewport(page, screen.getByRole("group", { name: "Новая запись" }), { horizontalOnly: true });
  await screen.getByRole("button", { name: "Сохранить" }).click();

  await expect(screen.getByText(longWord)).toBeVisible();
  // Форма закрывается не мгновенно: список кнопок снимаем, когда её кнопки уже убраны.
  await expect(screen.getByRole("group", { name: "Новая запись" })).toBeHidden();
  for (const button of await screen.getByRole("button").all()) await expectInsideViewport(page, button, { horizontalOnly: true });
  await expectInsideViewport(page, screen.getByText(longWord), { horizontalOnly: true });
  await expectNoHorizontalOverflow(page);
});
