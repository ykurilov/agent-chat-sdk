import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signIn } from "./support/chat";
import { saveScreenshot, screenshotFolder } from "./support/screen";

/*
 * Экран «Серверы MCP» (фича 078): админ подключает поддельный сервис стенда, видит инструменты, включает один,
 * проверяет связь, меняет название и заменяет заголовок в форме правки. Ключ из адреса и значения заголовка на
 * страницу не попадают. Не админу экрана нет, API — 404.
 * Сервер добавляется выключенным и удаляется в конце: соседние тесты его инструментов не видят.
 */

const screenshotDir = screenshotFolder("agent-chat-e2e");
const apiPort = Number(process.env.DEMO_E2E_API_PORT ?? 8931);
const URL_KEY = "e2e-url-key-5d1c";
const TOKEN = "e2e-token-8a2f";
const NEW_TOKEN = "e2e-token-new-3c7e";

async function screenshotInBothThemes(page: Page, name: string) {
  await saveScreenshot(page, screenshotDir, `${name}-light`);
  await page.getByRole("button", { name: "Тёмная тема" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await saveScreenshot(page, screenshotDir, `${name}-dark`);
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
}

test("админ подключает сервер MCP, включает инструмент, проверяет связь, правит; секретов на странице нет", async ({ page }) => {
  const prefix = `e2e${Date.now() % 1_000_000}`;
  await signIn(page, "Анна");
  await page.goto("/mcp");
  await page.getByRole("button", { name: "Добавить сервер" }).click();

  const form = page.getByRole("form", { name: "Добавить сервер" });
  await form.getByRole("textbox", { name: /Название/ }).fill("Документация стенда");
  await form.getByRole("textbox", { name: /Префикс/ }).fill(prefix);
  await form.getByRole("textbox", { name: /Адрес/ }).fill(`http://localhost:${apiPort}/api/demo/mcp?key=${URL_KEY}`);
  await form.getByRole("textbox", { name: "Имя заголовка" }).fill("Authorization");
  await form.getByLabel("Значение").fill(`Bearer ${TOKEN}`);
  await form.getByRole("radio", { name: "Выключен" }).click();
  await form.getByRole("button", { name: "Подключить" }).click();

  const card = page.getByRole("group", { name: "Документация стенда" });
  await expect(card).toBeVisible();
  await expect(card.getByText("параметры скрыты", { exact: false })).toBeVisible();
  await expect(card.getByText("Authorization: задан")).toBeVisible();

  const search = card.getByRole("group", { name: `${prefix}__search_docs` });
  await expect(search.getByText("только чтение")).toBeVisible();
  const enabled = search.getByRole("switch", { name: "Включён" });
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(card.getByRole("group", { name: `${prefix}__create_ticket` }).getByRole("switch", { name: "Спрашивать подтверждение" })).toBeChecked();

  await card.getByRole("button", { name: "Проверить связь" }).click();
  await expect(card.getByText(/Связь есть .*инструментов: 2/)).toBeVisible();

  await card.getByRole("button", { name: "Изменить" }).click();
  const edit = card.getByRole("form", { name: "Изменить сервер" });
  await expect(edit.getByRole("textbox", { name: /Адрес/ })).toHaveValue("");
  const authorization = edit.getByRole("group", { name: "Authorization" });
  await expect(authorization.getByText("Authorization: задан")).toBeVisible();
  await authorization.getByRole("button", { name: "Заменить" }).click();
  await authorization.getByLabel("Значение").fill(`Bearer ${NEW_TOKEN}`);
  await edit.getByRole("textbox", { name: /Название/ }).fill("Документация стенда, правка");
  await edit.scrollIntoViewIfNeeded();
  await screenshotInBothThemes(page, "mcp-admin-edit");
  await edit.getByRole("button", { name: "Сохранить" }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Документация стенда, правка" })).toBeVisible();
  await expect(card.getByText("Authorization: задан")).toBeVisible();
  await expect(card.getByText("параметры скрыты", { exact: false })).toBeVisible();

  const html = await page.content();
  for (const secret of [URL_KEY, TOKEN, NEW_TOKEN]) expect(html).not.toContain(secret);
  const answer = await page.request.get("/api/mcp/servers");
  expect(await answer.text()).not.toMatch(new RegExp(`${URL_KEY}|${TOKEN}|${NEW_TOKEN}`));

  await card.scrollIntoViewIfNeeded();
  await screenshotInBothThemes(page, "mcp-admin");

  await card.getByRole("button", { name: "Удалить" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(card).toHaveCount(0);
});

test("не админ: экрана серверов MCP нет, API отвечает 404", async ({ page }) => {
  await signIn(page, "Борис");
  await page.goto("/mcp");
  await expect(page.getByText("Страница не найдена.")).toBeVisible();
  for (const path of ["/api/mcp/servers", "/api/mcp/calls", "/api/mcp/servers/any"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  expect((await page.request.post("/api/mcp/servers", { data: {} })).status()).toBe(404);
});
