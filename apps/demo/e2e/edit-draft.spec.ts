import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { lastAnswer, signIn } from "./support/chat";

// Сервер без прогрева: история после хода приходит, когда человек уже правит своё сообщение. Набранный текст
// переживает и это перечитывание, и прокрутку к длинному ответу и обратно.

const chatRead = /\/api\/chat\/[0-9a-f-]{36}(\/compactions)?$/;

/** Прокручивает ленту к началу или к концу. */
function scrollFeed(page: Page, to: "top" | "bottom") {
  return page.getByRole("log").evaluate((log, where) => {
    let scroller: HTMLElement | null = log as HTMLElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
    if (scroller) scroller.scrollTop = where === "top" ? 0 : scroller.scrollHeight;
  }, to);
}

test("правка сразу после конца ответа: набранный текст не сбрасывается", async ({ page }) => {
  await signIn(page);
  let holding = false;
  const held: Route[] = [];
  await page.route(chatRead, async (route) => {
    if (holding && route.request().method() === "GET") held.push(route);
    else await route.continue();
  });
  const composer = page.getByRole("textbox", { name: "Сообщение" });
  await composer.fill("Дай подробный ответ");
  holding = true;
  await composer.press("Enter");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect.poll(() => held.length).toBeGreaterThan(0);

  await scrollFeed(page, "top");
  await page.getByRole("button", { name: "Изменить сообщение" }).first().click();
  const editor = page.getByRole("textbox", { name: "Изменить сообщение" });
  await expect(editor).toHaveValue("Дай подробный ответ");
  await editor.fill("Новый текст");

  const reread = page.waitForResponse((response) => chatRead.test(response.url()) && response.request().method() === "GET");
  holding = false;
  for (const route of held.splice(0)) await route.continue();
  await reread;

  await scrollFeed(page, "bottom");
  await expect(lastAnswer(page)).toBeInViewport();
  await scrollFeed(page, "top");
  await expect(editor).toBeInViewport();
  await expect(editor).toHaveValue("Новый текст");
});
