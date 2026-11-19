import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { makePng } from "./support/sample-files";
import { lastAnswer, signIn } from "./support/chat";

/*
 * «Отправить», нажатое во время загрузки файла: нажатие запоминается и уходит само, когда загрузка закончилась.
 * Упала — сообщение не уходит, у поля сказано почему. Тандем прячет родную кнопку поля и ставит свою — его и проверяем
 * в удачном случае; упавшую загрузку — в стандартном скине.
 */

const shot = { name: "скрин.png", mimeType: "image/png", buffer: Buffer.from(makePng(8, [30, 120, 220])) };

/** Загрузка файла держится, пока тест не отпустит её: `release("pass")` — дальше на сервер, `release("fail")` — сбой. */
async function holdUpload(page: Page) {
  let held: Route | undefined;
  await page.route("**/api/chat/*/attachments", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held = route;
  });
  return {
    waitForHold: () => expect.poll(() => held !== undefined).toBe(true),
    release: (how: "pass" | "fail") => (how === "pass" ? held!.continue() : held!.fulfill({ status: 503, body: "" })),
  };
}

function countMessageRequests(page: Page) {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/chat\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) sent.push(request.url());
  });
  return sent;
}

test("Enter во время загрузки: видно ожидание, загрузка закончилась — ровно одно сообщение с файлом", async ({ page }) => {
  await signIn(page);
  const upload = await holdUpload(page);
  const sent = countMessageRequests(page);
  await page.locator('input[type="file"]').setInputFiles([shot]);
  await upload.waitForHold();

  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.fill("Что на скрине?");
  await field.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Отправим, как только загрузятся файлы" })).toBeVisible();
  const send = page.getByRole("button", { name: "Отправить" });
  await expect(send).toHaveCount(1);
  await expect(send).toHaveAttribute("aria-busy", "true");
  // Занятая кнопка помечена aria-disabled: Playwright сам по ней не жмёт, а человек может.
  await send.click({ force: true });
  await field.press("Enter");

  await upload.release("pass");
  await expect(lastAnswer(page)).toContainText("Вижу картинку (image/png)");
  await expect(page.getByText("Отправим, как только загрузятся файлы")).toHaveCount(0);
  expect(sent).toHaveLength(1);
});

test("загрузка упала во время ожидания: ни одного сообщения, у поля сказано, что оно не отправлено", async ({ page }) => {
  await signIn(page, "Анна", "/", "default");
  const upload = await holdUpload(page);
  const sent = countMessageRequests(page);
  await page.locator('input[type="file"]').setInputFiles([shot]);
  await upload.waitForHold();

  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.fill("Что на скрине?");
  await field.press("Enter");
  await expect(page.getByText("Отправим, как только загрузятся файлы")).toBeVisible();

  await upload.release("fail");
  await expect(page.getByRole("alert")).toContainText("Сообщение не отправлено. Файл «скрин.png»");
  await expect(page.getByText("Отправим, как только загрузятся файлы")).toHaveCount(0);
  await expect(field).toHaveValue("Что на скрине?");
  expect(sent).toHaveLength(0);
});
