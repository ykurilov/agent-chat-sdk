import { expect, test } from "./support/own-server";
import { lastAnswer, send } from "./support/chat";
import { signInToSandbox } from "./support/sandbox";
import { expectInsideViewport, expectNoHorizontalOverflow, settleAnimations } from "./support/screen";

/*
 * Песочница на телефоне: только то, что зависит от экрана. Журнал не рядом с чатом, а выдвижной панелью справа;
 * ничего не вылезает за край. Логика песочницы проверена на компьютере (sandbox.spec.ts).
 */

test.use({ hasTouch: true });

test("телефон: журнал выдвижной панелью, без прокрутки вбок", async ({ page }) => {
  await signInToSandbox(page);
  await send(page, "Сколько времени в Токио и в Москве и какая разница?");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("region", { name: "Журнал" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Открыть журнал" }).tap();
  const panel = page.getByRole("dialog", { name: "Журнал" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Ответ/ }).first()).toBeVisible();
  await settleAnimations(page);
  await expectInsideViewport(page, panel, { horizontalOnly: true });
  await expectNoHorizontalOverflow(page);

  await panel.getByRole("button", { name: "Закрыть", exact: true }).tap();
  await expect(panel).toHaveCount(0);
});
