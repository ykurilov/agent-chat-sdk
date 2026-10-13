import type { Page } from "@playwright/test";
import { makePdf, makePng } from "./support/sample-files";
import { expect, test } from "@playwright/test";
import { test as ownServerTest } from "./support/own-server";
import { feedThumbnail, lastAnswer, send, signIn } from "./support/chat";

/*
 * Восьмая фича: вложения к сообщению. Один сценарий проходит от скрепки до ленты после перезагрузки;
 * перетаскивание, вставка, удаление превью и отказ — короткие отдельные проверки. Заглушка модели отвечает по тому, что до неё дошло.
 */

const redSquare = { name: "квадрат.png", mimeType: "image/png", buffer: Buffer.from(makePng(8, [220, 30, 30])) };
const notes = { name: "заметки.txt", mimeType: "text/plain", buffer: Buffer.from("Код сейфа 4471, не забыть.") };
const invoice = { name: "счёт.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf(["ZEBRA-4471 total due"])) };

const fileInput = (page: Page) => page.locator('input[type="file"]');
const attachmentList = (page: Page) => page.getByRole("list", { name: "Вложения" });

/** Файл, брошенный на поле ввода или вставленный в него, как это делает браузер. */
async function dropOrPaste(page: Page, kind: "drop" | "paste", file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.evaluate(
    ({ kind, name, mimeType, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
      const field = document.querySelector("textarea")!;
      const target = kind === "paste" ? field : field.closest<HTMLElement>("div.relative")!;
      const event =
        kind === "paste"
          ? new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
          : new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    },
    { kind, name: file.name, mimeType: file.mimeType, bytes: [...file.buffer] },
  );
}

test("картинка, текстовый файл и PDF: превью в поле, миниатюра и плашки в ленте, ответ по содержимому, всё на месте после перезагрузки", async ({ page }) => {
  await signIn(page);
  await fileInput(page).setInputFiles([redSquare, notes, invoice]);
  const field = page.getByRole("list", { name: "Вложения" });
  await expect(field.getByAltText("квадрат.png")).toBeVisible();
  await expect(field.getByText("заметки.txt")).toBeVisible();
  await expect(field.getByText("счёт.pdf")).toBeVisible();

  const sendButton = page.getByRole("button", { name: "Отправить" });
  await expect(sendButton).toBeEnabled();
  await send(page, "Что тут?");
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveValue("");
  await expect(attachmentList(page)).toHaveCount(1); // в поле пусто, остался только список в ленте

  const answer = lastAnswer(page);
  await expect(answer).toContainText("Вижу картинку (image/png)");
  await expect(answer).toContainText("Прочитал файл «заметки.txt»: Код сейфа 4471");
  await expect(answer).toContainText("Прочитал файл «счёт.pdf»: ZEBRA-4471");

  await expect(feedThumbnail(page, "квадрат.png")).toBeVisible();
  await page.reload();
  await expect(lastAnswer(page)).toContainText("Прочитал файл «счёт.pdf»: ZEBRA-4471");
  const thumbnail = feedThumbnail(page, "квадрат.png").locator("img");
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("log").getByRole("link", { name: /счёт\.pdf/ })).toHaveAttribute("href", /\/attachments\//);
});

test("большое фото уменьшается при загрузке: в ленте и у модели копия 2000 пикселей по длинной стороне", async ({ page }) => {
  await signIn(page);
  // Фото 4000×3000 рисуется в браузере: JPEG такого размера в репозиторий не кладём.
  await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 4000, height: 3000 });
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#c87828";
    context.fillRect(0, 0, 4000, 3000);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result!), "image/jpeg", 0.9));
    const data = new DataTransfer();
    data.items.add(new File([blob], "фото.jpg", { type: "image/jpeg" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(attachmentList(page).getByAltText("фото.jpg")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  await send(page, "Что на фото?");
  await expect(lastAnswer(page)).toContainText("Вижу картинку (image/jpeg)");

  const thumbnail = feedThumbnail(page, "фото.jpg").locator("img");
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([2000, 1500]);
});

test("файл можно перетащить и вставить из буфера; лишний файл убирается кнопкой", async ({ page }) => {
  await signIn(page);
  await dropOrPaste(page, "drop", notes);
  await expect(page.getByText("заметки.txt")).toBeVisible();
  await dropOrPaste(page, "paste", redSquare);
  await expect(page.getByAltText("квадрат.png")).toBeVisible();

  await page.getByRole("button", { name: "Убрать заметки.txt" }).click();
  await expect(page.getByText("заметки.txt")).toHaveCount(0);
  await expect(page.getByAltText("квадрат.png")).toBeVisible();
});

test("неподдерживаемый файл: понятная причина, отправка закрыта, пока файл не убран", async ({ page }) => {
  await signIn(page);
  await fileInput(page).setInputFiles({ name: "программа.exe", mimeType: "application/octet-stream", buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]) });
  await expect(page.getByRole("alert")).toContainText("программа.exe");
  await expect(page.getByRole("alert")).toContainText("не поддерживается");

  await page.getByRole("textbox", { name: "Сообщение" }).fill("Открой");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.locator("[data-status]")).toHaveCount(0);

  await page.getByRole("button", { name: "Убрать программа.exe" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(lastAnswer(page)).toBeVisible();
});

ownServerTest.describe("модель не видит картинки", () => {
  ownServerTest.use({ modelsWithoutImages: true });

  ownServerTest("пометка до отправки; текст файла модель всё равно получает, картинку — нет", async ({ page }) => {
    await signIn(page);
    await fileInput(page).setInputFiles([redSquare, notes]);
    await expect(page.getByRole("alert")).toContainText("не видит картинки");

    await page.getByRole("button", { name: "Отправить" }).click();
    const answer = lastAnswer(page);
    await expect(answer).toContainText("Картинку «квадрат.png» не вижу.");
    await expect(answer).toContainText("Прочитал файл «заметки.txt»");
    await expect(feedThumbnail(page, "квадрат.png")).toBeVisible();
  });
});
