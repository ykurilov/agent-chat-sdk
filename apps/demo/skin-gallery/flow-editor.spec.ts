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

test("место доски: свернуть и развернуть, запомнить, полный экран, Esc", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "light");
  const board = page.locator("[data-flow-board]");
  const wide = (await board.boundingBox())!.width;

  // Легенда по умолчанию — маленькая кнопка; открывается и закрывается.
  const legend = page.getByRole("button", { name: "Легенда" });
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".flow-board__legend ul")).toHaveCount(0);
  await legend.click();
  await expect(page.locator(".flow-board__legend ul")).toBeVisible();
  await legend.click();
  await expect(page.locator(".flow-board__legend ul")).toHaveCount(0);

  // Правая панель и мини-карта сворачиваются, холст становится шире; выбор запоминается после перезагрузки.
  await page.getByRole("button", { name: "Скрыть панель «Сценарий»" }).click();
  await expect(page.locator("aside")).toHaveCount(0);
  expect((await board.boundingBox())!.width).toBeGreaterThan(wide + 300);
  await page.getByRole("button", { name: "Скрыть мини-карту" }).click();
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  await page.reload();
  await page.locator(".react-flow__node").first().waitFor();
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  await page.screenshot({ path: `${screenshotDir}/light-space-collapsed.png` });
  await page.getByRole("button", { name: "Показать панель «Сценарий»" }).click();
  await page.getByRole("button", { name: "Показать мини-карту" }).click();
  await expect(page.locator("aside")).toHaveCount(1);
  await expect(page.locator(".react-flow__minimap")).toBeVisible();

  // Полный экран: редактор поверх страницы, страница под ним не прокручивается, Esc и та же кнопка выходят.
  const enter = page.getByRole("button", { name: "На весь экран" });
  await enter.click();
  const region = page.getByRole("dialog", { name: "Редактор сценария на весь экран" });
  await expect(region).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  const box = (await region.boundingBox())!;
  expect(box).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
  await page.screenshot({ path: `${screenshotDir}/light-fullscreen.png` });
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);
  await expect(enter).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  await enter.click();
  await page.getByRole("button", { name: "Выйти из полного экрана" }).click();
  await expect(region).toHaveCount(0);
});

test("узкая шапка и свёрнутая панель: граф получает место", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/flow-editor.html?theme=light&header=compact&inspector=collapsible");
  await page.locator(".react-flow__node").first().waitFor();
  await expect(page.locator("[data-flow-editor] input")).toHaveCount(0);
  await expect(page.locator("aside")).toHaveCount(0);
  expect((await page.locator("[data-flow-board]").boundingBox())!.y).toBeLessThanOrEqual(49);
  await page.screenshot({ path: `${screenshotDir}/light-compact.png` });
  await page.locator(".react-flow__node").first().locator('[role="button"]').first().click();
  await expect(page.locator("aside")).toHaveCount(1);
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

test.describe("телефон, полный экран", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("редактор занимает окно, кнопки в экране", async ({ page }) => {
    await open(page, "dark", "shop-support");
    await page.getByRole("button", { name: "На весь экран" }).tap();
    const region = page.getByRole("dialog", { name: "Редактор сценария на весь экран" });
    await expect(region).toBeVisible();
    const box = (await region.boundingBox())!;
    expect(box.width).toBe(390);
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/dark-phone-fullscreen.png` });
    await page.getByRole("button", { name: "Выйти из полного экрана" }).tap();
    await expect(region).toHaveCount(0);
  });
});

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

test.describe("только просмотр", () => {
  test("нельзя править, сохранять и загружать JSON; смотреть, проверять и прогонять можно", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/flow-editor.html?theme=light&flow=sales-review&readonly=1");
    await page.locator(".react-flow__node").first().waitFor();
    await expect(page.locator("[data-flow-read-only-badge]")).toHaveText("Только просмотр");
    await expect(page.getByRole("button", { name: "Состояние", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Сохранено|Сохранить/ })).toHaveCount(0);
    await expect(page.locator(".react-flow__node .flow-board__new-exit")).toHaveCount(0);

    // Узел можно открыть, но поля панели выключены; перетащить узел нельзя.
    const node = page.locator(".react-flow__node").first();
    const second = page.locator(".react-flow__node").nth(1);
    // Доску можно двигать целиком, а узел относительно соседа — нет.
    const offset = async () => {
      const [a, b] = [(await node.boundingBox())!, (await second.boundingBox())!];
      return { x: Math.round(b.x - a.x), y: Math.round(b.y - a.y) };
    };
    const before = (await node.boundingBox())!;
    const offsetBefore = await offset();
    await node.locator('[role="button"]').first().click();
    await expect(page.locator("[data-exit-card]").first()).toBeVisible();
    await expect(page.locator("[data-flow-read-only]")).toBeVisible();
    for (const field of await page.locator("[data-flow-read-only] textarea").all()) await expect(field).toBeDisabled();
    await page.mouse.move(before.x + 60, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x + 260, before.y + 120, { steps: 6 });
    await page.mouse.up();
    expect(await offset()).toEqual(offsetBefore);
    await page.screenshot({ path: `${screenshotDir}/light-read-only.png` });

    // Проверка графа и прогон работают.
    await page.getByRole("button", { name: /Проверить граф/ }).click();
    await expect(page.getByRole("region", { name: "Проверка" })).toBeVisible();
    await page.getByRole("button", { name: "Прогон", exact: true }).click();
    const run = page.getByRole("region", { name: "Прогон" });
    await run.locator("[data-choice]:enabled").first().click();
    await expect(run.getByText("Прогон · шаг 2")).toBeVisible();
    await run.getByRole("button", { name: "Закончить прогон" }).click();

    // JSON — смотреть можно, загружать нельзя.
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Граф в формате JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Копировать" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Загрузить" })).toHaveCount(0);
  });

  test("тёмная тема: плашка и шапка", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/flow-editor.html?theme=dark&flow=sales-review&readonly=1");
    await page.locator(".react-flow__node").first().waitFor();
    await expect(page.locator("[data-flow-read-only-badge]")).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/dark-read-only.png` });
  });
});

test.describe("отказ в сохранении", () => {
  async function renameAndSave(page: Page, save: "reject" | "throw") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/flow-editor.html?theme=light&flow=sales-review&save=${save}`);
    await page.locator(".react-flow__node").first().waitFor();
    await page.getByRole("button", { name: "Состояние", exact: true }).click();
    await page.getByRole("button", { name: "Сохранить" }).click();
  }

  test("отказ без исключения: не «Сохранено», находка у ноды и в проверке графа", async ({ page }) => {
    await renameAndSave(page, "reject");
    const save = page.locator("[data-save-failed]");
    await expect(save).toHaveText("Не сохранено");
    await expect(page.getByRole("button", { name: "Сохранено", exact: true })).toHaveCount(0);
    await expect(page.locator(".react-flow__node").first()).toContainText(/ошиб/i);
    await page.getByRole("button", { name: /Проверить граф/ }).click();
    await expect(page.getByRole("region", { name: "Проверка" })).toContainText("Приложение: название ноды занято.");
    await page.screenshot({ path: `${screenshotDir}/light-save-rejected.png` });
  });

  test("исключение из onSave: отказ в шапке, необработанной ошибки нет", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
    await renameAndSave(page, "throw");
    await expect(page.locator("[data-save-failed]")).toHaveText("Не сохранено");
    expect(problems).toEqual([]);
  });
});

test.describe("высота", () => {
  const sizes = [
    { name: "phone-320", width: 320, height: 568, phone: true },
    { name: "phone-390", width: 390, height: 844, phone: true },
    { name: "desktop", width: 1440, height: 900, phone: false },
  ];
  for (const theme of ["light", "dark"] as const) {
    for (const size of sizes) {
      test(`${theme}, ${size.name}: родитель без высоты — холст не схлопывается`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(`/flow-editor.html?theme=${theme}&flow=sales-review&host=auto`);
        await page.locator(".react-flow__node").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const board = (await page.locator("[data-flow-board]").boundingBox())!;
        const root = (await page.locator("[data-flow-editor]").boundingBox())!;
        expect(root.height).toBeGreaterThanOrEqual(size.phone ? 560 : 420);
        expect(board.height).toBeGreaterThanOrEqual(size.phone ? 200 : 300);
        expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `${screenshotDir}/${theme}-${size.name}-auto-height.png`, fullPage: true });
      });
    }
  }

  test("родитель с высотой: редактор занимает её целиком", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "light");
    const root = (await page.locator("[data-flow-editor]").boundingBox())!;
    expect(Math.round(root.height)).toBe(900);
  });

  test("className и style идут на корень и перебивают умолчания", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/flow-editor.html?theme=light&flow=sales-review&root=custom");
    await page.locator(".react-flow__node").first().waitFor();
    const root = page.locator("[data-flow-editor]");
    await expect(root).toHaveClass(/gallery-custom-root/);
    expect(Math.round((await root.boundingBox())!.height)).toBe(500);
  });
});
