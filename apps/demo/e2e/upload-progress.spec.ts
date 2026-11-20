import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { makeNoisyPng, makePng } from "./support/sample-files";
import { signIn } from "./support/chat";

/*
 * Прогресс загрузки файла в поле ввода: видно, сколько отправлено, и что файлы грузятся по два сразу. И кнопка
 * «Отправить» Одуванчика после загрузки одних картинок — со стрелкой, а не сплошной круг.
 */

const shot = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(makePng(8, [30, 120, 220])) });
const progressbars = (page: Page) => page.getByRole("progressbar");

/**
 * Сервер демо читает загрузку медленно, и браузер отправляет не быстрее: прогресс растёт, как на медленной сети.
 * Первые мегабайты сразу забирают буферы прокси и системы, поэтому файл — около 6 МБ.
 */
async function slowUploads(page: Page, bytesPerSecond: number) {
  await page.context().addCookies([{ name: "demo-slow-upload", value: String(bytesPerSecond), domain: "localhost", path: "/" }]);
}

/** Все значения полос прогресса, какие страница показывала, по порядку — по каждому файлу. */
async function recordProgress(page: Page) {
  await page.evaluate(() => {
    const seen: Record<string, number[]> = {};
    (window as unknown as { seenProgress: typeof seen }).seenProgress = seen;
    const note = () => {
      for (const bar of document.querySelectorAll("[role=progressbar]")) {
        const name = bar.getAttribute("aria-label") ?? "";
        const value = Number(bar.getAttribute("aria-valuenow"));
        const values = (seen[name] ??= []);
        if (values.at(-1) !== value) values.push(value);
      }
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-valuenow"] });
  });
  return () => page.evaluate(() => (window as unknown as { seenProgress: Record<string, number[]> }).seenProgress);
}

/**
 * Загрузки держатся, пока тест не отпустит: так видно, сколько их идёт сразу и какие файлы. `releaseAll` — отпустить
 * держащиеся и дальше не держать (повтор после «сервер занят» тоже пройдёт).
 */
async function holdUploads(page: Page) {
  const held: { route: Route; file: string; released?: boolean }[] = [];
  let holding = true;
  await page.route("**/api/chat/*/attachments", (route) => {
    if (route.request().method() !== "POST" || !holding) return route.continue();
    held.push({ route, file: /filename="([^"]+)"/.exec(route.request().postDataBuffer()?.toString("latin1") ?? "")?.[1] ?? "" });
  });
  return {
    files: () => held.map((upload) => upload.file),
    release: (file: string) => {
      const upload = held.find((candidate) => candidate.file === file && !candidate.released)!;
      upload.released = true;
      return upload.route.continue();
    },
    releaseAll: async () => {
      holding = false;
      for (const upload of held.filter((candidate) => !candidate.released)) {
        upload.released = true;
        await upload.route.continue();
      }
    },
  };
}

for (const skin of ["tandem", "default"] as const) {
  test(`${skin}: медленная загрузка — полоса и процент растут до конца, на 100 % — «загружается», готовый файл без полосы`, async ({ page }) => {
    await signIn(page, "Анна", "/", skin);
    const seen = await recordProgress(page);
    await slowUploads(page, 1_200_000);
    await page.locator('input[type="file"]').setInputFiles([{ name: "большой.png", mimeType: "image/png", buffer: Buffer.from(makeNoisyPng(1400)) }]);

    const bar = page.getByRole("progressbar", { name: "Загрузка «большой.png»" });
    await expect(bar).toBeVisible();
    const chip = page.getByRole("list", { name: "Вложения" }).locator("li").filter({ has: page.getByRole("button", { name: "Убрать большой.png" }) });
    // Пока идёт отправка — процент текстом.
    await expect(chip.getByText(/\d+\s%/)).toBeVisible();
    // Всё отправлено, а сервер ещё читает файл: процента нет, снова «загружается» — значок ожидания у картинки Тандема.
    await expect(bar).toHaveAttribute("aria-valuenow", "100", { timeout: 20_000 });
    await expect(chip.getByText(/\d+\s%/)).toHaveCount(0);
    if (skin === "default") await expect(chip.getByText(/Загружается…/)).toBeVisible();
    else await expect(chip.locator(".tandem-spinner")).toBeVisible();
    await expect(bar).toHaveCount(0, { timeout: 20_000 });

    const values = (await seen())["Загрузка «большой.png»"] ?? [];
    // Растёт по шагам, без откатов, и доходит до конца.
    expect(values.filter((value) => value > 0 && value < 100).length).toBeGreaterThanOrEqual(3);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(100);
  });
}

test("пять картинок: грузятся ровно две сразу, у обеих полоса; остальные ждут без полосы", async ({ page }) => {
  await signIn(page, "Анна", "/", "default");
  const uploads = await holdUploads(page);
  await page.locator('input[type="file"]').setInputFiles(["1", "2", "3", "4", "5"].map((n) => shot(`photo-${n}.png`)));

  await expect.poll(uploads.files).toEqual(["photo-1.png", "photo-2.png"]);
  await expect(progressbars(page)).toHaveCount(2);
  await expect(page.getByText(/photo-3\.png · Загружается…/)).toBeVisible();
  // Третья загрузка не начинается сама, пока идут две.
  await page.waitForTimeout(500);
  expect(uploads.files()).toEqual(["photo-1.png", "photo-2.png"]);

  // Одна закончилась — сразу начинается следующая, снова две сразу.
  await uploads.release("photo-1.png");
  await expect.poll(uploads.files).toEqual(["photo-1.png", "photo-2.png", "photo-3.png"]);
  await expect(progressbars(page)).toHaveCount(2);

  await uploads.releaseAll();
  await expect(page.getByText("Загружается")).toHaveCount(0);
  await expect(progressbars(page)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Вложения" }).locator("li")).toHaveCount(5);
});

test("Одуванчик: после загрузки одних картинок «Отправить» — со стрелкой, в светлой и тёмной теме", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, "Анна", "/", "default");
  await page.locator('input[type="file"]').setInputFiles([shot("a.png"), shot("b.png")]);
  await expect(page.getByRole("list", { name: "Вложения" }).locator("li")).toHaveCount(2);
  await expect(page.getByText("Загружается")).toHaveCount(0);

  const send = page.getByRole("button", { name: "Отправить" });
  await expect(send).toBeEnabled();
  const look = () => send.evaluate((button) => {
    const arrow = button.querySelector("svg");
    const box = arrow?.getBoundingClientRect();
    return {
      path: arrow?.querySelector("path")?.getAttribute("d") ?? "",
      size: box ? Math.min(box.width, box.height) : 0,
      arrow: arrow ? getComputedStyle(arrow).color : "",
      background: getComputedStyle(button).backgroundColor,
    };
  });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const { path, size, arrow, background } = await look();
    expect(path.length).toBeGreaterThan(20);
    expect(size).toBeGreaterThanOrEqual(16);
    expect(arrow).not.toBe(background);
    await testInfo.attach(`кнопка-отправить-${scheme}`, { body: await page.locator(".oduvanchik-field").screenshot(), contentType: "image/png" });
  }
});
