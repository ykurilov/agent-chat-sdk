import { expect, test } from "@playwright/test";
import { test as withOwnServer } from "./support/own-server";
import {
  expectConsecutiveFromOne,
  expectInterruptedWithoutReload,
  expectRetryStartsFreshAnswer,
  lastAnswer,
  lastParagraph,
  paragraphNumbers,
  startLongAnswer,
  stopAndExpectKeptAfterReload,
  useShortLiveness,
} from "./support/chat";

/*
 * Первая фича, User Story 3 (FR-003, FR-012–FR-015): ответ живёт на сервере без вкладки, «стоп» восстанавливается
 * после обновления, после падения сервера ответ помечен прерванным, после штатной остановки — остановленным. «Стоп» из второй вкладки — в liveness.spec.ts.
 */

test("закрыть страницу посреди ответа — ответ растёт без вкладки, после открытия с текущего места; «стоп» и обновление страницы", async ({
  page,
  context,
}) => {
  await startLongAnswer(page);
  const chatUrl = page.url();
  const beforeClose = await lastParagraph(lastAnswer(page));
  await page.close();

  // Пока вкладки нет, агент пишет дальше (модель пишет около абзаца в секунду). Незаконченный ответ на сервере
  // прочитать нельзя, поэтому просто ждём по часам на пустой вкладке и смотрим, сколько успело написаться.
  const reopened = await context.newPage();
  const readAfter = Date.now() + 5_000;
  await reopened.waitForFunction((until) => Date.now() >= until, readAfter, { polling: 250 });
  await reopened.goto(chatUrl);
  const answer = lastAnswer(reopened);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  // При перемонтировании окна Markdown может на кадр исчезнуть даже после toContainText.
  // Утверждение ниже проверяет тот же снимок текста, на котором дождались его первого показа.
  let atOpen = Number.NEGATIVE_INFINITY;
  await expect.poll(async () => {
    atOpen = await lastParagraph(answer);
    return Number.isFinite(atOpen);
  }).toBe(true);
  expect(atOpen).toBeGreaterThan(beforeClose + 3);
  // И продолжает расти на глазах.
  await expect.poll(() => lastParagraph(answer)).toBeGreaterThan(atOpen + 1);
  expectConsecutiveFromOne(await paragraphNumbers(answer));
  await expect(reopened.getByRole("log").getByText("Дай длинный ответ")).toHaveCount(1);
  await expect(reopened.locator("[data-status]")).toHaveCount(1);

  const restored = await stopAndExpectKeptAfterReload(reopened, answer);
  await expect(restored.getByRole("button", { name: /Думал \d+ сек/ })).toBeVisible();
  expect(await paragraphNumbers(restored)).not.toContain(60);
});

withOwnServer("сервер упал посреди ответа — после перезапуска «Ответ прерван» без обновления страницы, написанное на месте, «повторить» даёт новый ответ", async ({
  page,
  ownServer,
}) => {
  test.setTimeout(90_000);
  await useShortLiveness(page);
  await startLongAnswer(page, { paragraph: 2 });
  const answer = lastAnswer(page);
  const seen = await lastParagraph(answer);
  // Сервер пишет ответ в базу раз в 0,5 с, абзац идёт около секунды. Падаем, когда абзац `seen`
  // виден уже три абзаца подряд: он точно успел попасть в базу, сколько бы ни задержала нагрузка.
  await expect(answer).toContainText(`Абзац ${seen + 3}:`);

  // Сервер падает посреди хода, без штатной остановки. Поднявшись, он прерывает ответ, когда тот не отмечался «жив»
  // 15 с: это может быть ответ живой соседней копии сервера (FR-060). Человек видит это сам, страницу не обновляя.
  await ownServer.crashApi();
  await ownServer.startApi();
  const interrupted = await expectInterruptedWithoutReload(page);
  // Сохранено всё, что было видно давно; последние полсекунды при падении могут не успеть.
  await expect.poll(() => lastParagraph(interrupted)).toBeGreaterThanOrEqual(seen);
  expectConsecutiveFromOne(await paragraphNumbers(interrupted));
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();

  // В базе ответ тоже прерван: после обновления страницы — то же самое. Экран сдаётся раньше сервера: тот
  // прерывает ответ не раньше чем через 15 с без знака жизни, а проверка брошенных идёт раз в 5 с (до ~20 с).
  await page.reload();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "interrupted", { timeout: 30_000 });

  // Сценарий 9 quickstart: у прерванного ответа есть «повторить», и он запускает новый ответ.
  const retried = await expectRetryStartsFreshAnswer(page, "Дай длинный ответ");
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(retried.getByText("Остановлено")).toBeVisible();
});

test("пока идёт ответ, в рамке поля «Остановить» рядом с «Отправить» (поправка на лету): одна кнопка «Стоп», без колёсика", async ({ page }) => {
  await startLongAnswer(page);
  const frame = page.locator("div.rounded-\\[16px\\]").filter({ has: page.getByLabel("Сообщение") });
  const stop = page.getByRole("button", { name: "Остановить" });
  await expect(stop).toHaveCount(1);
  await expect(frame.getByRole("button", { name: "Остановить" })).toBeVisible();
  // Поле пустое — отправлять нечего.
  await expect(frame.getByRole("button", { name: "Отправить" })).toBeDisabled();
  await expect(frame.locator(".tandem-spinner")).toHaveCount(0);

  await stop.click();
  await expect(lastAnswer(page).getByText("Остановлено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
});

withOwnServer("штатная остановка сервера посреди ответа — весь написанный текст в базе, ответ остановлен, как «Стоп»", async ({
  page,
  ownServer,
}) => {
  await useShortLiveness(page);
  await startLongAnswer(page, { paragraph: 4 });
  const seen = await lastParagraph(lastAnswer(page));

  await ownServer.stopApiGracefully();
  await ownServer.startApi();

  await page.reload();
  const answer = lastAnswer(page);
  // С 0.26.0 `flush` останавливает не дождавшийся ответ, как «Стоп» (`stopReason: "shutdown"`), а не прерывает его.
  await expect(answer).toHaveAttribute("data-status", "stopped");
  await expect(answer.getByText("Остановлено")).toBeVisible();
  // В отличие от падения, здесь не теряется ничего: всё, что браузер уже видел, лежит в базе.
  await expect.poll(async () => Math.max(...(await paragraphNumbers(answer)))).toBeGreaterThanOrEqual(seen);
  expectConsecutiveFromOne(await paragraphNumbers(answer));
});
