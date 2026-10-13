import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Виджеты на узком экране (320 px): только то, что зависит от экрана. Логика ответа проверена на компьютере (widgets.spec.ts).
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: варианты строками, касание отвечает", async ({ page }) => {
  await signIn(page);
  await send(page, "Спроси тариф");
  const group = page.getByRole("radiogroup", { name: "Какой тариф выберете?" });
  await expect(group).toBeVisible();

  const options = group.getByRole("radio");
  await expect(options).toHaveCount(3);
  const boxes = [];
  for (let index = 0; index < 3; index++) {
    await expectInsideViewport(page, options.nth(index), { horizontalOnly: true });
    boxes.push((await options.nth(index).boundingBox())!);
  }
  // Строками: каждый следующий вариант ниже предыдущего, а не рядом.
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
  expect(boxes[0]!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  await group.getByRole("radio", { name: "Команда", exact: true }).tap();
  await expect(lastAnswer(page)).toContainText("Выбран тариф «Команда».");
  await expectNoHorizontalOverflow(page);
});

test("320 px: поле формы не прячется под экранной клавиатурой", async ({ page }) => {
  await signIn(page);
  await send(page, "Заполни форму");
  const form = page.getByRole("group", { name: "Контакты" });
  await expect(form).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Экранная клавиатура съедает низ экрана: окно становится ниже (так её видит страница).
  await page.setViewportSize({ width: 320, height: 320 });
  const seats = form.getByLabel("Сколько мест");
  await seats.tap();
  await expect(seats).toBeFocused();
  // Поле в фокусе прокручивается в видимую часть: ждём, пока оно туда придёт.
  await expect
    .poll(async () => {
      const box = await seats.boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height <= 320;
    })
    .toBe(true);
  await expectNoHorizontalOverflow(page);
});
