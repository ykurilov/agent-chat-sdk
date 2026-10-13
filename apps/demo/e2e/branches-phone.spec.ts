import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Ветки на телефоне: только то, что зависит от экрана. Кнопки на касании видны без наведения, переключатель и поле правки
 * помещаются в узкий экран. Логика веток проверена на компьютере (branches.spec.ts).
 */

test("на телефоне: «Изменить» и «Переделать» видны без наведения, переключатель и поле правки помещаются в экран", async ({ page }) => {
  await signIn(page);
  await send(page, "Ответь по-разному на телефоне");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  const edit = page.getByRole("button", { name: "Изменить сообщение" });
  const regenerate = lastAnswer(page).getByRole("button", { name: "Переделать ответ" });
  await expect(edit).toBeVisible();
  await expect(regenerate).toBeVisible();
  await expectInsideViewport(page, edit, { horizontalOnly: true });
  await expectInsideViewport(page, regenerate, { horizontalOnly: true });

  await regenerate.tap();
  await expect(lastAnswer(page)).toContainText("Вариант ответа 2.");
  const group = page.getByRole("group", { name: "Вариант 2 из 2" });
  await expect(group).toBeVisible();
  await expectInsideViewport(page, group, { horizontalOnly: true });

  await page.getByRole("button", { name: "Предыдущий вариант" }).tap();
  await expect(lastAnswer(page)).toContainText("Вариант ответа 1.");

  await edit.tap();
  const editor = page.getByRole("textbox", { name: "Изменить сообщение" });
  await expect(editor).toBeVisible();
  await expectInsideViewport(page, editor, { horizontalOnly: true });
  await expectNoHorizontalOverflow(page);
});
