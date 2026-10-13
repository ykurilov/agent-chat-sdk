import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { expectInsideViewport, expectNoHorizontalOverflow } from "./support/screen";

/*
 * Видео агента на узком экране (320 px): карточка и плеер помещаются по ширине. Остальное проверено на компьютере
 * (videos.spec.ts).
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: карточка и плеер видео не вылезают за экран", async ({ page }) => {
  await page.route(/youtube\.com|youtube-nocookie\.com|kinescope\.io/, (route) => route.fulfill({ contentType: "text/html", body: "<p>Плеер</p>" }));
  await signIn(page);
  await send(page, "Покажи урок про вайб-кодинг");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  const card = page.getByRole("button", { name: /^Смотреть видео: / });
  await expect(card).toBeVisible();
  await expectInsideViewport(page, card, { horizontalOnly: true });
  await expectNoHorizontalOverflow(page);

  await card.tap();
  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("src", /^https:\/\/kinescope\.io\/embed\//);
  await expectInsideViewport(page, frame, { horizontalOnly: true });
  await expectNoHorizontalOverflow(page);
});
