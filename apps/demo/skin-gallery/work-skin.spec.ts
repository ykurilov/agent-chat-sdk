import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { screenshotFolder } from "../e2e/support/screen";

/*
 * T023 плана 027: части фона и мессенджеров скина Тандем — строка помощника, карточка задачи во всех статусах, плашки,
 * реплика сотрудника (запасной вид без `StaffMessage`, 0.53), панель подключения. Светлая и тёмная тема — снимками; компьютер и узкий экран 320 px без сдвига вбок.
 * Снимки лежат в /tmp/agent-chat-skin-work для просмотра глазами (эталонных снимков нет).
 */

const screenshotDir = "/tmp/agent-chat-skin-work";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string) {
  await page.goto(`/work.html?theme=${theme}`);
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 320]) {
    test(`${theme}, ${width} px: помощник, задачи, плашки, мессенджеры`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, theme);
      await expect(page.locator("[data-task-id]")).toHaveCount(9);
      await expect(page.getByRole("note")).toHaveCount(8);
      const staff = page.locator('[data-gallery="staff-reply"]');
      await expect(staff.getByText("Сотрудник Ольга:")).toBeVisible();
      await expect(staff.getByText("Сотрудник:", { exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Telegram" }).getByText("Подключено")).toBeVisible();
      await expect(page.getByRole("link", { name: "Открыть в мессенджере" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${screenshotDir}/${theme}-${width}.png`, fullPage: true });
    });
  }
}

// 100: служебная строка «Агент написал первым» — без пузыря, тихим текстом между ответами. Снимки тем — для просмотра глазами.
const serviceLineDir = screenshotFolder("agent-chat-service-line");
mkdirSync(serviceLineDir, { recursive: true });

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: служебная строка пометки приложения`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await open(page, theme);
    const lines = page.locator('[data-gallery="service-lines"]');
    await expect(lines.locator("[data-service-line]")).toHaveCount(2);
    await expect(lines.getByText("Агент написал первым — человек молчал 1 ч 7 мин")).toBeVisible();
    await lines.screenshot({ path: `${serviceLineDir}/service-line-${theme}.png` });
  });
}

// 0.69.1: ряд значков шагов не вылезает за край узкой колонки (у конструктор приложений — 174 px в контейнере 136 px).
const stepIconsDir = screenshotFolder("agent-chat-step-icons");
mkdirSync(stepIconsDir, { recursive: true });

for (const width of [1280, 390]) {
  test(`${width} px: ряд значков шагов в колонках 240–420 px не шире строки, «+N» на месте`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "light");
    const columns = page.locator('[data-gallery="step-icons"] [data-column]');
    await expect(columns).toHaveCount(3);
    for (const column of await columns.all()) {
      const row = column.locator("[data-step-icons]");
      const more = row.locator("[data-step-icons-more]");
      // Узкий пузырь (короткий ответ в колонке 240 px): не влезает и «+21» — ряда нет, число шагов в подписи.
      if ((await column.getAttribute("data-column")) === "240") {
        await expect(row.locator("[data-step-icon], [data-step-icons-more]")).toHaveCount(0);
        continue;
      }
      await expect(more).toBeVisible();
      expect(await row.locator("[data-step-icon]").count()).toBeGreaterThan(0);
      const columnBox = (await column.boundingBox())!;
      const button = (await column.getByRole("button", { name: /21 шаг/ }).boundingBox())!;
      const moreBox = (await more.boundingBox())!;
      expect(button.x + button.width).toBeLessThanOrEqual(columnBox.x + columnBox.width);
      expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(columnBox.x + columnBox.width);
      // Ряд обрезает лишнее (`overflow: hidden`): «+N» и значки целиком внутри ряда, ничего не срезано.
      const rowBox = (await row.boundingBox())!;
      expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
      for (const icon of await row.locator("[data-step-icon]").all()) {
        const iconBox = (await icon.boundingBox())!;
        expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
      }
      // Сколько показано и сколько в «+N» — вместе все 21 шаг.
      const shown = await row.locator("[data-step-icon]").count();
      expect(shown + Number((await more.textContent())!.replace("+", ""))).toBe(21);
    }
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.locator('[data-gallery="step-icons"]').screenshot({ path: `${stepIconsDir}/step-icons-${width}.png` });
  });
}
