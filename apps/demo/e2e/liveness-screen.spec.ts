import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn, useShortLiveness } from "./support/chat";
import { expectInsideViewport, saveScreenshot } from "./support/screen";

/*
 * Вид «Переподключаемся…» и «Нет связи с сервером» на экране (US2): как строка и кнопка «Повторить»
 * выглядят и нажимаются на компьютере и на узком экране iPhone. Сроки здесь короткие (настройка `liveness`
 * стенда), потому что проверяется экран, а не время: время проверяют юнит-тесты и liveness.spec.ts.
 * Тёмная тема — переключателем в шапке стенда, снимки обеих тем.
 */

const screenshotDir = "/tmp/agent-chat-002-us2";
const CHAT_REQUESTS = "**/api/chat/**";

/** Снимок в светлой и в тёмной теме; тема возвращается светлой. */
async function screenshotInBothThemes(page: Page, name: string, project: string) {
  await saveScreenshot(page, screenshotDir, `${name}-light-${project}`);
  await page.getByRole("button", { name: "Тёмная тема" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await saveScreenshot(page, screenshotDir, `${name}-dark-${project}`);
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
}

test.beforeEach(async ({ page }) => {
  await useShortLiveness(page);
});

test("«Нет связи с сервером» с «Повторить» и «Переподключаемся…» на экране; после «Повторить» чат загружен", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  await signIn(page);
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  // Соединения отказывают при открытии: «Нет связи с сервером» и «Повторить».
  await page.route(CHAT_REQUESTS, (route) => route.abort("connectionrefused"));
  await page.reload();
  const offline = page.getByText("Нет связи с сервером");
  const retry = page.getByRole("button", { name: "Повторить" });
  await expect(offline).toBeVisible();
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expectInsideViewport(page, retry);
  await screenshotInBothThemes(page, "offline", project);

  // Сервер не отвечает: попытки идут, вкладка показывает «Переподключаемся…».
  await page.unroute(CHAT_REQUESTS);
  await page.route(CHAT_REQUESTS, () => new Promise<void>(() => {}));
  await retry.click();
  const reconnecting = page.getByText("Переподключаемся…");
  await expect(reconnecting).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expectInsideViewport(page, reconnecting);
  await screenshotInBothThemes(page, "reconnecting", project);

  // Попытки кончились — снова «Нет связи»; сервер вернулся — «Повторить» загружает чат.
  await expect(offline).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await retry.click();
  await expect(offline).toHaveCount(0);
  await expect(reconnecting).toHaveCount(0);
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();
});
