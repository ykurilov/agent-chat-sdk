import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/*
 * Этап 5 плана 058: редактор сценария в скине Тандем — один сквозной сценарий (создать состояние → соединить на доске →
 * проверить граф → прогон → JSON), светлая и тёмная тема снимками, телефон — узкая вёрстка и касание.
 * Снимки лежат в /tmp/agent-chat-skin-flow-editor для просмотра глазами (эталонных снимков нет).
 */

const screenshotDir = "/tmp/agent-chat-skin-flow-editor";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string, flow = "sales-review") {
  await page.goto(`/flow-editor.html?theme=${theme}&flow=${flow}`);
  await page.locator(".react-flow__node").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Доска двигается плавно: ждём, пока сдвиг и масштаб перестанут меняться. */
async function boardSettled(page: Page) {
  const viewport = page.locator(".react-flow__viewport");
  let previous = "";
  await expect
    .poll(async () => {
      const current = await viewport.evaluate((element) => getComputedStyle(element).transform);
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
}

/** Тянет мышью от ручки к верху узла (низ доски занят легендой): так человек соединяет состояния на доске. */
async function dragTo(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 40, { steps: 5 });
  await page.mouse.move(end.x + end.width * 0.7, end.y + Math.min(16, end.height / 3), { steps: 10 });
  await page.mouse.up();
}

test("сценарий: новое состояние, связь на доске, проверка, прогон, JSON", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "light");
  const nodes = page.locator(".react-flow__node");
  const before = await nodes.count();
  const edgesBefore = await page.locator("[data-edge]").count();

  await page.getByRole("button", { name: "Состояние", exact: true }).click();
  await expect(nodes).toHaveCount(before + 1);
  const newNode = page.getByRole("button", { name: "Новое состояние" });
  await expect(newNode).toBeVisible();
  await expect(newNode).toHaveAttribute("aria-pressed", "true");

  // Новое состояние ставится под графом — показываем весь граф и тянем к нему связь от первого состояния.
  await page.getByRole("button", { name: "Весь граф" }).click();
  await boardSettled(page);
  const newId = await newNode.evaluate((element) => element.closest(".react-flow__node")!.getAttribute("data-id"));
  const source = nodes.first();
  await dragTo(page, source.locator('.react-flow__handle[data-handleid="@new"]'), newNode);
  await expect(page.locator("[data-edge]")).toHaveCount(edgesBefore + 1);
  await expect(source).toContainText("условие не написано");

  // Условие словами без текста — ошибка, проверка её находит и ведёт к месту.
  await page.getByRole("button", { name: /Проверить граф/ }).click();
  const check = page.getByRole("region", { name: "Проверка" });
  await expect(check).toBeVisible();
  await check.getByRole("button").first().click();
  await page.locator("[data-exit-card]").last().getByRole("textbox", { name: "Когда" }).fill("Человек готов к следующему шагу");
  await page.getByRole("button", { name: /Проверить граф/ }).click();
  await page.screenshot({ path: `${screenshotDir}/light-check.png` });

  await page.getByRole("button", { name: "Прогон", exact: true }).click();
  const run = page.getByRole("region", { name: "Прогон" });
  await expect(run.getByText("Прогон · шаг 1")).toBeVisible();
  const startState = await run.locator("[data-run-current]").getAttribute("data-run-current");
  await run.locator("[data-choice]:enabled").first().click();
  await expect(run.getByText("Прогон · шаг 2")).toBeVisible();
  await expect(run.locator("[data-run-current]")).not.toHaveAttribute("data-run-current", startState!);
  await expect(page.locator('[data-edge][data-traversed="true"]')).toHaveCount(1);
  await page.screenshot({ path: `${screenshotDir}/light-run.png` });
  await run.getByRole("button", { name: "Закончить прогон" }).click();

  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const json = page.getByRole("textbox", { name: "Граф в формате JSON" });
  await expect(json).toBeVisible();
  const text = await json.inputValue();
  expect(text).toContain(`"id": "${newId}"`);
  expect(text).toContain("Человек готов к следующему шагу");
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  await page.screenshot({ path: `${screenshotDir}/light-json.png` });
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}, компьютер: доска и панель`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, theme);
    await expect(page.locator("[data-edge]").first()).toBeAttached();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/${theme}-desktop.png` });
    await page.locator(".react-flow__node").first().locator('[role="button"]').first().click();
    await expect(page.locator("[data-exit-card]").first()).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-state.png` });
  });
}

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("узкая вёрстка без сдвига вбок, касание узла открывает состояние", async ({ page }) => {
    await open(page, "light", "shop-support");
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    // Кнопки шапки помещаются в экран, ничего не уезжает за правый край.
    const save = (await page.getByRole("button", { name: "Сохранено" }).boundingBox())!;
    expect(save.x + save.width).toBeLessThanOrEqual(390);
    const board = (await page.locator("[data-flow-board]").boundingBox())!;
    expect(board.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${screenshotDir}/phone-overview.png` });
    await page.locator(".react-flow__node").first().locator('[role="button"]').first().tap();
    await expect(page.locator("[data-exit-card]").first()).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/phone-state.png` });
  });
});
