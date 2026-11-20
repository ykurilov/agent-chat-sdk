import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatIdOf, lastAnswer, send } from "./chat";

/** Сценарий компактной ленты (договор скина 37): ответ, невидимое касание приложения, ответ с четырьмя одинаковыми шагами. */
export const started = "Запустил генерацию, работы появятся в ленте.";
export const finished = "Все четыре работы готовы: кот у окна, в шляпе, в цилиндре и на крыше.";

export async function wakeAfterGenerations(page: Page) {
  await send(page, "Запусти генерации");
  await expect(lastAnswer(page)).toContainText(started);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const woke = await page.request.post("/api/demo/app-notice", { data: { chatId: chatIdOf(page) } });
  expect(await woke.json()).toMatchObject({ status: "delivered" });
  await expect(lastAnswer(page)).toContainText(finished);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

