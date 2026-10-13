import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  appearedAt,
  expectConsecutiveFromOne,
  lastAnswer,
  lastParagraph,
  paragraphNumbers,
  startLongAnswer,
  stopAndExpectKeptAfterReload,
  useShortLiveness,
  watchAppearance,
} from "./support/chat";
import { test } from "./support/own-server";

/*
 * Живая связь (фича 002, US2): поведение вкладки при зависшей и пропавшей связи, «стоп» во время переподключения.
 * Сервер стенда придерживает байты потоков по команде `POST /api/demo/connection`; команда действует на все чаты
 * сервера, поэтому у каждого теста свой сервер. Сроки короткие (сервер шлёт признак жизни раз в секунду,
 * вкладка терпит тишину 3 с): проверяется поведение, а не время. Настоящие сроки 30/45/75 с — в timing.spec.ts,
 * точность сроков — юнит-тесты на подменённых часах (packages/react/tests/liveness).
 */

test.use({ heartbeatMs: 1_000 });

const reconnectingNotice = (page: Page) => page.getByText("Переподключаемся…");
const offlineNotice = (page: Page) => page.getByText("Нет связи с сервером");
const RECONNECTING = { name: "reconnecting", text: "Переподключаемся…" };

test.beforeEach(async ({ page }) => {
  await useShortLiveness(page);
});

test("поток замер посреди ответа: «Переподключаемся…», ответ дописан без повторов и пропусков, после перезагрузки тот же", async ({
  page,
  ownServer,
}) => {
  const answer = await startLongAnswer(page);

  await watchAppearance(page, RECONNECTING);
  await ownServer.setConnectionMode("freeze-open");
  await appearedAt(page, RECONNECTING.name, 15_000);

  // Новые потоки работают как обычно: первая же попытка подключается к идущему ответу, и он растёт дальше.
  await expect(reconnectingNotice(page)).toHaveCount(0);
  const whenReconnected = await lastParagraph(answer);
  await expect.poll(() => lastParagraph(answer)).toBeGreaterThan(whenReconnected + 3);
  await expect(reconnectingNotice(page)).toHaveCount(0);
  expectConsecutiveFromOne(await paragraphNumbers(answer));

  // Дальше ждать конца ответа незачем (это минута): останавливаем и смотрим, что сохранилось то же.
  await stopAndExpectKeptAfterReload(page, answer);
  await expect(page.locator("[data-status]")).toHaveCount(1);
});

test("сеть пропала посреди ответа: «Нет связи с сервером» и «Повторить»; сеть вернулась — вкладка подключилась сама", async ({
  page,
  context,
  ownServer,
}) => {
  const answer = await startLongAnswer(page);

  await ownServer.setConnectionMode("freeze-open");
  await context.setOffline(true);
  await expect(offlineNotice(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  await expect(answer.getByText("Ответ прерван")).toBeVisible();
  const kept = await paragraphNumbers(answer);
  expect(kept.length).toBeGreaterThanOrEqual(3);
  expectConsecutiveFromOne(kept);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();

  await context.setOffline(false);
  await expect(offlineNotice(page)).toHaveCount(0, { timeout: 20_000 });
  // Ответ дописывается сам, без повторов и пропусков; конца (минута) не ждём.
  await expect.poll(() => lastParagraph(lastAnswer(page))).toBeGreaterThan(Math.max(...kept) + 3);
  expectConsecutiveFromOne(await paragraphNumbers(lastAnswer(page)));
  await expect(page.locator("[data-status]")).toHaveCount(1);
});

test("сервер молчит посреди ответа: «Нет связи с сервером»; после «Повторить» ответ дописывается", async ({ page, ownServer }) => {
  // Обычный длинный ответ дописался бы раньше конца серии попыток, и вкладка показала бы его готовым.
  const answer = await startLongAnswer(page, { question: "Дай бесконечный ответ" });

  await ownServer.setConnectionMode("silent");
  await expect(offlineNotice(page)).toBeVisible({ timeout: 30_000 });
  await expect(answer.getByText("Ответ прерван")).toBeVisible();

  await ownServer.setConnectionMode("normal");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(offlineNotice(page)).toHaveCount(0);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "streaming");
  const atRetry = await lastParagraph(lastAnswer(page));
  await expect.poll(() => lastParagraph(lastAnswer(page))).toBeGreaterThan(atRetry + 2);
  expectConsecutiveFromOne(await paragraphNumbers(lastAnswer(page)));
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(lastAnswer(page).getByText("Остановлено")).toBeVisible();
});

test("«стоп» во время «Переподключаемся…» останавливает ответ, после перезагрузки он остановлен", async ({ page, ownServer }) => {
  const answer = await startLongAnswer(page);

  await ownServer.setConnectionMode("silent");
  await expect(reconnectingNotice(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(answer.getByText("Остановлено")).toBeVisible();
  await expect(reconnectingNotice(page)).toHaveCount(0);
  // Пока связь молчала, сервер дописывал дальше, а вкладка этого не видела: после перезагрузки абзацев не меньше.
  const shown = await lastParagraph(answer);

  await ownServer.setConnectionMode("normal");
  await page.reload();
  const restored = lastAnswer(page);
  await expect(restored.getByText("Остановлено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  expectConsecutiveFromOne(await paragraphNumbers(restored));
  expect(await lastParagraph(restored)).toBeGreaterThanOrEqual(shown);
});

test("«стоп» из второй вкладки после переподключения останавливает ответ в обеих", async ({ page, context, ownServer }) => {
  const answer = await startLongAnswer(page);

  await watchAppearance(page, RECONNECTING);
  await ownServer.setConnectionMode("freeze-open");
  await appearedAt(page, RECONNECTING.name, 15_000);
  await expect(reconnectingNotice(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(answer).toHaveAttribute("data-status", "streaming");

  const second = await context.newPage();
  await second.goto(page.url());
  const secondAnswer = lastAnswer(second);
  await expect(secondAnswer).toHaveAttribute("data-status", "streaming");
  expectConsecutiveFromOne(await paragraphNumbers(secondAnswer));
  await second.getByRole("button", { name: "Остановить" }).click();
  await expect(secondAnswer.getByText("Остановлено")).toBeVisible();
  await expect(answer.getByText("Остановлено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  // В обеих вкладках один и тот же ответ.
  expect(await paragraphNumbers(answer)).toEqual(await paragraphNumbers(secondAnswer));
  expectConsecutiveFromOne(await paragraphNumbers(answer));
});
