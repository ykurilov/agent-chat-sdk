import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";
import { test as ownServerTest } from "./support/own-server";
import { dialogSound, installFakeDialogMicrophone, speakDialog, startedSounds } from "./support/fake-dialog-microphone";
import { watchVoiceSockets } from "./support/fake-microphone";

/*
 * Фича 016: голосовой режим («разговор»). Микрофон подменён в браузере (support/fake-dialog-microphone.ts), сервер демо в режиме `mock`
 * подменяет Soniox и ElevenLabs (server/mock-soniox.ts, server/mock-elevenlabs.ts). Настоящие сервисы проверяются живыми замерами
 * (этап 7 плана). Здесь — что части работают вместе: кнопка, соединение с сервером, чат, воспроизведение, перебивание, отметка обрыва.
 */

const start = (page: Page) => page.getByRole("button", { name: "Голосовой режим" });
const leave = (page: Page) => page.getByRole("button", { name: "Выйти", exact: true });
const panel = (page: Page) => page.locator("[data-state]").filter({ has: page.getByRole("status") }).first();
const feed = (page: Page) => page.getByRole("log");
const branchSwitcher = (page: Page) => page.getByRole("group", { name: /^Вариант \d+ из \d+$/ });
const interruptMark = (page: Page) => page.getByText(/Вы перебили: озвучено до «/);

test("разговор: сказал → сообщение ушло само → ответ звучит → перебил → перебившая фраза ушла следующим сообщением → отметка остаётся после перезагрузки", async ({ page }) => {
  const sockets = watchVoiceSockets(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await installFakeDialogMicrophone(page);
  await signIn(page);

  await start(page).click();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");

  // Фраза №1: «привет как дела». Слова по одному, затем пауза — сообщение уходит само, кнопки «Отправить» никто не нажимал.
  await speakDialog(page, dialogSound.phraseOne, 3);
  await speakDialog(page, dialogSound.phraseEnd);
  await expect(feed(page).getByText("привет как дела", { exact: false })).toBeVisible();
  // Ответ агента идёт в ленту и звучит.
  await expect(panel(page)).toHaveAttribute("data-state", "speaking");
  await expect.poll(() => startedSounds(page)).toBeGreaterThan(0);
  const heardBefore = await startedSounds(page);
  await expect.poll(() => startedSounds(page)).toBeGreaterThan(heardBefore);

  // Перебить: «стоп хватит». Звук гаснет сразу, режим слушает дальше.
  await speakDialog(page, dialogSound.phraseTwo, 2);
  await expect(panel(page)).toHaveAttribute("data-state", /interrupted|listening/);
  await speakDialog(page, dialogSound.phraseEnd);
  await expect(feed(page).getByText("стоп хватит", { exact: false })).toBeVisible();

  // В ленте — отметка у прерванного ответа; после перезагрузки она на месте.
  await expect(interruptMark(page)).toBeVisible();
  const mark = await interruptMark(page).first().innerText();
  await leave(page).click();
  await expect(start(page)).toBeVisible();
  await page.reload();
  await expect(interruptMark(page).first()).toHaveText(mark);

  // Звук и команды шли только через наш сервер (SC-011): ни ключей, ни прямых соединений с Soniox и ElevenLabs.
  expect(sockets.length).toBeGreaterThanOrEqual(1);
  for (const socket of sockets) {
    const url = new URL(socket.url);
    expect(url.host).toBe(new URL(page.url()).host);
    expect(url.pathname).toBe("/api/voice-dialog/stream");
    const text = [...socket.sent, ...socket.received].filter((payload): payload is string => typeof payload === "string").join("\n");
    expect(text).not.toMatch(/api_key|apikey|xi-api|temporary|ELEVENLABS|SONIOX/i);
  }
  expect(requests.filter((url) => /soniox|elevenlabs/i.test(url))).toEqual([]);
});

test("микрофон не разрешили: понятная надпись, чат работает", async ({ page }) => {
  await installFakeDialogMicrophone(page, { microphone: "denied" });
  await signIn(page);

  await start(page).click();
  await expect(page.getByRole("alert")).toHaveText("Нет доступа к микрофону. Разрешите его в настройках браузера");

  // Пока панель режима открыта, поле ввода скрыто; выйти из режима — и обычный чат работает.
  await leave(page).click();
  await send(page, "Просто текстом");
  await expect(lastAnswer(page)).toContainText("Привет!");
});

test("в браузере нет микрофона: надпись про условия, чат работает", async ({ page }) => {
  await installFakeDialogMicrophone(page, { microphone: "missing" });
  await signIn(page);

  await start(page).click();
  await expect(page.getByRole("alert")).toHaveText("Микрофон недоступен: нужны микрофон, https и свежий браузер");

  // Пока панель режима открыта, поле ввода скрыто; выйти из режима — и обычный чат работает.
  await leave(page).click();
  await send(page, "Просто текстом");
  await expect(lastAnswer(page)).toContainText("Привет!");
});

// Выбор голоса хранится на человека, а не на чат: на общем сервере он остался бы у Анны и сбил бы соседние тесты и повторный запуск.
// Поэтому у теста свой сервер и своя база.
ownServerTest("голос: четыре голоса в меню, выбор запоминается на сервере", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);
  await start(page).click();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");

  const menu = page.getByRole("button", { name: /Голос/ });
  await expect(menu).toBeVisible();
  await menu.click();
  const options = page.getByRole("menuitemradio");
  await expect(options).toHaveCount(4);
  await expect(options.first()).toContainText("Профессиональный диктор для аудиокниг");
  await expect(options.first()).toBeChecked();
  await options.nth(1).click();

  await page.reload();
  await start(page).click();
  await page.getByRole("button", { name: /Голос/ }).click();
  await expect(page.getByRole("menuitemradio").nth(1)).toBeChecked();
});

test("заполнитель: модель долго молчит → голос говорит короткую фразу → потом звучит сам ответ; в чат фраза не попадает", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);
  // Фразы заполнителей грузятся в фоне после входа в режим; ждём, пока они дойдут (без них заполнитель пропускается).
  const fillerLoaded = page.waitForResponse((response) => /\/api\/voice-dialog\/fillers\/thinking-\d+\?/.test(response.url()) && response.ok());
  await start(page).click();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");
  await fillerLoaded;

  // «Не торопись пожалуйста»: заглушка модели молчит 4 с, порог заполнителя — 1,5 с.
  await speakDialog(page, dialogSound.phraseThree, 3);
  await speakDialog(page, dialogSound.phraseEnd);
  await expect(feed(page).getByText("не торопись пожалуйста", { exact: false })).toBeVisible();

  // Звук пошёл, а ответа ещё нет: это заполнитель.
  await expect.poll(() => startedSounds(page)).toBeGreaterThan(0);
  await expect(panel(page)).toHaveAttribute("data-state", "thinking");
  await expect(feed(page).getByText("Привет!")).toHaveCount(0);
  const fillerSounds = await startedSounds(page);

  // Потом приходит настоящий ответ и тоже звучит.
  await expect(feed(page).getByText("Привет!")).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-state", "speaking");
  await expect.poll(() => startedSounds(page)).toBeGreaterThan(fillerSounds);

  // Заполнитель в ленту не попал.
  await expect(feed(page).getByText(/Хмм|Так…|Дай-ка подумаю/)).toHaveCount(0);
});

test("склейка: вторая фраза, пока модель думает, дописывается к первой — одно сообщение человека со склеенным текстом и один ответ", async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);
  await start(page).click();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");

  // «Не торопись пожалуйста»: заглушка модели молчит 4 с. Не дожидаясь ответа, человек говорит дальше: «привет как дела».
  await speakDialog(page, dialogSound.phraseThree, 3);
  await speakDialog(page, dialogSound.phraseEnd);
  await expect(feed(page).getByText("не торопись пожалуйста", { exact: true })).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-state", "thinking");
  await speakDialog(page, dialogSound.phraseOne, 3);
  await speakDialog(page, dialogSound.phraseEnd);

  // В ленте одно сообщение человека, в нём обе фразы; первой фразы отдельно нет, ход не «перебит».
  await expect(feed(page).getByText("не торопись пожалуйста привет как дела", { exact: true })).toBeVisible();
  await expect(feed(page).getByText("не торопись пожалуйста", { exact: true })).toHaveCount(0);
  await expect(feed(page).getByText("привет как дела", { exact: true })).toHaveCount(0);
  await expect(interruptMark(page)).toHaveCount(0);

  // Модель отвечает один раз, ответ звучит; пустого оборванного ответа рядом нет.
  await expect(feed(page).getByText("Привет!")).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-state", "speaking");
  await expect.poll(() => startedSounds(page)).toBeGreaterThan(0);
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(feed(page).getByText("Остановлено")).toHaveCount(0);
  // Склейка невидима: это одна мысль в два приёма, а не правка, переключателя веток нет.
  await expect(branchSwitcher(page)).toHaveCount(0);

  // После перезагрузки то же самое: на сервере склеенный вопрос и один ответ, переключателя по-прежнему нет.
  await leave(page).click();
  await page.reload();
  await expect(feed(page).getByText("не торопись пожалуйста привет как дела", { exact: true })).toBeVisible();
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(branchSwitcher(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Предыдущий вариант" })).toHaveCount(0);
});

test("звуки человека: смех без слов хода не запускает, а со следующей фразой доходит до модели; на экране звуков нет, после перезагрузки тоже", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  // Концы фраз, которые сервер прислал странице: только они запускают ход.
  const phraseEnds: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const message = typeof payload === "string" && payload.startsWith("{") ? (JSON.parse(payload) as { type?: string; text?: string }) : undefined;
      if (message?.type === "phrase_end") phraseEnds.push(message.text ?? "");
    });
  });
  await installFakeDialogMicrophone(page);
  await signIn(page);
  await start(page).click();
  await expect(panel(page)).toHaveAttribute("data-state", "listening");

  // Один смех, слов нет: Soniox молчит, фразы нет — ни сообщения, ни ответа.
  await speakDialog(page, dialogSound.laughter, 10);
  await speakDialog(page, dialogSound.phraseEnd);

  // Следующая фраза «привет как дела»: смех приклеился к ней, модель отреагировала на смех.
  await speakDialog(page, dialogSound.phraseOne, 3);
  await speakDialog(page, dialogSound.phraseEnd);
  await expect(feed(page).getByText("привет как дела", { exact: true })).toBeVisible();
  await expect(feed(page).getByText("Ха, рад, что смешно!")).toBeVisible();
  // Смех сам хода не запустил: звук идёт по порядку, и его конец фразы пришёл бы раньше этой. Ход и ответ — по одному.
  expect(phraseEnds, "смех без слов запустил отдельный ход").toEqual(["привет как дела"]);
  await expect(page.locator("[data-status]")).toHaveCount(1);

  // Человек звуков не видит: ни слов пометки, ни названий звуков, ни отдельного сообщения про смех.
  const hidden = /смех|laughter|Служебная пометка|звуки человека/i;
  await expect(feed(page).getByText(hidden)).toHaveCount(0);
  await leave(page).click();
  await page.reload();
  await expect(feed(page).getByText("привет как дела", { exact: true })).toBeVisible();
  await expect(feed(page).getByText("Ха, рад, что смешно!")).toBeVisible();
  await expect(feed(page).getByText(hidden)).toHaveCount(0);

  // Scribe зовёт только наш сервер: браузер к ElevenLabs не ходит.
  expect(requests.filter((url) => /elevenlabs/i.test(url))).toEqual([]);
});
