import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/own-server";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Шестая фича: автосжатие истории и поиск по старой переписке. Порог мал, поэтому сжатие включается на втором
 * подробном ответе. Свой сервер: порог задаётся его окружением. Один сценарий: разговор → разделитель → сводка
 * по клику → агент находит деталь, которой в сводке нет.
 */

test.use({ compactionThresholdTokens: 2000 });

/** Ответы длинные: разделитель лежит под первым, и лента убирает его из вида. Прокручиваем вверх, пока он не покажется. */
async function scrollUpTo(page: Page, target: Locator) {
  await page.getByRole("log").hover();
  await expect(async () => {
    await page.mouse.wheel(0, -1500);
    await expect(target).toBeVisible({ timeout: 500 });
  }).toPass();
}

test("переписка сжимается: разделитель, сводка по клику, агент находит старую деталь", async ({ page }) => {
  await signIn(page);
  await send(page, "Запомни: код от сейфа 4471. Ответь подробно");
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await send(page, "Ответь подробно");
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Сжатие идёт фоном после ответа: разделитель появляется сам, без обновления страницы.
  const divider = page.getByRole("button", { name: "История сжата" });
  await scrollUpTo(page, divider);
  await expect(divider).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Человек ждёт следующего вопроса")).toHaveCount(0);

  await divider.click();
  await expect(divider).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Где остановились" })).toBeVisible();
  await expect(page.getByText("Человек ждёт следующего вопроса")).toBeVisible();
  // Сообщения выше разделителя никуда не делись.
  await scrollUpTo(page, page.getByRole("log").getByText("Запомни: код от сейфа 4471. Ответь подробно"));

  // В сводке кода нет: агент ищет его в старой переписке.
  await send(page, "Какой код от сейфа?");
  await page.getByRole("log").hover();
  await page.mouse.wheel(0, 100_000);
  const answer = lastAnswer(page);
  await expect(answer.getByRole("button", { name: "Поиск по старой переписке: готово" })).toBeVisible();
  await expect(answer).toContainText("Код от сейфа — 4471.");

  // После обновления страницы разделитель на месте.
  await page.reload();
  await scrollUpTo(page, page.getByRole("button", { name: "История сжата" }));
});
