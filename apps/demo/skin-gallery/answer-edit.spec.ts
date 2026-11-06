import { test, expect } from "@playwright/test";
for (const theme of ["light", "dark"]) test(`ordinary answer editor, app field and cancel (${theme})`, async ({ page }, info) => {
  let edited = false; const writes: unknown[] = [];
  await page.route("**/edit-fixture/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/answer-edit")) {
      writes.push(route.request().postDataJSON()); edited = true;
      return route.fulfill({ json: { messageId: "a2" } });
    }
    if (path === "/edit-fixture/one") return route.fulfill({ json: { chat: { id: "one" }, running: false, capabilities: { answerEditing: true, modelChoice: false, modelDetails: false, branches: false }, messages: [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Проверим ответ" }] },
      { id: edited ? "a2" : "a1", role: "assistant", metadata: { status: "complete" }, parts: [{ type: "text", text: edited ? "Ответ после правки" : "Исходный ответ" }] },
    ] } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`/answer-edit.html?theme=${theme}`);
  await expect(page.getByText("Исходный ответ", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Изменить ответ", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("position", "fixed");
  const bounds = await dialog.boundingBox(); const viewport = page.viewportSize()!;
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(2);
  const background = await dialog.evaluate(node => getComputedStyle(node).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Изменить ответ", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Изменить ответ", exact: true }).fill("Ответ после правки");
  await dialog.getByRole("textbox", { name: "Почему так лучше", exact: true }).fill("Короче и точнее");
  await page.screenshot({ path: info.outputPath(`answer-edit-${theme}.png`), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Ответ после правки", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([{ text: "Ответ после правки", data: { why: "Короче и точнее" } }]);
});
