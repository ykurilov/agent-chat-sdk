import { expect, test } from "@playwright/test";
import { send, signIn } from "./support/chat";
import { expectNoHorizontalOverflow, saveScreenshot } from "./support/screen";

/*
 * Живые демонстрации на узком экране (320 px): только то, что зависит от экрана. Логика — live-demos.spec.ts.
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: рамка помещается в ленту, касание по кнопке работает, страница вбок не едет", async ({ page }) => {
  await signIn(page);
  await send(page, "Покажи демонстрацию");
  const ready = page.locator('[data-live-demo="ready"]');
  await expect(ready).toBeVisible();

  const box = (await ready.locator("iframe").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.height).toBeLessThanOrEqual(Math.round((640 * 2) / 3));

  const demo = page.frameLocator('[data-live-demo="ready"] iframe').frameLocator("iframe");
  await demo.getByRole("button", { name: "Сбросить" }).tap();
  await expect(demo.locator("#value")).toHaveText("Скорость: 0");
  await expectNoHorizontalOverflow(page);
  await saveScreenshot(page, "/tmp/agent-chat-live-demos", "phone-320");
});
