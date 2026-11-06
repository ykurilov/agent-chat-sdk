import { test, expect } from "@playwright/test";
for (const mode of ["replace", "hold"]) test(`replyChecks ${mode}: ранний текст исправлен, инструмент сохранён`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const chunks = [
    { type: "start", messageId: "a1" }, { type: "start-step" },
    { type: "text-start", id: "intro" }, { type: "text-delta", id: "intro", delta: mode === "replace" ? "Actually, это важно." : "На самом деле это важно." }, { type: "text-end", id: "intro" },
    { type: "tool-input-available", toolCallId: "lookup1", toolName: "lookup", input: {} },
    { type: "tool-output-available", toolCallId: "lookup1", output: { found: "ok" } },
    { type: "finish-step" }, { type: "start-step" },
    { type: "text-start", id: "final" }, { type: "text-delta", id: "final", delta: "Готово." }, { type: "text-end", id: "final" }, { type: "finish-step" },
    ...(mode === "replace" ? [{ type: "data-reply-text", data: { index: 0, text: "На самом деле это важно." } }] : []),
    { type: "message-metadata", messageMetadata: { status: "complete" } }, { type: "finish" },
  ];
  await page.route("**/reply-fixture/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/messages")) return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n" });
    if (path === "/reply-fixture/one") return route.fulfill({ json: { chat: { id: "one" }, running: false, capabilities: { modelChoice: false, modelDetails: false, branches: false }, messages: [] } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/reply-checks.html");
  await page.getByRole("textbox").fill("вопрос");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText("На самом деле это важно.", { exact: true })).toBeVisible();
  await expect(page.getByText("Готово.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("complete");
  await expect(page.getByTestId("tool")).toHaveCount(1);
  await expect(page.getByTestId("tool")).toContainText("lookup1");
  await expect(page.getByTestId("tool")).toContainText("output-available");
  await expect(page.locator("article")).not.toContainText("Actually");
  expect(errors).toEqual([]);
});
