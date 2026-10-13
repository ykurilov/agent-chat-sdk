import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/** Фоновые задачи: запуск, другой вопрос в это время, итог в открытой вкладке без перезагрузки, отмена (US2). */

const uniqueTopic = () => `дно ${Math.random().toString(36).slice(2, 8)}`;
const taskCard = (page: Page, topic: string) => page.getByRole("group", { name: `Отчёт: ${topic}` });
const releaseReport = async (page: Page, topic: string) =>
  expect((await page.request.post("/api/demo/reports/release", { data: { topic } })).ok()).toBe(true);

test("фоновый отчёт: запуск, другой вопрос в это время, итог и ответ агента без перезагрузки", async ({ page }) => {
  const topic = uniqueTopic();
  await signIn(page);
  await send(page, `Запусти отчёт ${topic}`);
  await expect(lastAnswer(page)).toContainText(`Запустил отчёт «${topic}», он делается в фоне.`);
  await expect(taskCard(page, topic)).toHaveAttribute("data-task-status", /queued|running/);

  // Пока отчёт идёт, чат отвечает на другое. Итог приходит, пока вкладка занята ответом: он появляется, когда ответ закончится.
  await send(page, "Дай длинный ответ");
  const longAnswer = lastAnswer(page);
  await expect(longAnswer).toContainText("Абзац 3:");
  await expect(taskCard(page, topic)).toHaveAttribute("data-task-status", /queued|running/);
  await releaseReport(page, topic);
  await expect(longAnswer).toHaveAttribute("data-status", "streaming");
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(page.locator("[data-status]").filter({ hasText: "Абзац 3:" })).toHaveAttribute("data-status", "stopped");

  const done = `Отчёт «${topic}» готов: три раздела, шесть таблиц.`;
  await expect(page.getByRole("note").filter({ hasText: done })).toBeVisible();
  await expect(lastAnswer(page)).toContainText(`Фоновая задача закончилась. Итог: ${done}`);
  await expect(taskCard(page, topic)).toHaveCount(0);
});

test("отмена фоновой задачи: карточка уходит, в ленте пометка «отменена», агент не будится", async ({ page }) => {
  const topic = uniqueTopic();
  await signIn(page);
  await send(page, `Запусти отчёт ${topic}`);
  await expect(lastAnswer(page)).toContainText(`Запустил отчёт «${topic}»`);

  await taskCard(page, topic).getByRole("button", { name: "Отменить" }).click();
  await expect(taskCard(page, topic)).toHaveCount(0);

  const note = page.getByRole("note").filter({ hasText: `Отчёт: ${topic}` });
  await expect(note).toContainText("Задача отменена");
  // Отменённая задача агента не будит: последний ответ остался про запуск.
  await expect(lastAnswer(page)).toContainText(`Запустил отчёт «${topic}»`);
});
