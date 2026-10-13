import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Что зависит от экрана телефона: узкая вёрстка. Логика (ответ, «стоп», ошибки) на телефоне не повторяется:
 * она проверена на компьютере. Длинная лента, прокрутка пальцем — feed.spec.ts, вид «Нет связи» — liveness-screen.spec.ts.
 */

test("на узком экране: панель стенда, таблица и код целиком в экране, кнопка копирования не закрывает код", async ({ page }) => {
  await signIn(page);

  // Панель стенда со всеми кнопками, в том числе «Свой ToolCallRow», помещается в экран.
  for (const button of await page.getByRole("banner").getByRole("button").all()) {
    await expectInsideViewport(page, button, { horizontalOnly: true });
  }

  await send(page, "Покажи таблицу и код");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer.locator("table")).toBeVisible();

  // На телефоне кнопка копирования видна всегда: код начинается под ней, а не под ней прячется.
  const button = await answer.getByRole("button", { name: "Скопировать код" }).boundingBox();
  const code = await answer.locator("pre code").boundingBox();
  expect(button && code && button.y + button.height <= code.y).toBe(true);

  // Ничто не вылезает за край: страница не шире экрана, ответ помещается в него.
  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, answer, { horizontalOnly: true });
});
