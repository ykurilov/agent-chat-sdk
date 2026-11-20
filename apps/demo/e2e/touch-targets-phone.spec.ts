import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { makePng } from "./support/sample-files";
import { saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Зоны касания на телефоне (390 px, касание): кнопки поля ввода и кнопки под ответом — не меньше 44×44 px.
 * Кнопка на вид может быть меньше: зону добирает невидимое продолжение (`::after`). Проверяем, куда палец попадает в эту кнопку.
 */

test.use({ viewport: { width: 390, height: 844 } });

const shots = screenshotFolder("agent-chat-touch-targets");
const MIN = 44;

/**
 * Зона касания кнопки — то, куда палец реально попадает в эту кнопку: обходим точки вокруг неё (шаг 1px) и берём
 * рамку точек, где верхний элемент — сама кнопка или её содержимое. Так видно и обрезку краем плашки, и перекрытие соседом.
 */
async function touchZone(button: Locator) {
  return button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let x = Math.floor(rect.left - 30); x <= Math.ceil(rect.right + 30); x++) {
      for (let y = Math.floor(rect.top - 30); y <= Math.ceil(rect.bottom + 30); y++) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(element === hit || element.contains(hit))) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { zoneWidth: right - left + 1, zoneHeight: bottom - top + 1 };
  });
}

async function expectTouchable(buttons: Locator[], expectedAtLeast: number) {
  const count = buttons.length;
  expect(count).toBeGreaterThanOrEqual(expectedAtLeast);
  const problems: string[] = [];
  for (let index = 0; index < count; index++) {
    const button = buttons[index]!;
    if (!(await button.isVisible())) continue;
    await button.scrollIntoViewIfNeeded();
    const { zoneWidth, zoneHeight } = await touchZone(button);
    const name = (await button.getAttribute("aria-label")) ?? (await button.innerText()).slice(0, 20);
    if (zoneWidth < MIN || zoneHeight < MIN) problems.push(`«${name}»: зона ${zoneWidth}×${zoneHeight}`);
  }
  expect(problems).toEqual([]);
}


for (const skin of ["default", "tandem"] as const) {
  test(`${skin}: кнопки поля ввода и плашки файла — зона касания не меньше 44×44`, async ({ page }) => {
    if (skin === "tandem") await page.route("**/api/chat/models", () => undefined);
    await signIn(page, "Анна", "/", skin);
    await page.locator('input[type="file"]').setInputFiles([{ name: "кот.png", mimeType: "image/png", buffer: Buffer.from(makePng(8, [30, 120, 220])) }]);
    await expect(page.getByRole("list", { name: "Вложения" }).locator("li")).toHaveCount(1);
    await expect(page.getByText("Загружается")).toHaveCount(0);
    await page.getByRole("textbox", { name: "Сообщение" }).fill("Привет");
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
      await saveScreenshot(page, shots, `${skin}-field-${theme}`);
    }
    const top = (await page.getByRole("list", { name: "Вложения" }).boundingBox())!.y;
    const all = await page.locator("button:visible").all();
    const inField: Locator[] = [];
    for (const button of all) if ((await button.boundingBox())!.y >= top - 1) inField.push(button);
    await expectTouchable(inField, 4);
  });

  test(`${skin}: кнопки под ответом агента — зона касания не меньше 44×44`, async ({ page }) => {
    await signIn(page, "Анна", "/", skin);
    await send(page, "Привет");
    await expect(lastAnswer(page).getByRole("button", { name: /Скопировать ответ|Копировать/ })).toBeVisible();
    await saveScreenshot(page, shots, `${skin}-answer`);
    const copy = lastAnswer(page).getByRole("button", { name: /Скопировать ответ/ });
    await expectTouchable(await copy.locator("xpath=ancestor::div[contains(@class,'items-center')][1]").locator("button:visible").all(), 2);
  });
}

/*
 * Зоны не должны перекрывать соседей: в центре и по краям каждой видимой кнопки верхний элемент — она сама.
 * Худший случай: у кнопки приложения длинная подпись (на 375 и 390 px).
 */
for (const width of [375, 390]) {
  for (const skin of ["default", "tandem"] as const) {
    test(`${skin}, ${width}px: нажатие по видимой кнопке поля попадает в неё, даже с длинной подписью кнопки приложения`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      if (skin === "tandem") await page.route("**/api/chat/models", () => undefined);
      await signIn(page, "Анна", "/", skin);
      await page.getByRole("button", { name: "Проверить работу" }).evaluate((button) => {
        const label = button.querySelector("span")!;
        label.className = "";
        label.textContent = "Проверить работу над домашним заданием";
      });
      await page.getByRole("textbox", { name: "Сообщение" }).fill("Привет");
      if (width === 390) await saveScreenshot(page, shots, `${skin}-long-label`);
      const wrong = await page.evaluate(() => {
        const top = document.querySelector('[role="textbox"], textarea')!.getBoundingClientRect().top - 4;
        const problems: string[] = [];
        for (const button of document.querySelectorAll("button")) {
          const rect = button.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || rect.top < top || rect.right > innerWidth || rect.bottom > innerHeight || getComputedStyle(button).visibility === "hidden") continue;
          const points: [number, number][] = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]];
          for (const [fx, fy] of points) {
            const hit = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
            if (!hit || !(button === hit || button.contains(hit))) {
              problems.push(`«${button.getAttribute("aria-label") ?? button.textContent?.slice(0, 20)}» (${fx},${fy}) перекрыта: ${hit?.tagName}.${String(hit?.className).slice(0, 30)}`);
              break;
            }
          }
        }
        return problems;
      });
      expect(wrong).toEqual([]);
    });
  }
}
