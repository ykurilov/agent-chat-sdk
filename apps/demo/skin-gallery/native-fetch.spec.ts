import { expect, test } from "@playwright/test";
for (const theme of ["light", "dark"]) test(`native Window.fetch upload and all delete paths (${theme})`, async ({ page }) => {
  const posts: string[] = [], deleted: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/native-files/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "DELETE") { deleted.push(path); await route.fulfill({ status: 204 }); return; }
    if (request.method() === "POST") {
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      expect(request.postDataBuffer()?.toString()).toContain("native.png");
      posts.push(path);
      await route.fulfill({ status: 201, json: { id: "device-id", name: "native.png", mediaType: "image/png", kind: "image", size: 10 } }); return;
    }
    await route.fulfill({ json: { maxFiles: 10, maxFileBytes: 20000000, maxMessageTextTokens: 100000, accept: "image/png" } });
  });
  await page.goto(`/native-fetch.html?theme=${theme}`);
  // A native browser fetch fails before reaching routing if called with this=item.
  await page.locator('input[type="file"]').setInputFiles({ name: "native.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(page.locator(".oduvanchik-field-files")).toContainText("native.png");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled({ timeout: 3000 });
  expect(posts).toEqual(["/native-files/one/attachments"]);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator("output")).toContainText("attachment:device-id");
  await page.locator(".oduvanchik-field-files button").click();
  await expect.poll(() => deleted).toEqual(["/native-files/one/attachments/device-id"]);
  // Successful server file, then ordinary remove.
  await page.getByRole("button", { name: "Добавить серверный файл" }).click();
  await page.getByRole("button", { name: "Завершить ingest" }).click();
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
  await page.locator(".oduvanchik-field-files button").click();
  await expect.poll(() => deleted.length).toBe(2);
  // Late server success after remove uses the same native fetch, still bound to the original chat.
  await page.getByRole("button", { name: "Добавить серверный файл" }).click();
  await page.locator(".oduvanchik-field-files button").click();
  await page.getByRole("button", { name: "Другой чат" }).click();
  await page.getByRole("button", { name: "Завершить ingest" }).click();
  await expect.poll(() => deleted).toEqual(["/native-files/one/attachments/device-id", "/native-files/one/attachments/server-id", "/native-files/one/attachments/server-id"]);
  await expect(page.locator("output")).toHaveAttribute("data-items", "0");
  expect(errors).toEqual([]);
});
