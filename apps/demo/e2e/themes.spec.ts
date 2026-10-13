import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { startOwnServer } from "./support/own-server";
import { signInToSandbox } from "./support/sandbox";
import { lastAnswer, modelButton, reasoningButton, send, signIn, simulateFailure } from "./support/chat";
import { expectNoHorizontalOverflow, saveScreenshot, settleAnimations } from "./support/screen";

/*
 * Светлая и тёмная тема (SC-004 фичи 002): один и тот же сценарий на проекте `desktop-light` и на проекте `desktop-dark`.
 * Логика тут не проверяется, только вид: тема применилась, текст читается на своём фоне, ничего не вылезает за край.
 * Снимки экрана лежат в /tmp/agent-chat-themes для просмотра глазами; сравнения с эталонными снимками нет:
 * шрифты и сглаживание зависят от машины, а проверки цветов и границ стабильны.
 */

const screenshotDir = "/tmp/agent-chat-themes";

/** Яркость цвета по WCAG. */
function luminance(color: string): number {
  const [red, green, blue] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/** Цвет фона элемента: первый непрозрачный у него или у его предков. */
function backgroundOf(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && !/rgba\(.*, 0\)|transparent/.test(color)) return color;
    }
    return "rgb(255, 255, 255)";
  });
}

async function expectThemeApplied(page: Page, scheme: "light" | "dark", state: string, testName: string) {
  const html = page.locator("html");
  if (scheme === "dark") await expect(html).toHaveClass(/dark/);
  else await expect(html).not.toHaveClass(/dark/);

  await settleAnimations(page);
  const pageBackground = await backgroundOf(page, "body");
  expect(luminance(pageBackground) > 0.5, `фон страницы в теме ${scheme}: ${pageBackground}`).toBe(scheme === "light");

  const answer = lastAnswer(page);
  if (await answer.count()) {
    const textColor = await answer.evaluate((element) => getComputedStyle(element).color);
    const answerBackground = await backgroundOf(page, "[data-status]");
    expect(contrast(textColor, answerBackground), `контраст текста ответа: ${textColor} на ${answerBackground}`).toBeGreaterThanOrEqual(4.5);
  }
  await expectNoHorizontalOverflow(page);

  await saveScreenshot(page, screenshotDir, `${testName}-${state}-${scheme}`);
}

/** Отправляет и ждёт, пока появится новый ответ и допишется: иначе «complete» можно принять у прошлого ответа. */
async function sendAndWaitForAnswer(page: Page, text: string) {
  const before = await page.locator("[data-status]").count();
  await send(page, text);
  await expect(page.locator("[data-status]")).toHaveCount(before + 1);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

test("тема применена: таблица и код, строки инструментов, ошибка, остановленный ответ", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "chat");

  await signIn(page);
  await shot("empty");

  await sendAndWaitForAnswer(page, "Покажи таблицу и код");
  await lastAnswer(page).getByRole("button", { name: /Думал \d+ сек/ }).click();
  await shot("table-and-code");

  await sendAndWaitForAnswer(page, "Сколько времени в Токио и в Москве и какая разница?");
  await shot("tool-rows");

  await sendAndWaitForAnswer(page, "Найди курс через справочную службу");
  await shot("tool-error");

  await send(page, "Дай длинный ответ");
  await expect(lastAnswer(page)).toContainText("Абзац 2:");
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(lastAnswer(page).getByText("Остановлено")).toBeVisible();
  await shot("stopped");

  await simulateFailure(page, "Неверный ключ");
  await send(page, "Привет");
  await expect(lastAnswer(page).getByText("Ключ провайдера не подходит")).toBeVisible();
  await shot("error");
});

test("тема применена: поле ввода с выбором модели, открытое меню моделей и уровней", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "model-picker");

  await signIn(page);
  await modelButton(page).click();
  await page.getByRole("menuitem", { name: "OpenRouter", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "GPT 6 Luna", exact: true })).toBeVisible();
  await shot("providers-and-models");

  await page.getByRole("menuitemradio", { name: "GPT 6 Luna", exact: true }).click();
  await reasoningButton(page).click();
  await expect(page.getByRole("menuitemradio", { name: "Максимум", exact: true })).toBeVisible();
  await shot("reasoning-levels");

  await page.getByRole("menuitemradio", { name: "Высокий", exact: true }).click();
  await expect(reasoningButton(page)).toHaveAccessibleName("Рассуждения: Высокий");
  await shot("chosen");
});

test("тема применена: ждущий и отвеченный виджет, подсказки", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "widget");

  await signIn(page);
  await send(page, "Спроси тариф");
  await expect(page.getByRole("radiogroup", { name: "Какой тариф выберете?" })).toBeVisible();
  await shot("choice-waiting");

  await page.getByRole("radio", { name: "Про", exact: true }).click();
  await expect(lastAnswer(page)).toContainText("Выбран тариф «Про».");
  await shot("choice-answered");

  await sendAndWaitForAnswer(page, "Подскажи");
  await expect(page.getByRole("button", { name: "Спасибо, хватит" })).toBeVisible();
  await shot("suggested-replies");
});

test("тема применена: живая демонстрация берёт цвета темы и перерисовывается при её смене", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  await signIn(page);
  await sendAndWaitForAnswer(page, "Покажи демонстрацию");
  const demo = page.frameLocator('[data-live-demo="ready"] iframe').frameLocator("iframe");
  const demoBackground = () => demo.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  await expect.poll(async () => luminance(await demoBackground()) > 0.5).toBe(scheme === "light");
  await expectThemeApplied(page, scheme, "ready", "live-demo");

  // Смена темы на странице: демонстрация перерисовывается в новых цветах.
  await page.evaluate(() => document.documentElement.classList.toggle("dark"));
  await expect.poll(async () => luminance(await demoBackground()) > 0.5).toBe(scheme !== "light");
  await expect(demo.locator("#value")).toHaveText("Скорость: 40");
});

test("тема применена: песочница с журналом, правкой ответа и инструкцией", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "sandbox");

  // Список песочных чатов один на админа: у снимков свой сервер, чтобы не смешаться с соседними тестами.
  const server = await startOwnServer();
  try {
    await signInToSandbox(page, server.webUrl);
    await shot("empty");

    await sendAndWaitForAnswer(page, "Сколько времени в Токио и в Москве и какая разница?");
    const journal = page.getByRole("region", { name: "Журнал" });
    await journal.getByRole("button", { name: /^Ответ/ }).first().click();
    await shot("journal-open");

    await lastAnswer(page).getByRole("button", { name: "Изменить ответ" }).click();
    await shot("answer-editor");
    await page.getByRole("region", { name: "Правка ответа" }).getByRole("button", { name: "Отмена" }).click();

    await page.getByRole("button", { name: "Инструкция чата" }).click();
    await page.getByRole("textbox", { name: "Текст инструкции" }).fill("Отвечай одним словом.");
    await shot("instruction-editor");
  } finally {
    await server.stop();
  }
});

test("тема применена: строка помощника, карточка задачи, плашки задач", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "background");
  const topic = `тема ${scheme} ${Math.random().toString(36).slice(2, 6)}`;
  const canceledTopic = `${topic} вторая`;

  await signIn(page);
  await sendAndWaitForAnswer(page, `Поручи исследователю ${topic}`);
  await page.locator("[data-helper-status]").getByRole("button").first().click();
  await expect(page.locator("[data-helper-status]")).toContainText("Поручено");
  await shot("helper-row");

  await sendAndWaitForAnswer(page, `Запусти отчёт ${topic}`);
  await expect(page.locator("[data-task-status]")).toHaveCount(1);
  await shot("task-card");

  await page.request.post("/api/demo/reports/release", { data: { topic } });
  await expect(page.getByRole("note").filter({ hasText: "Задача готова" })).toBeVisible();
  // Итог будит агента: его ответ дописывается сам, до следующего вопроса ждём его конца.
  await expect(lastAnswer(page)).toContainText("Фоновая задача закончилась");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await shot("notice-done");

  await sendAndWaitForAnswer(page, `Запусти отчёт ${canceledTopic}`);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.locator("[data-task-status]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("note").filter({ hasText: "Задача отменена" })).toBeVisible();
  await shot("notice-canceled");
});

test("тема применена: панель подключения мессенджера", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "messengers");

  // Привязка одна на человека и на весь сервер: у снимков свой сервер, чтобы не задеть соседние тесты.
  const server = await startOwnServer();
  try {
    await signIn(page);
    await page.goto(`${server.webUrl}/messengers`);
    const telegram = page.getByRole("region", { name: "Мессенджеры" }).getByRole("group", { name: "Telegram" });
    await expect(telegram).toBeVisible();
    await shot("not-connected");

    await telegram.getByRole("button", { name: "Подключить" }).click();
    await expect(telegram).toContainText("Откройте ссылку в мессенджере");
    await shot("waiting-for-start");
  } finally {
    await server.stop();
  }
});

test("тема применена: простой вид — живая строка и раскрытые шаги", async ({ page }, testInfo) => {
  const scheme = testInfo.project.name.endsWith("dark") ? "dark" : "light";
  const shot = (state: string) => expectThemeApplied(page, scheme, state, "simple-work-view");

  await signIn(page);
  await page.getByRole("button", { name: "Простой вид" }).click();
  await send(page, "Запусти долгую проверку");
  await expect(lastAnswer(page).locator("[data-work-live]")).toBeVisible();
  await shot("live");

  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await sendAndWaitForAnswer(page, "Найди курс через справочную службу");
  for (const toggle of await page.getByRole("button", { name: "Сделан 1 шаг" }).all()) await toggle.click();
  await expect(page.locator("[data-work-step]")).toHaveCount(2);
  await shot("done");
});
