import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { send, signIn } from "./support/chat";
import { installFakeMicrophone, speak, speechScenario, watchVoiceSockets } from "./support/fake-microphone";

/*
 * Фичи 009 и 013: диктовка в поле ввода через наш сервер. Микрофон подменён в браузере (support/fake-microphone.ts),
 * сервер демо в режиме `mock` подменяет Soniox и чистку текста по сценарию (server/mock-soniox.ts).
 * Настоящее распознавание и настоящую чистку проверяют живые тесты пакета голоса. Здесь — что части работают вместе:
 * кнопка, соединение с сервером, поле ввода, чат.
 */

const field = (page: Page) => page.getByRole("textbox", { name: "Сообщение" });
const start = (page: Page) => page.getByRole("button", { name: "Диктовать" });
const stop = (page: Page) => page.getByRole("button", { name: "Остановить диктовку" });
/** Нажать микрофон и дождаться записи: куски звука «говорятся» только после этого. */
async function begin(page: Page) {
  await start(page).click();
  await expect(stop(page)).toHaveAttribute("aria-pressed", "true");
}
const polishing = (page: Page) => page.getByRole("button", { name: "Приводим текст в порядок…" });

test("диктовка: слова видны по ходу речи, «стоп» закрепляет, чистка заменяет надиктованный кусок, отправка — обычная", async ({ page }) => {
  await installFakeMicrophone(page);
  await signIn(page);
  await field(page).fill("Слушай,");

  await begin(page);

  await speak(page, 2);
  await expect(field(page)).toHaveValue("Слушай, ну");
  await speak(page, 2);
  await expect(field(page)).toHaveValue("Слушай, ну э-э привет как бы мир");

  await stop(page).click();
  // Чистка заменяет только надиктованное; набранное «Слушай,» остаётся.
  await expect(field(page)).toHaveValue("Слушай, Привет мир.");
  await expect(start(page)).toBeVisible();
  // Голос сам ничего не отправил.
  await expect(page.getByRole("log").getByText("Слушай, Привет мир.")).toHaveCount(0);

  await field(page).press("Enter");
  await expect(page.getByRole("log").getByText("Слушай, Привет мир.")).toBeVisible();
});

test("звук идёт через наш сервер: в браузере нет ключей и нет соединения с Soniox", async ({ page }) => {
  const sockets = watchVoiceSockets(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await installFakeMicrophone(page);
  await signIn(page);

  await begin(page);
  await speak(page, 4);
  await expect(field(page)).toHaveValue("ну э-э привет как бы мир");
  await stop(page).click();
  await expect(field(page)).toHaveValue("Привет мир.");

  expect(sockets).toHaveLength(1);
  const [relay] = sockets;
  expect(new URL(relay!.url).host).toBe(new URL(page.url()).host);
  expect(new URL(relay!.url).pathname).toBe("/api/voice/stream");
  // Приветствие: формат звука и язык записи — язык экрана чата.
  expect(relay!.sent[0]).toBe(JSON.stringify({ audio_format: "auto", language_hints: ["ru"] }));
  expect(relay!.sent.at(-1)).toBe(JSON.stringify({ type: "finalize" }));
  const everything = [...relay!.sent, ...relay!.received].map((payload) => (typeof payload === "string" ? payload : "<звук>")).join("\n");
  expect(everything).not.toMatch(/api_key|mock|temporary/);
  expect(relay!.received[0]).toContain('"ready":true');
  // Временный ключ не выдаётся: прямого режима в демо нет.
  expect(requests.filter((url) => /soniox|\/api\/voice\/session/.test(url))).toEqual([]);
});

test("пока сервер причёсывает текст, у кнопки тихий признак; дописанное руками в это время не теряется", async ({ page }) => {
  await installFakeMicrophone(page, { scenario: speechScenario.slowPolish });
  await signIn(page);

  await begin(page);
  await speak(page, 4);
  await expect(field(page)).toHaveValue("ну э-э медленно как бы мир");
  await stop(page).click();

  await expect(polishing(page)).toBeDisabled();
  await expect(polishing(page)).toHaveAttribute("aria-busy", "true");
  await field(page).pressSequentially(" и всё");
  await expect(field(page)).toHaveValue("Медленно мир. и всё");
  await expect(start(page)).toBeVisible();
  await expect(polishing(page)).toHaveCount(0);
});

test("человек поправил само надиктованное, пока шла чистка: его правка остаётся, чистка отброшена", async ({ page }) => {
  await installFakeMicrophone(page, { scenario: speechScenario.slowPolish });
  await signIn(page);
  await begin(page);
  await speak(page, 4);
  await expect(field(page)).toHaveValue("ну э-э медленно как бы мир");
  await stop(page).click();
  await expect(polishing(page)).toBeVisible();

  await field(page).fill("ну э-э медленно как бы мир!!!");
  await field(page).press("Home");
  await field(page).pressSequentially("Так. ");

  await expect(start(page)).toBeVisible();
  await expect(field(page)).toHaveValue("Так. ну э-э медленно как бы мир!!!");
});

test("чистка сломалась: остаётся текст Soniox, ошибки на экране нет", async ({ page }) => {
  await installFakeMicrophone(page, { scenario: speechScenario.failingPolish });
  await signIn(page);

  await begin(page);
  await speak(page, 4);
  await stop(page).click();

  await expect(start(page)).toBeVisible();
  await expect(field(page)).toHaveValue("ну э-э сбой как бы мир");
  // Область для диктора у чата стоит всегда и пуста; сообщения об ошибке в ней быть не должно.
  await expect(page.getByRole("status").filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("длинная диктовка: поле прокручено к последним словам, а после чистки конец виден", async ({ page }) => {
  await installFakeMicrophone(page, { scenario: speechScenario.long });
  await signIn(page);
  await begin(page);

  await speak(page, 4);
  await expect.poll(() => field(page).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const atEnd = () => field(page).evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight <= 2);
  await expect.poll(atEnd).toBe(true);

  await stop(page).click();
  await expect(start(page)).toBeVisible();
  await expect(field(page)).toHaveValue(/конец\.$/);
  await expect.poll(atEnd).toBe(true);
});

test("нет доступа к микрофону: понятное сообщение, чат работает", async ({ page }) => {
  await installFakeMicrophone(page, { microphone: "denied" });
  await signIn(page);

  await start(page).click();

  await expect(page.getByRole("status").filter({ hasText: "Нет доступа к микрофону" })).toBeVisible();
  await expect(start(page)).toBeVisible();
  await send(page, "Привет");
  await expect(page.getByRole("log").getByText("Привет", { exact: true })).toBeVisible();
});

test("без входа сервер не принимает соединение для голоса", async ({ request }) => {
  const response = await request.get("/api/voice/stream");

  expect(response.status()).toBe(401);
});
