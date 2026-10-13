import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Карточка подтверждения на телефоне: только то, что зависит от экрана. Карточка и все кнопки помещаются в узкий экран,
 * решение принимается касанием. Логика подтверждения проверена на компьютере (tool-approval.spec.ts).
 */

test("на телефоне: карточка и кнопки помещаются в экран, касание «Разрешить» завершает действие", async ({ page }) => {
  await signIn(page);
  await send(page, "Очисти заметки в старой папке");

  const card = page.getByRole("group", { name: "Агент хочет: Очистить заметки" });
  await expect(card).toBeVisible();
  await expectInsideViewport(page, card, { horizontalOnly: true });
  for (const name of ["Разрешить", "Отклонить", "Всегда в этом чате"]) {
    await expectInsideViewport(page, card.getByRole("button", { name, exact: true }), { horizontalOnly: true });
  }
  await expectNoHorizontalOverflow(page);

  await card.getByRole("button", { name: "Разрешить", exact: true }).tap();
  await expect(lastAnswer(page)).toContainText("Заметки очищены.");
  await expect(page.getByRole("button", { name: "Разрешить", exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
