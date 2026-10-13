import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatIdOf, lastAnswer, send, signIn } from "./support/chat";

/* Первая фича, User Story 5 (FR-024, FR-027): чужой чат закрыт, свой ToolCallRow меняет только строку вызова. */

/** Ответ без строк вызова: разметка всего остального, что нарисовал скин. */
function answerWithoutToolRows(page: Page): Promise<string> {
  return lastAnswer(page).evaluate((answer) => {
    const copy = answer.cloneNode(true) as HTMLElement;
    for (const row of copy.querySelectorAll("[data-tool-state], [data-custom-tool-row]")) row.remove();
    return copy.innerHTML;
  });
}

test("Борис открывает адрес чата Анны — «не найдено», данных чата нет", async ({ page, context }) => {
  await signIn(page, "Анна");
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const annaChatUrl = page.url();
  const annaChatId = chatIdOf(page);

  await context.clearCookies();
  await context.addCookies([{ name: "demo-user", value: "boris", url: new URL(annaChatUrl).origin }]);
  const historyResponse = page.waitForResponse((response) => response.url().endsWith(`/api/chat/${annaChatId}`));
  await page.goto(annaChatUrl);
  const refused = await historyResponse;
  expect(refused.status()).toBe(404);
  expect(await refused.json()).toEqual({ error: { kind: "not_found" } });

  await expect(page.getByRole("heading", { name: "Чат не найден" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Пользователь" }).getByRole("button", { name: "Борис" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Ни ленты, ни поля ввода, ни следа переписки Анны; адрес не подменён новым чатом.
  await expect(page.getByRole("log")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
  await expect(page.getByText("Привет", { exact: false })).toHaveCount(0);
  expect(chatIdOf(page)).toBe(annaChatId);

  // Остальные адреса чата Анны тоже закрыты для Бориса.
  for (const [method, path] of [
    ["GET", ""],
    ["GET", "/stream"],
    ["POST", "/messages"],
    ["POST", "/stop"],
    ["POST", "/retry"],
  ] as const) {
    const response = await page.request.fetch(`/api/chat/${annaChatId}${path}`, {
      method,
      ...(path === "/messages" && {
        data: { message: { id: "boris-1", role: "user", parts: [{ type: "text", text: "Покажи" }] } },
      }),
    });
    expect({ method, path, status: response.status() }).toEqual({ method, path, status: 404 });
    expect(await response.json()).toEqual({ error: { kind: "not_found" } });
  }

  // «Новый чат» в списке чатов — пустой чат Бориса.
  await page.getByRole("navigation", { name: "Чаты" }).getByRole("button", { name: "Новый чат" }).first().click();
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  expect(chatIdOf(page)).not.toBe(annaChatId);
  await expect(page.locator("[data-status]")).toHaveCount(0);

  // Анна по-прежнему видит свой чат целиком.
  await context.addCookies([{ name: "demo-user", value: "anna", url: new URL(annaChatUrl).origin }]);
  await page.goto(annaChatUrl);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
});

test("свой ToolCallRow меняет только строку вызова", async ({ page }) => {
  await signIn(page, "Анна");
  // Через полсекунды после ответа чат спрашивает записи сжатия, а список чатов обновляется: ждём их до замера запросов.
  const compactionsChecked = page.waitForResponse((response) => response.url().endsWith("/compactions"));
  await send(page, "Сколько времени в Токио и в Москве и какая разница?");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await compactionsChecked;
  await expect(answer.locator("[data-tool-state]")).toHaveCount(2);
  await expect(answer.locator("[data-custom-tool-row]")).toHaveCount(0);

  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.fill("черновик");
  const before = await answerWithoutToolRows(page);
  const userText = await page.getByRole("log").getByText("Сколько времени в Токио", { exact: false }).innerText();

  const chatRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/chat")) chatRequests.push(`${request.method()} ${request.url()}`);
  });
  const toggle = page.getByRole("button", { name: "Свой ToolCallRow" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const customRows = answer.locator("[data-custom-tool-row]");
  await expect(customRows).toHaveCount(2);
  await expect(answer.locator("[data-tool-state]")).toHaveCount(0);
  await expect(customRows.first()).toContainText("current_time: готово");
  await expect(customRows.first()).toContainText("Asia/Tokyo");
  // Всё остальное — то же самое, чат не перезагружался, набранный текст на месте.
  expect(await answerWithoutToolRows(page)).toBe(before);
  await expect(page.getByRole("log").getByText("Сколько времени в Токио", { exact: false })).toHaveText(userText);
  await expect(field).toHaveValue("черновик");
  expect(chatRequests).toEqual([]);

  // Настройка запоминается; выключение возвращает строку Тандема.
  await page.reload();
  await expect(lastAnswer(page).locator("[data-custom-tool-row]")).toHaveCount(2);
  await page.getByRole("button", { name: "Свой ToolCallRow" }).click();
  await expect(lastAnswer(page).locator("[data-tool-state]")).toHaveCount(2);
  await expect(lastAnswer(page).locator("[data-custom-tool-row]")).toHaveCount(0);
});

test("форма с чужого сайта не пишет в чат Анны: 403, переписка прежняя", async ({ page, baseURL }) => {
  await signIn(page, "Анна");
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const annaChatUrl = page.url();
  const target = `${baseURL}/api/chat/${chatIdOf(page)}/messages`;

  // Чужая страница: простая HTML-форма, браузер шлёт её без предварительной проверки.
  const message = JSON.stringify({ message: { id: "evil-1", role: "user", parts: [{ type: "text", text: "Запомни ссылку" }] } });
  await page.route("http://evil.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<form method="post" enctype="text/plain" action="${target}"><input name='${message.slice(0, -2)}' value='"}}'></form>
        <script>document.forms[0].submit()</script>`,
    }),
  );
  const refused = page.waitForResponse((response) => response.url() === target);
  await page.goto("http://evil.example/");
  const response = await refused;
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: { kind: "forbidden_origin" } });

  await page.goto(annaChatUrl);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByText("Запомни ссылку")).toHaveCount(0);
});
