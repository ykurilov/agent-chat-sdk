import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, saveScreenshot, screenshotFolder } from "../e2e/support/screen";
const folder = screenshotFolder("agent-chat-oduvanchik-studio");

test("Studio: empty/dialog/working, themes, independent scroll, composer and keyboard Sheet", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const phone = viewport.width < 700;
    for (const theme of ["light", "dark"]) for (const state of ["empty", "dialog", "working"]) {
      await page.goto(`/oduvanchik-studio.html?theme=${theme}&state=${state}`);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".yk-studio__main")).toHaveCSS("border-radius", "20px");
      if (!phone) await expect(page.locator(".yk-studio__inspector")).toHaveCSS("border-radius", "20px");
      const field = page.getByRole("textbox", { name: "Сообщение" });
      await expect(field).toBeVisible();
      await expect.poll(() => page.locator(".oduvanchik-studio-title canvas").evaluate((canvas) => {
        const el = canvas as HTMLCanvasElement; const pixels = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
        let orange = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3]! > 20 && pixels[index]! > pixels[index + 1]! && pixels[index + 1]! > pixels[index + 2]!) orange++; return orange;
      })).toBeGreaterThan(0);
      await expect(page.locator(".oduvanchik-field")).toHaveCSS("border-radius", "18px");
      if (state === "empty") await expect(page.getByRole("heading", { name: "Проверим, как агент ведёт разговор?" })).toBeVisible();
      const scroll = page.locator(".oduvanchik-thread-scroll");
      await expect(scroll).toHaveCSS("scrollbar-gutter", "stable");
      await expect(scroll).toHaveCSS("padding-right", "16px");
      if (state !== "empty") {
        await expect(page.locator(".oduvanchik-agent-body .tandem-markdown").last()).toHaveCSS("font-size", "15px");
        await expect(page.locator(".oduvanchik-agent-body .tandem-markdown").last()).toHaveCSS("line-height", "27px");
        const composer = await page.locator(".oduvanchik-composer-wrap").boundingBox();
        await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const after = await page.locator(".oduvanchik-composer-wrap").boundingBox();
        expect(after!.y).toBe(composer!.y);
        const geometry = await scroll.evaluate((el) => { const content = el.querySelector('[role="log"]')!.getBoundingClientRect(); const rect = el.getBoundingClientRect(); return { gap: rect.right - content.right - ((el as HTMLElement).offsetWidth - el.clientWidth), width: content.width }; });
        expect(geometry.gap).toBeGreaterThanOrEqual(15.5);
        expect(geometry.width).toBeLessThanOrEqual(730);
        if (phone) {
          const trigger = page.getByRole("button", { name: "Открыть журнал" });
          await trigger.focus(); await page.keyboard.press("Enter");
          const sheet = page.getByRole("dialog", { name: "Журнал", exact: true });
          await expect(sheet).toBeVisible();
          await page.keyboard.press("Tab");
          expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
          await saveScreenshot(page, folder, `studio-${state}-${theme}-phone-journal`);
          await page.keyboard.press("Escape");
          await expect(sheet).toHaveCount(0); await expect(trigger).toBeFocused();
        } else {
          const originalTop = await scroll.evaluate((el) => el.scrollTop);
          const journal = page.locator(".oduvanchik-journal-scroll");
          await journal.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          expect(await scroll.evaluate((el) => el.scrollTop)).toBe(originalTop);
          await journal.evaluate((el) => { el.scrollTop = 0; });
        }
      }
      await expectNoHorizontalOverflow(page);
      await saveScreenshot(page, folder, `studio-${state}-${theme}-${phone ? 'phone' : 'desktop'}`);
      const mic = page.getByRole("button", { name: "Диктовать" });
      const send = page.getByRole("button", { name: state === "working" ? "Остановить" : "Отправить", exact: true });
      expect(await mic.evaluate((el) => el.parentElement?.nextElementSibling?.tagName)).toBe("BUTTON");
      await mic.click(); await expect(page.getByRole("button", { name: "Остановить диктовку" })).toBeVisible();
      if (state === "working") { await send.click(); await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeVisible(); }
    }
  }
  expect(errors).toEqual([]);
});
