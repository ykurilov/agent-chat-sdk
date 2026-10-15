import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Экран навыков агента (фича 077): один сценарий админа от создания до удаления и проверка, что не-админу экрана нет.
 * Логику списка в контексте и `use_skill` проверяют модульные тесты пакета; здесь — что экран, скин и сервер работают вместе.
 * Навык выключен почти всё время: соседние тесты идут на том же сервере, и список навыков не должен попадать в их запросы.
 */

const screenshotDir = screenshotFolder("agent-chat-e2e");

async function signInAs(page: Page, user: "anna" | "boris") {
  await page.context().addCookies([{ name: "demo-user", value: user, domain: "localhost", path: "/" }]);
}

test("админ создаёт навык, правит, смотрит разницу, откатывает и удаляет; предпросмотр не исполняет HTML", async ({ page }) => {
  const name = `игры-${Date.now()}`;
  await signInAs(page, "anna");
  await page.goto("/skills");
  await expect(page.getByRole("heading", { name: "Навыки агента" })).toBeVisible();

  await page.getByRole("button", { name: "Новый навык" }).click();
  await page.getByLabel("Имя", { exact: true }).fill(name);
  await page.getByLabel("Когда брать").fill("Когда просят сделать игру.");
  await page.getByRole("textbox", { name: "Указания (markdown)" }).fill(
    '# Разработка игр\n\nДелай на **canvas**.\n\n<img src="x" onerror="window.skillXss = 1">\n\n[ссылка](javascript:window.skillXss=2)',
  );
  await page.getByRole("tab", { name: "Предпросмотр" }).click();
  const preview = page.getByTestId("skill-preview");
  await expect(preview.getByRole("heading", { name: "Разработка игр" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("canvas");
  await expect(preview.locator("img")).toHaveCount(0);
  expect((await preview.getByText("ссылка").getAttribute("href")) ?? "").not.toMatch(/javascript/i);
  // Клик по обезвреженной ссылке ничего не делает: страница не перезагружается, черновик на месте.
  await preview.getByText("ссылка").click();
  await expect(preview.getByRole("heading", { name: "Разработка игр" })).toBeVisible();
  expect(await page.evaluate(() => (window as { skillXss?: number }).skillXss)).toBeUndefined();
  await page.getByRole("button", { name: "Сохранить" }).click();

  const listItem = page.getByRole("button", { name: new RegExp(name) });
  await expect(listItem).toContainText("Выключен");
  await expect(listItem).toContainText("Версия 1");

  // Статус меняется сразу, без сохранения, и не создаёт версию.
  const statuses = page.getByRole("radiogroup", { name: "Кому виден" });
  await statuses.getByRole("radio", { name: "Только админам" }).click();
  await expect(listItem).toContainText("Только админам");
  await statuses.getByRole("radio", { name: "Выключен" }).click();
  await expect(listItem).toContainText("Выключен");

  await page.getByRole("tab", { name: "Текст" }).click();
  await page.getByRole("textbox", { name: "Указания (markdown)" }).fill("# Разработка игр\n\nДелай на **canvas**, без библиотек.");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(listItem).toContainText("Версия 2");

  const versions = page.getByRole("list").filter({ hasText: "Версия 1 ·" });
  await versions.getByRole("listitem").first().getByRole("button", { name: "Что изменилось" }).click();
  await expect(page.locator('[data-diff="added"]', { hasText: "без библиотек" })).toBeVisible();
  await expect(page.locator('[data-diff="removed"]', { hasText: "<img" })).toBeVisible();

  // Снимки: экран целиком, от шапки формы до разницы версий.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.evaluate(() => document.querySelectorAll("main").forEach((element) => element.scrollTo(0, 0)));
  await saveScreenshot(page, screenshotDir, "skills-light");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await saveScreenshot(page, screenshotDir, "skills-dark");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Откат — новая версия с текстом старой.
  await page.getByRole("button", { name: "Вернуть версию 1" }).click();
  await expect(listItem).toContainText("Версия 3");
  await expect(page.getByRole("textbox", { name: "Указания (markdown)" })).toHaveValue(/onerror/);

  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("button", { name: "Да, удалить" }).click();
  await expect(listItem).toHaveCount(0);
  expect((await page.request.get(`/api/skills/${encodeURIComponent(name)}`)).status()).toBe(404);
});

test("не админ: экран «не найдено», API отвечает 404", async ({ page }) => {
  await signInAs(page, "boris");
  await page.goto("/skills");
  await expect(page.getByText("Не найдено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Новый навык" })).toHaveCount(0);
  for (const path of ["/api/skills", "/api/skills/any", "/api/skills/any/versions"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  expect((await page.request.post("/api/skills", { data: { name: "чужой", whenToUse: "w", body: "b" } })).status()).toBe(404);
});
