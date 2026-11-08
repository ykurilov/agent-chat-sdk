import { test, expect } from "@playwright/test";
for (const theme of ["light", "dark"]) for (const width of [390, 1100]) test(`AppShell ${theme} ${width}`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const chats = Array.from({ length: 25 }, (_, i) => ({ id: `c${i+1}`, title: `Разговор ${i+1}`, createdAt: "2026-01-01", updatedAt: "2026-01-02" }));
  await page.route("**/app-shell-fixture**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/watch")) return route.fulfill({ contentType: "text/event-stream", body: ": open\n\n" });
    if (url.pathname === "/app-shell-fixture") {
      if (route.request().method() === "POST") { chats.unshift({ id: "new", title: "Новый разговор", createdAt: "2026-01-01", updatedAt: "2026-01-02" }); return route.fulfill({ json: { id: "new" } }); }
      return route.fulfill({ json: { chats } });
    }
    if (route.request().method() === "PATCH") {
      const chat = chats.find(chat => chat.id === url.pathname.split("/")[2])!;
      chat.title = route.request().postDataJSON().title;
      return route.fulfill({ json: { id: chat.id, title: chat.title } });
    }
    if (route.request().method() === "DELETE") {
      chats.splice(chats.findIndex(chat => chat.id === url.pathname.split("/")[2]), 1);
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.endsWith("/models")) return route.fulfill({ json: { providers: [] } });
    const id = url.pathname.split("/")[2];
    return route.fulfill({ json: { chat: { id }, messages: [{ id: `a-${id}`, role: "assistant", parts: [{ type: "text", text: `Ответ ${id}` }], metadata: { status: "complete" } }], running: false, forks: [], compactions: [], compacting: false, capabilities: { chatList: true, modelChoice: false } } });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/app-shell-chat.html?theme=${theme}`);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  if (width < 700) await page.getByRole("button", { name: "Открыть навигацию" }).click();
  await expect(page.getByRole("button", { name: "Разговор 1", exact: true })).toBeVisible();
  await expect(page.locator(".yk-app-shell__group .yk-app-shell__item svg")).toHaveCount(1); // Only More's caret, no chat icons.
  await page.screenshot({ path: info.outputPath(`shell-${theme}-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "Ещё 22", exact: true }).click();
  await page.getByRole("button", { name: "Разговор 25", exact: true }).click();
  await expect(page.getByText("Ответ c25", { exact: true })).toBeVisible();
  if (width < 700) {
    await expect(page.getByRole("dialog", { name: "Навигация приложения" })).not.toBeVisible();
    await page.getByRole("button", { name: "Открыть навигацию" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Открыть навигацию" })).toBeFocused();
    await page.getByRole("button", { name: "Открыть навигацию" }).click();
  } else {
    await page.getByRole("button", { name: "Свернуть навигацию" }).click();
    await expect(page.locator(".yk-app-shell--collapsed")).toBeVisible();
    await expect(page.locator(".yk-app-shell__group")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`collapsed-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Развернуть навигацию" }).click();
  }
  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.getByText("Ответ new", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Чаты", exact: true }).click();
  const management = page.getByRole("dialog", { name: "Чаты", exact: true });
  await expect(management).toBeVisible();
  await management.getByRole("button", { name: "Действия с чатом «Разговор 1»", exact: true }).click();
  await page.getByRole("menuitem", { name: "Переименовать", exact: true }).click();
  await management.getByRole("textbox", { name: "Название чата" }).fill("Новое название");
  await management.getByRole("textbox", { name: "Название чата" }).press("Enter");
  await expect(management.getByRole("button", { name: "Новое название", exact: true })).toBeVisible();
  await management.getByRole("button", { name: "Действия с чатом «Новое название»", exact: true }).click();
  await page.getByRole("menuitem", { name: "Удалить", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Удалить чат?", exact: true });
  await expect(deletion).toBeVisible();
  expect(chats.some(chat => chat.id === "c1")).toBe(true);
  await deletion.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(management.getByRole("button", { name: "Новое название", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(management).not.toBeVisible();
  if (width < 700) await page.getByRole("button", { name: "Открыть навигацию" }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Настройки", exact: true })).toBeVisible();
  await expect(page.getByText("Как в системе", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
