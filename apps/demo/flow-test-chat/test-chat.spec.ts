import { expect, test } from "@playwright/test";

// T102: тестовый чат из редактора — сообщение, перемотка часов (таймер тишины срабатывает, агент пишет первым),
// подсветка текущего состояния на доске. Модель — заглушка сервера стенда.

const REMIND = "Вы ещё здесь? Можем продолжить, когда будет удобно.";
const shots = process.env.FLOW_TEST_SHOTS ?? "/tmp/058-s10-shots";

test("тестовый чат: сообщение, «+3 ч» — агент пишет первым, доска показывает текущее состояние", async ({ page }) => {
  await page.goto("/?theme=light");
  await page.getByRole("button", { name: "Тестовый чат" }).click();

  const frame = page.locator("[data-flow-test-chat]");
  await expect(frame.locator("[data-flow-test-state]")).toHaveText("Знакомство");
  await expect(frame.locator("[data-flow-test-clock]")).toContainText("как сейчас");

  const composer = frame.getByRole("textbox").last();
  await composer.fill("Курс по акварели, продал 5 штук");
  await composer.press("Enter");
  await expect(frame.getByRole("log").getByText("Понял: Курс по акварели")).toBeVisible();
  await expect(page.locator('[data-run="current"]')).toContainText("Знакомство");

  await frame.getByRole("button", { name: "+3 ч" }).click();
  await expect(frame.getByRole("log").getByText(REMIND)).toBeVisible();
  await expect(frame.locator("[data-flow-test-clock]")).toContainText("+3 ч");
  await expect(frame.locator("[data-flow-test-state]")).toHaveText("Напоминание");
  await expect(page.locator('[data-run="current"]')).toContainText("Напоминание");
  await expect(page.locator('[data-run="visited"]')).toContainText("Знакомство");

  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: `${shots}/test-chat-light.png` });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: `${shots}/test-chat-dark.png` });
});

// Этап 10 плана 061: сценарий по дням — номер дня в рамке и «К началу следующего дня»: нода «Длится 1 день» уходит дальше.
test("сценарий по дням: «К началу следующего дня» — день 2 из 3, утреннее сообщение следующей ноды и утреннее без перехода", async ({ page }) => {
  await page.goto("/?theme=light&flow=days");
  await page.getByRole("button", { name: "Тестовый чат" }).click();

  const frame = page.locator("[data-flow-test-chat]");
  await expect(frame.locator("[data-flow-test-state]")).toHaveText("День 1: знакомство");
  // День сценария считается с первого сообщения человека.
  const composer = frame.getByRole("textbox").last();
  await composer.fill("Привет, с таблицами пока на «вы»");
  await composer.press("Enter");
  await expect(frame.getByRole("log").getByText(/^Понял:/).first()).toBeVisible();
  await expect(frame.locator("[data-flow-test-day]")).toContainText("День 1 из 3");

  await frame.getByRole("button", { name: "К началу следующего дня" }).click();
  await expect(frame.locator("[data-flow-test-day]")).toContainText("День 2 из 3");
  await expect(frame.locator("[data-flow-test-day]")).toContainText("09:00");
  await expect(frame.locator("[data-flow-test-state]")).toHaveText("День 2: практика");
  await expect(frame.getByRole("log").getByText("Доброе утро! Начинаем второй день марафона.")).toBeVisible();

  // Этап 7: утро без перехода ноды — агент сам пишет утреннее сообщение (ход «пишет первым»).
  const answers = frame.getByRole("log").getByText(/^Понял:/);
  await expect(answers).toHaveCount(1);
  await frame.getByRole("button", { name: "К началу следующего дня" }).click();
  await expect(frame.locator("[data-flow-test-day]")).toContainText("День 3 из 3");
  await expect(frame.locator("[data-flow-test-state]")).toHaveText("День 2: практика");
  await expect(answers).toHaveCount(2);

  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${shots}/test-chat-days-light.png` });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: `${shots}/test-chat-days-dark.png` });
});
