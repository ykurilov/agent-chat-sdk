import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/** Помощник «исследователь»: поручение, шаги и итог видны в ленте и после перезагрузки (US1). */

const uniqueTopic = () => `море ${Math.random().toString(36).slice(2, 8)}`;

test("поручение помощнику: строка с шагами и итогом, ответ агента; после перезагрузки то же", async ({ page }) => {
  const topic = uniqueTopic();
  await signIn(page);
  await send(page, `Поручи исследователю ${topic}`);

  const row = page.locator("[data-helper-status]");
  await expect(row).toHaveAttribute("data-helper-status", "done");
  await expect(lastAnswer(page)).toContainText(`Исследователь закончил: источники по теме «${topic}» найдены.`);

  const expectRowDetails = async () => {
    await row.getByRole("button").first().click();
    await expect(row).toContainText("Поручено");
    await expect(row).toContainText(`Изучи тему: ${topic}`);
    await expect(row.locator("[data-step-state]").first()).toBeVisible();
    await expect(row).toContainText("Вернул");
    await expect(row).toContainText(`Нашёл по теме «${topic}»: учебник, статья, обзор.`);
  };
  await expectRowDetails();

  await page.reload();
  await expect(page.locator("[data-helper-status]")).toHaveAttribute("data-helper-status", "done");
  await expect(lastAnswer(page)).toContainText(`Исследователь закончил: источники по теме «${topic}» найдены.`);
  await expectRowDetails();
});
