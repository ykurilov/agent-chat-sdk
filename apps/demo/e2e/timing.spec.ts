import { expect } from "@playwright/test";
import { appearedAt, startLongAnswer, watchAppearance } from "./support/chat";
import { test } from "./support/own-server";

/*
 * Замеры сроков живой связи (фича 002) на настоящих сроках модуля: тишина 30 с, попытки 0/2/5 с, запрос 10 с.
 * Группа `timing`: идёт после замеров скорости; тесты ждут по часам и идут одновременно, у каждого свой сервер стенда
 * (имитация связи действует на все чаты сервера). Что происходит после срока (дописывание ответа, «стоп»,
 * «Повторить») — в liveness.spec.ts на коротких сроках; точность сроков — юнит-тесты на подменённых часах.
 *   SC-005: зависшая связь замечается через 30 с тишины (допуск 2 с).
 *   SC-007: «Нет связи с сервером» с «Повторить» — не позже 45 с при отказе соединений, не позже 75 с при молчащем сервере.
 */

const SILENCE_MS = 30_000;
const SILENCE_TOLERANCE_MS = 2_000;
const OFFLINE_AFTER_REFUSAL_MS = 45_000;
const OFFLINE_AFTER_SILENT_SERVER_MS = 75_000;

test("зависшая связь замечается через 30 ± 2 с тишины (SC-005)", async ({ page, ownServer }, testInfo) => {
  test.setTimeout(90_000);
  await startLongAnswer(page);
  await watchAppearance(page, { name: "reconnecting", text: "Переподключаемся…" });

  await ownServer.setConnectionMode("freeze-open");
  const frozenAt = Date.now();
  const noticedAfterMs = (await appearedAt(page, "reconnecting", SILENCE_MS + 10_000)) - frozenAt;
  console.log(`[${testInfo.project.name}] зависание замечено через, мс: ${noticedAfterMs}`);
  expect(noticedAfterMs).toBeGreaterThanOrEqual(SILENCE_MS - SILENCE_TOLERANCE_MS);
  expect(noticedAfterMs).toBeLessThanOrEqual(SILENCE_MS + SILENCE_TOLERANCE_MS);
});

// Chromium не рвёт уже открытый поток при `setOffline`, поэтому обрыв настоящей сети складывается из двух частей:
// байты идущего потока пропадают (`freeze-open`), а новые соединения отказывают (`setOffline`).
test("сервер отклоняет соединения: «Нет связи с сервером» и «Повторить» не позже чем через 45 с (SC-007)", async ({
  page,
  context,
  ownServer,
}, testInfo) => {
  test.setTimeout(120_000);
  await startLongAnswer(page);

  await ownServer.setConnectionMode("freeze-open");
  await context.setOffline(true);
  const cutAt = Date.now();
  await expect(page.getByText("Нет связи с сервером")).toBeVisible({ timeout: OFFLINE_AFTER_REFUSAL_MS + 10_000 });
  const offlineAfterMs = Date.now() - cutAt;
  console.log(`[${testInfo.project.name}] «Нет связи» при отказе соединений через, мс: ${offlineAfterMs}`);
  expect(offlineAfterMs).toBeLessThanOrEqual(OFFLINE_AFTER_REFUSAL_MS);
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
});

test("сервер принимает соединения, но молчит: «Нет связи с сервером» не позже чем через 75 с (SC-007)", async ({ page, ownServer }, testInfo) => {
  test.setTimeout(150_000);
  // Обычный длинный ответ дописался бы за 60 с, раньше конца серии попыток, и вкладка показала бы его готовым.
  await startLongAnswer(page, { question: "Дай бесконечный ответ" });

  await ownServer.setConnectionMode("silent");
  const mutedAt = Date.now();
  await expect(page.getByText("Нет связи с сервером")).toBeVisible({ timeout: OFFLINE_AFTER_SILENT_SERVER_MS + 10_000 });
  const offlineAfterMs = Date.now() - mutedAt;
  console.log(`[${testInfo.project.name}] «Нет связи» при молчащем сервере через, мс: ${offlineAfterMs}`);
  expect(offlineAfterMs).toBeLessThanOrEqual(OFFLINE_AFTER_SILENT_SERVER_MS);
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
});
