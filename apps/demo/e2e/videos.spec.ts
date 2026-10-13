import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Фича 025: агент находит урок в каталоге и присылает карточку видео. Один сценарий подряд, чат у теста свой; телефон —
 * videos-phone.spec.ts. Площадки подменены: тест считает запросы к ним и отдаёт пустую страницу вместо плеера.
 */

const platforms = /youtube\.com|youtube-nocookie\.com|ytimg\.com|kinescope\.io/;

async function watchPlatforms(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(platforms, (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Плеер</title><p>Плеер</p>" });
  });
  return requests;
}

const card = (page: Page) => page.getByRole("button", { name: /^Смотреть видео: / });

test("видео: карточка «с 3:20» без запросов к площадке, перезагрузка, плеер по нажатию, на весь экран, отказ", async ({ page }) => {
  const requests = await watchPlatforms(page);
  await signIn(page);

  await send(page, "Покажи урок про нейросети с примеров");
  await expect(lastAnswer(page)).toContainText("Вот урок");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toHaveAccessibleName("Смотреть видео: Что такое нейросеть");
  await expect(lastAnswer(page)).toContainText("19:13 · с 3:20");
  await expect(card(page).locator("img")).toHaveAttribute("src", "/videos/neural-networks.svg");

  // Перезагрузка: карточка на месте, к площадке по-прежнему ни одного запроса (SC-002).
  await page.reload();
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByText("с 3:20")).toBeVisible();
  expect(requests).toEqual([]);

  // Нажатие: плеер с адреса nocookie и с секунды 200.
  await card(page).click();
  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0&start=200");
  await expect(page.frameLocator("iframe").getByText("Плеер")).toBeVisible();
  expect(requests.every((url) => url.startsWith("https://www.youtube-nocookie.com/embed/"))).toBe(true);

  await page.getByRole("button", { name: "На весь экран" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-video-frame") ?? false)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());

  // id не из каталога: сервер отказывает, карточки нет.
  await send(page, "Покажи несуществующее видео");
  await expect(lastAnswer(page)).toContainText("Такого видео в каталоге нет.");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(card(page)).toHaveCount(0);
});
