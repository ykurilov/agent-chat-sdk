import { expect, test } from "./support/own-server";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Двенадцатая фича: лимиты расходов. Бюджет сервера — 0,00037 $ на человека в месяц. Ход заглушки с этими вопросами стоит
 * около 0,00016 $ (цена DeepSeek вне пика: у заглушки часов пика нет; инструкция со схемами и живыми демонстрациями) и растёт с историей: первый ответ — меньше половины,
 * второй — за 80% (предупреждение), третий выводит за бюджет.
 * Свой сервер: бюджет задаётся его окружением. Один сценарий: норма → предупреждение → исчерпание → перезагрузка →
 * другой человек не задет → лимит подняли.
 */

test.use({ spendingLimitUsd: 0.00037 });

const notice = (page: import("@playwright/test").Page) => page.locator("[data-spending-state]");
const field = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "Сообщение" });

test("бюджет: норма, предупреждение, исчерпание, чужой бюджет не задет, лимит подняли", async ({ page, ownServer }) => {
  await signIn(page, "Анна");
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(notice(page)).toHaveCount(0);

  await send(page, "Привет ещё");
  await expect(page.locator("[data-status]")).toHaveCount(2);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(notice(page)).toHaveAttribute("data-spending-state", "warning");
  // Точный процент зависит от длины запроса и меняется с любой правкой промпта.
  await expect(notice(page)).toContainText(/Использовано [89]\d% лимита на месяц/);

  // Ход, начатый в пределах бюджета, доводится до конца, даже если выводит за него.
  await send(page, "И ещё");
  await expect(page.locator("[data-status]")).toHaveCount(3);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(notice(page)).toHaveAttribute("data-spending-state", "exhausted");
  await expect(notice(page)).toContainText(/Лимит на месяц исчерпан, обновится 1 \S+/);

  // Отправка остановлена: поле и кнопка неактивны.
  await expect(field(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeDisabled();

  // Исчерпание хранится на сервере: после перезагрузки страницы то же самое.
  await page.reload();
  await expect(field(page)).toBeVisible();
  await expect(notice(page)).toHaveAttribute("data-spending-state", "exhausted");

  // Бюджет другого человека свой: Борис пишет без ограничений.
  await page.context().clearCookies();
  await signIn(page, "Борис");
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(notice(page)).toHaveCount(0);

  // Лимит подняли: у Анны чат снова открыт.
  await ownServer.setSpendingLimit(1);
  await page.context().clearCookies();
  await signIn(page, "Анна");
  await expect(field(page)).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await send(page, "Снова здравствуйте");
  await expect(page.locator("[data-status]").last()).toHaveAttribute("data-status", "complete");
});
