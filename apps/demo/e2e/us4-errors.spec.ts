import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  appearedAt,
  chooseModel,
  expectInterruptedWithoutReload,
  expectRetryStartsFreshAnswer,
  lastAnswer,
  send,
  signIn,
  simulateFailure,
  startLongAnswer,
  useShortLiveness,
  watchAppearance,
} from "./support/chat";
import { test as withOwnServer } from "./support/own-server";

/*
 * Первая фича, User Story 4 (FR-015–FR-017): понятные ошибки, тихие повторы при перегрузке, «повторить»;
 * состояния при падении сервера (вместе с живой связью фичи 002: «Переподключаемся…», «Нет связи с сервером»).
 * Сроки тихих повторов проверяют юнит-тесты на подменённых часах; здесь один живой случай.
 */

const errorNotice = (scope: Page | Locator) => scope.locator("[data-error-kind]");

// Перегружены оба: быстрый повтор (250 мс) у выбранного, затем 1/3/6 с у последнего запасного.
test("перегрузка у всех: обычное ожидание, через ~10 с — ошибка; после выключения «повторить» даёт ответ", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  // Модель с несколькими провайдерами: запомненный выбор человека мог остаться от другого теста.
  await chooseModel(page, "DeepSeek", "DeepSeek 4.1 Flash");
  await simulateFailure(page, "Перегрузка модели");

  const sentAt = Date.now();
  await watchAppearance(page, { name: "error", selector: "[data-error-kind]" });
  await send(page, "Привет");
  const answer = lastAnswer(page);
  // Тихие повторы: собеседник видит обычное ожидание, а не ошибку.
  await expect(answer).toHaveAttribute("data-status", "streaming");
  await expect(answer.getByText("Модель перегружена, попробуйте ещё раз")).toBeVisible({ timeout: 40_000 });
  // Ошибка не появлялась раньше срока: наблюдатель записал её первое появление.
  const waitedMs = (await appearedAt(page, "error", 1_000)) - sentAt;
  expect(waitedMs).toBeGreaterThan(10_000);
  // Запас на нагруженный CI, но прежние ~20 с у обоих провайдеров сюда не проходят.
  expect(waitedMs).toBeLessThan(18_000);
  await expect(answer).toHaveAttribute("data-status", "error");
  await expect(errorNotice(answer)).toHaveAttribute("data-error-kind", "overloaded");
  // Сырого текста провайдера нет.
  await expect(page.getByText("Simulated", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();

  await simulateFailure(page, "Без сбоев");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete", { timeout: 20_000 });
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(1);
  await expect(errorNotice(page)).toHaveCount(0);

  // После обновления страницы — то же: новый ответ, вопрос один.
  await page.reload();
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(1);
});

test("перегрузка у первого провайдера — ответ приходит от запасного, без ошибки", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await chooseModel(page, "DeepSeek", "DeepSeek 4.1 Flash");
  await simulateFailure(page, "Перегрузка у первого провайдера");
  await send(page, "Привет");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(answer).toContainText("Спрашивайте ещё.");
  await expect(errorNotice(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
});

test("неверный ключ — ошибка сразу, без ожидания", async ({ page }) => {
  await signIn(page);
  await simulateFailure(page, "Неверный ключ");
  const sentAt = Date.now();
  await send(page, "Привет");
  const answer = lastAnswer(page);
  await expect(answer.getByText("Ключ провайдера не подходит")).toBeVisible({ timeout: 5_000 });
  expect(Date.now() - sentAt).toBeLessThan(3_000);
  await expect(errorNotice(answer)).toHaveAttribute("data-error-kind", "invalid_key");
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(1);
});

test("обёртка приложения отказала ходу 409 со своим текстом: виден текст, «Повторить» нет, вопрос вернулся в поле", async ({ page }) => {
  await signIn(page);
  await simulateFailure(page, "Разговор завершён (409)");
  await send(page, "Привет");
  await expect(errorNotice(page)).toContainText("Разговор завершён");
  await expect(page.getByText("Что-то пошло не так", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveValue("Привет");
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(0);
});

// Падающий сервер: у каждого теста свой сервер, короткие сроки связи — по паре секунд вместо десятков.
// Настоящие сроки (0, 2, 5 с; 30 с тишины) проверяют юнит-тесты и замеры в timing.spec.ts.
withOwnServer("сервер демо падает, пока вкладка открыта: ответ прерван, «повторить» работает после подъёма сервера", async ({
  page,
  ownServer,
}) => {
  test.setTimeout(90_000);
  await useShortLiveness(page);
  await startLongAnswer(page);

  await ownServer.crashApi();
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "interrupted");
  await expect(answer.getByText("Ответ прерван")).toBeVisible();
  await expect(answer).toContainText("Абзац 3:");
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(1);

  // Сервер ещё лежит: вкладка честно пробует переподключиться, затем снова «Нет связи с сервером»;
  // ответ остаётся на месте, «Ответ прерван» и «повторить» на месте (живая связь, US2 этапа 002).
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByText("Нет связи с сервером")).toBeVisible({ timeout: 30_000 });
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "interrupted");
  await expect(lastAnswer(page)).toContainText("Абзац 3:");
  await expect(lastAnswer(page).getByText("Ответ прерван")).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(1);

  // Сервер поднялся. Первое «Повторить» возвращает связь (перечитывает историю); ответ в базе ещё «идёт», и экран
  // перечитывает её сам, пока сервер не прервёт брошенный ответ (FR-060). Второе «Повторить» — новый ответ.
  await ownServer.startApi();
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByText("Нет связи с сервером")).toHaveCount(0);
  await expectInterruptedWithoutReload(page);
  const retried = await expectRetryStartsFreshAnswer(page, "Дай длинный ответ");

  // У остановленного ответа тоже есть «повторить».
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(retried.getByText("Остановлено")).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(1);
});

withOwnServer("сообщение не дошло до сервера — «Нет связи с сервером», «повторить» отправляет его", async ({ page, ownServer }) => {
  test.setTimeout(90_000);
  await useShortLiveness(page);
  // Сервер падает, когда вкладка уже загрузила историю чата.
  const historyLoaded = page.waitForResponse((response) => /^\/api\/chat\/[^/]+$/.test(new URL(response.url()).pathname));
  await signIn(page);
  await historyLoaded;
  await ownServer.crashApi();
  await send(page, "Привет");

  // Сообщение не дошло, сервер лежит: «Нет связи с сервером» (живая связь, US2 этапа 002), а не общая ошибка.
  await expect(page.getByText("Нет связи с сервером")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-status]")).toHaveCount(0);
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(1);

  await ownServer.startApi();
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete", { timeout: 20_000 });
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
  await expect(page.getByText("Что-то пошло не так, попробуйте ещё раз")).toHaveCount(0);
  await page.reload();
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(1);
});

test("шлюз ответил 502 на отправку — сообщение остаётся в ленте, «повторить» отправляет его с тем же id, ответ один", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();
  const sendUrl = "**/api/chat/*/messages";
  const sentIds: string[] = [];
  let watchesOpened = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/messages")) sentIds.push((request.postDataJSON() as { message: { id: string } }).message.id);
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/watch")) watchesOpened += 1;
  });
  // Приложение за шлюзом перезапускается: шлюз отдаёт свою страницу 502, сервер сообщения не видел.
  await page.route(sendUrl, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>502 Bad Gateway</body></html>" })
      : route.continue(),
  );
  const text = "Привет, это сообщение пережило обрыв";
  const watchesBeforeSend = watchesOpened;
  await send(page, text);
  await expect(page.getByText("Что-то пошло не так, попробуйте ещё раз")).toBeVisible();
  // Подписка на события чата открывается после сбоя и перечитывает историю: сообщение всё равно на месте.
  await expect.poll(() => watchesOpened).toBeGreaterThan(watchesBeforeSend);
  await expect(page.getByRole("log").getByText(text, { exact: true })).toHaveCount(1);

  await page.unroute(sendUrl);
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete", { timeout: 20_000 });
  expect(sentIds).toHaveLength(2);
  expect(sentIds[1]).toBe(sentIds[0]);
  await expect(page.getByText("Что-то пошло не так, попробуйте ещё раз")).toHaveCount(0);
  await expect(page.getByRole("log").getByText(text, { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("log").getByText(text, { exact: true })).toHaveCount(1);
  await expect(page.locator("[data-status]")).toHaveCount(1);
});

withOwnServer("история не загрузилась — ошибка над полем ввода, «повторить» грузит её", async ({ page, ownServer }) => {
  test.setTimeout(90_000);
  await useShortLiveness(page);
  await signIn(page);
  await send(page, "Привет");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete", { timeout: 20_000 });

  await ownServer.crashApi();
  await page.reload();
  await expect(page.getByText("Что-то пошло не так, попробуйте ещё раз")).toBeVisible();
  await expect(page.locator("[data-status]")).toHaveCount(0);

  // Список чатов при упавшем сервере тоже не загрузился, у него своя кнопка «Повторить»: нужна кнопка чата.
  await ownServer.startApi();
  await page.getByRole("status").filter({ hasText: "Что-то пошло не так" }).getByRole("button", { name: "Повторить" }).click();
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
  await expect(page.getByText("Что-то пошло не так, попробуйте ещё раз")).toHaveCount(0);
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toHaveCount(1);
});
