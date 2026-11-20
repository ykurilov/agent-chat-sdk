import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { signIn } from "./support/chat";
import { makePng } from "./support/sample-files";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Поле ввода с меню «+» (Одуванчик) и со скрепкой (Тандем). Хватает места — одна строка: «+» слева, текст, справа кнопки
 * и «Отправить». Тексту осталось бы меньше ~55 % строки (все кнопки демо на телефоне) — текст во всю ширину сверху,
 * «+» и кнопки под ним. Текст растёт вверх, кнопки остаются внизу; плашка файла — над полем. Тандем с меню моделей
 * держит ряд под полем всегда, поэтому для него меню моделей пустое — как в приложении без выбора модели.
 */

const shots = screenshotFolder("agent-chat-composer-one-row");
const box = async (locator: Locator) => (await locator.boundingBox())!;
type Skin = "default" | "tandem";

function parts(page: Page, skin: Skin) {
  const textbox = page.getByRole("textbox", { name: "Сообщение" });
  return {
    textbox,
    add: skin === "default" ? page.getByRole("button", { name: "Файл", exact: true }) : page.getByRole("button", { name: /Прикрепить/ }),
    send: page.getByRole("button", { name: "Отправить", exact: true }),
    frame: skin === "default" ? page.locator(".oduvanchik-field") : textbox.locator(".."),
  };
}

async function measure(page: Page, skin: Skin) {
  const { textbox, add, send, frame } = parts(page, skin);
  const [plus, field, arrow, outer] = await Promise.all([box(add), box(textbox), box(send), box(frame)]);
  // Кнопки внизу: «+» и «Отправить» на одной линии у нижнего края рамки.
  expect(Math.abs(plus.y + plus.height - (arrow.y + arrow.height))).toBeLessThanOrEqual(6);
  expect(outer.y + outer.height - (arrow.y + arrow.height)).toBeLessThanOrEqual(14);
  expect(plus.x).toBeLessThan(arrow.x);
  await expectNoHorizontalOverflow(page);
  return { plus, field, arrow, outer };
}

/** «+», текст и «Отправить» — в одной строке слева направо, у текста не меньше половины рамки. */
async function expectOneRow(page: Page, skin: Skin) {
  const size = await measure(page, skin);
  const { plus, field, arrow, outer } = size;
  expect(plus.x + plus.width).toBeLessThanOrEqual(field.x + 1);
  expect(field.x + field.width).toBeLessThanOrEqual(arrow.x + 1);
  expect(arrow.y).toBeLessThan(field.y + field.height);
  expect(field.width).toBeGreaterThanOrEqual(outer.width * 0.5);
  return size;
}

/** Текст во всю ширину сверху, «+» и кнопки — под ним. */
async function expectTextAbove(page: Page, skin: Skin) {
  const size = await measure(page, skin);
  const { plus, field, arrow, outer } = size;
  expect(field.y + field.height).toBeLessThanOrEqual(Math.min(plus.y, arrow.y) + 1);
  expect(field.width).toBeGreaterThanOrEqual(outer.width * 0.8);
  return size;
}

/** Подсказка пустого поля видна целиком. */
async function expectPlaceholderFits(page: Page, skin: Skin) {
  const { textbox } = parts(page, skin);
  await expect(textbox).toHaveValue("");
  const { scroll, client } = await textbox.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
}

/** Раскладка меняется после замера ширины — проверку повторяем, пока поле не перестроится. */
async function settled<T>(check: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  await expect(async () => { result = await check(); }).toPass({ timeout: 3000 });
  return result!;
}

async function open(page: Page, skin: Skin, width: number) {
  await page.setViewportSize({ width, height: 760 });
  // Меню моделей не приходит — его нет, как в приложении без выбора модели.
  if (skin === "tandem") await page.route("**/api/chat/models", () => undefined);
  await signIn(page, "Анна", "/", skin);
}

const longText = "Сделай, пожалуйста, подробный разбор вчерашнего урока: какие темы мы прошли, где ученики путались чаще всего и что стоит повторить в начале следующего занятия, чтобы закрепить материал";

for (const skin of ["default", "tandem"] as const) {
  test(`${skin}: все кнопки на телефоне — текст сверху во всю ширину; растёт вверх; длинный текст; файл; десктоп — одна строка`, async ({ page }) => {
    await open(page, skin, 375);
    const { textbox, frame } = parts(page, skin);

    const empty = await settled(() => expectTextAbove(page, skin));
    await expectPlaceholderFits(page, skin);

    await textbox.fill("Первая строка\nВторая\nТретья\nЧетвёртая");
    const tall = await settled(() => expectTextAbove(page, skin));
    expect(tall.field.height).toBeGreaterThan(empty.field.height + 40);
    // Растёт вверх: низ рамки на месте, верх ушёл выше.
    expect(Math.abs(tall.outer.y + tall.outer.height - (empty.outer.y + empty.outer.height))).toBeLessThanOrEqual(2);
    expect(tall.outer.y).toBeLessThan(empty.outer.y - 40);

    await textbox.fill(longText);
    const long = await settled(() => expectTextAbove(page, skin));
    expect(long.field.height).toBeGreaterThan(empty.field.height + 20);

    await textbox.fill("");
    await page.locator('input[type="file"]').setInputFiles([{ name: "кот.png", mimeType: "image/png", buffer: Buffer.from(makePng(8, [30, 120, 220])) }]);
    const chips = page.getByRole("list", { name: "Вложения" });
    await expect(chips.locator("li")).toHaveCount(1);
    await expect(page.getByText("Загружается")).toHaveCount(0);
    const withFile = await settled(() => expectTextAbove(page, skin));
    expect((await box(chips)).y + (await box(chips)).height).toBeLessThanOrEqual(withFile.field.y + 1);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
      for (const width of [375, 390]) {
        await page.setViewportSize({ width, height: 760 });
        await settled(() => expectTextAbove(page, skin));
        await saveScreenshot(page, shots, `${skin}-${width}-${theme}`);
        await frame.screenshot({ path: `${shots}/${skin}-${width}-${theme}-field.png` });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await settled(() => expectOneRow(page, skin));
      await saveScreenshot(page, shots, `${skin}-desktop-${theme}`);
    }
    await textbox.fill(longText);
    await settled(() => expectOneRow(page, skin));
    await frame.screenshot({ path: `${shots}/${skin}-desktop-long-field.png` });
  });

  test(`${skin}: только «+» и «Отправить» — одна строка и на 375 px, подсказка целиком`, async ({ page }) => {
    await open(page, skin, 375);
    const { textbox, add, send, frame } = parts(page, skin);
    // Приложение без голоса и своих кнопок: прячем всё, кроме «+» и «Отправить».
    await frame.evaluate((element, keep) => {
      for (const button of element.querySelectorAll("button")) if (!keep.includes(button.getAttribute("aria-label") ?? "")) button.style.display = "none";
    }, [await add.getAttribute("aria-label") ?? "", await send.getAttribute("aria-label") ?? ""]);

    const empty = await settled(() => expectOneRow(page, skin));
    expect(empty.field.width).toBeGreaterThanOrEqual(empty.outer.width * 0.55);
    expect(empty.outer.height).toBeLessThanOrEqual(64);
    await expectPlaceholderFits(page, skin);

    await textbox.fill(longText);
    const long = await settled(() => expectOneRow(page, skin));
    expect(Math.abs(long.outer.y + long.outer.height - (empty.outer.y + empty.outer.height))).toBeLessThanOrEqual(2);
    expect(long.outer.y).toBeLessThan(empty.outer.y - 20);
    await frame.screenshot({ path: `${shots}/${skin}-375-few-long-field.png` });
    await textbox.fill("");
    await frame.screenshot({ path: `${shots}/${skin}-375-few-field.png` });
  });
}
