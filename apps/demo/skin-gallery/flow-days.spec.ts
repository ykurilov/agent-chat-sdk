import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { screenshotFolder } from "../e2e/support/screen";

/*
 * Этап 10 плана 061: поля формата v2 на доске — «Дни и время», «Длится» и касания ноды, условие «да/нет», попутные
 * задачи с полем из словаря приложения, своя проверка приложения. Один сквозной проход; тёмная тема и телефон — снимками.
 */

const shots = process.env.FLOW_DAYS_SHOTS ?? screenshotFolder("agent-chat-flow-days");
mkdirSync(shots, { recursive: true });

async function open(page: Page, theme: string) {
  await page.goto(`/flow-editor.html?theme=${theme}&flow=marathon-days`);
  await page.locator(".react-flow__node").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const node = (page: Page, title: string) => page.locator(".react-flow__node").filter({ hasText: title });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("дни и время, «Длится», касания, попутные задачи и проверка приложения", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "light");

  // Подписи на карточках нод.
  await expect(node(page, "День 1: знакомство").locator("[data-flow-node-timing]")).toHaveText("1 день");
  await expect(node(page, "День 2: практика").locator("[data-flow-node-timing]")).toHaveText("2 дня · касания 30 мин · 12:00");
  await expect(node(page, "Итог").locator("[data-flow-node-timing]")).toHaveText("без касаний");

  // Обзор: «Дни и время» включены, общий срок, касания по умолчанию.
  const schedule = page.locator("[data-flow-schedule]");
  await expect(schedule.getByRole("switch", { name: "Сценарий по дням" })).toBeChecked();
  await expect(schedule.getByLabel("Начало дня")).toHaveValue("09:00");
  await schedule.getByLabel("Сколько дней").fill("5");
  await expect(schedule.getByLabel("Готовый текст прощания")).toHaveValue("Марафон закончился. Спасибо, что были с нами!");
  await expect(schedule.locator("[data-flow-nudges]").getByLabel("Молчит — написать через 2", { exact: true })).toHaveValue("4");

  // Попутные задачи: поле из словаря приложения попадает в карточку.
  const tasks = page.locator("[data-flow-side-tasks]");
  await expect(tasks.getByText("«Узнать город» — встроенная задача")).toBeVisible();
  await tasks.getByRole("button", { name: "Добавить задачу" }).click();
  const added = tasks.locator('[data-side-task="task_2"]');
  await added.getByLabel("Что сделать").fill("Узнать тариф");
  await added.getByLabel("Решена, когда известно поле").selectOption({ label: "Тариф" });
  await schedule.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/light-overview.png` });

  // Нода: «Длится» 3 дня, касания выключены — подпись на карточке меняется.
  await node(page, "День 2: практика").locator('[role="button"]').first().click();
  const timing = page.locator("[data-flow-state-timing]");
  await expect(timing.getByRole("combobox", { name: "Длится", exact: true })).toHaveValue("d");
  await timing.getByLabel("Длится: дней").fill("3");
  await expect(timing.locator("[data-flow-nudges]")).toBeVisible();
  // Свои касания — только в день входа, дальше общие касания сценария.
  await timing.getByRole("combobox", { name: "Свои касания действуют" }).selectOption("days");
  await expect(timing.getByLabel("Свои касания действуют: дн., считая день входа")).toHaveValue("1");
  await expect(node(page, "День 2: практика").locator("[data-flow-node-timing]")).toHaveText("3 дня · касания 30 мин · 12:00 в день входа");
  await page.screenshot({ path: `${shots}/light-state.png` });
  await timing.locator("[data-flow-nudges-days]").scrollIntoViewIfNeeded();
  await timing.screenshot({ path: `${shots}/light-state-nudges.png` });
  await timing.getByRole("radio", { name: "Выкл" }).click();
  await expect(node(page, "День 2: практика").locator("[data-flow-node-timing]")).toHaveText("3 дня · без касаний");
  // «До дня N программы»: номер дня — после варианта, подпись — «с дня N».
  await timing.getByRole("combobox", { name: "Длится", exact: true }).selectOption("program_day");
  await timing.getByLabel("Длится: до дня программы").fill("4");
  await expect(node(page, "День 2: практика").locator("[data-flow-node-timing]")).toHaveText("с дня 4 · без касаний");
  await page.screenshot({ path: `${shots}/light-program-day.png` });
  // Выход «Длится» не дублируется среди карточек условий.
  await expect(page.locator("[data-exit-card]")).toHaveCount(0);

  // Условие «да/нет» в ноде первого дня.
  await node(page, "День 1: знакомство").locator('[role="button"]').first().click();
  const paid = page.locator('[data-exit-card="day1_paid"]');
  await expect(paid.getByLabel("Значение")).toHaveValue("true");
  await paid.getByLabel("Значение").selectOption({ label: "нет" });

  // Своя проверка приложения: у дня нет утреннего сообщения — находка в «Проверить граф» ведёт к ноде.
  await page.getByText("Дополнительно", { exact: true }).last().click();
  await page.getByLabel("Первое сообщение").fill("");
  await page.getByRole("button", { name: /Проверить граф/ }).click();
  const check = page.getByRole("region", { name: "Проверка" });
  await expect(check.getByText("Приложение: у дня марафона нет утреннего сообщения.")).toBeVisible();
  await page.screenshot({ path: `${shots}/light-check.png` });
  await check.getByRole("button", { name: /Приложение: у дня марафона/ }).click();
  await expect(page.getByRole("region", { name: "Состояние" })).toContainText("День 1: знакомство");

  // Всё записалось в JSON.
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const json = JSON.parse(await page.getByRole("textbox", { name: "Граф в формате JSON" }).inputValue());
  expect(json.schedule.lengthDays).toBe(5);
  expect(json.sideTasks[1]).toMatchObject({ text: "Узнать тариф", field: "tariff" });
  expect(json.clientCard.map((field: { id: string }) => field.id)).toContain("tariff");
  expect(json.states[1].exits[0].when).toEqual({ type: "timer", from: "program_day", day: 4 });
  expect(json.states[1].nudges).toBe("off");
  expect(json.states[0].exits[0].when.value).toBe(false);
});

test("тёмная тема: обзор и нода со своими касаниями", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "dark");
  await page.locator("[data-flow-schedule]").getByText("Дополнительно").click();
  await page.screenshot({ path: `${shots}/dark-overview.png` });
  await node(page, "День 2: практика").locator('[role="button"]').first().click();
  await expect(page.locator("[data-flow-state-timing] [data-flow-nudges]")).toBeVisible();
  await page.screenshot({ path: `${shots}/dark-state.png` });
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("разделы дней и ноды без сдвига вбок", async ({ page }) => {
    await open(page, "light");
    await page.locator("[data-flow-schedule]").scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}/phone-overview.png` });
    await node(page, "День 2: практика").locator('[role="button"]').first().tap();
    await page.locator("[data-flow-state-timing]").scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}/phone-state.png` });
  });
});

test("подписи событий приложения: на доске и в карточке условия — подпись, в JSON — имя", async ({ page }) => {
  await page.goto("/flow-editor.html?theme=light&flow=shop-support");
  await page.locator(".react-flow__node").first().waitFor();
  const refund = node(page, "Оформление возврата");
  await expect(refund).toContainText("Нажата кнопка «Возврат оформлен»");
  await refund.locator('[role="button"]').first().click();
  const card = page.locator('[data-exit-card="refund_done"]');
  await expect(card.getByLabel("Что именно").locator("option:checked")).toHaveText("Возврат оформлен");
  await expect(card.getByLabel("Что именно")).toHaveValue("start_refund");
});
