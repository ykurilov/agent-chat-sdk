import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Поправка на лету на узком экране (320 px): только то, что зависит от экрана. Пока идёт ответ, в рамке поля и «Стоп», и
 * «Отправить»; ряд кнопок не шире экрана — кнопка голосового режима на это время спрятана. Логика — steering.spec.ts.
 */

test.use({ viewport: { width: 320, height: 640 } });

for (const skin of ["tandem", "default"] as const) {
test.describe(`steering: ${skin}`, () => {
test("320 px: во время ответа «Остановить» и «Отправить» в экране, страница не шире экрана", async ({ page }) => {
  await signIn(page, "Анна", "/", skin);
  await send(page, "Дай длинный ответ");
  await expect(lastAnswer(page)).toContainText("Абзац 2:");
  await page.getByRole("textbox", { name: "Сообщение" }).fill("Поправка: короче");
  await expectInsideViewport(page, page.getByRole("button", { name: "Остановить" }), { horizontalOnly: true });
  await expectInsideViewport(page, page.getByRole("button", { name: "Отправить" }), { horizontalOnly: true });
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Остановить" }).tap();
  await expect(page.getByRole("button", { name: "Голосовой режим" })).toBeVisible();
});

});
}
