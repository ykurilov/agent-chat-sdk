import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Общие шаги сценариев: вход, отправка, последний ответ, номера абзацев длинного ответа заглушки. */

const demoUserCookie = { Анна: "anna", Борис: "boris" } as const;

/**
 * Входит пользователем и открывает его новый пустой чат. Чат создаётся заранее и открывается по адресу: без адреса
 * список чатов открыл бы самый недавний чат пользователя, а на общем сервере он мог бы оказаться чатом соседнего теста.
 */
export async function signIn(page: Page, name: "Анна" | "Борис" = "Анна", path = "/") {
  await page.context().addCookies([{ name: "demo-user", value: demoUserCookie[name], domain: "localhost", path: "/" }]);
  const created = await page.request.post("/api/chat");
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const url = new URL(path, "http://localhost");
  url.searchParams.set("chat", id);
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
}

export async function send(page: Page, text: string) {
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.fill(text);
  await field.press("Enter");
}

export const lastAnswer = (page: Page) => page.locator("[data-status]").last();
export const chatIdOf = (page: Page) => new URL(page.url()).searchParams.get("chat")!;
/** Миниатюра картинки в ленте: кнопка, открывающая окно просмотра; имя файла — в её подписи (договор скина v13). */
export const feedThumbnail = (page: Page, fileName: string) => page.getByRole("log").getByRole("button", { name: `Открыть картинку: ${fileName}` });

/** Номера абзацев длинного ответа заглушки в порядке появления. */
export async function paragraphNumbers(answer: Locator): Promise<number[]> {
  const text = await answer.innerText();
  return [...text.matchAll(/Абзац (\d+):/g)].map((match) => Number(match[1]));
}

/** Абзацы идут 1, 2, 3… без повторов и пропусков. */
export function expectConsecutiveFromOne(numbers: number[]) {
  expect(numbers).toEqual(numbers.map((_, index) => index + 1));
}

/** Самый большой номер абзаца в ответе. */
export async function lastParagraph(answer: Locator): Promise<number> {
  return Math.max(...(await paragraphNumbers(answer)));
}

/** Входит, просит длинный ответ (по умолчанию — обычный) и ждёт, пока на экране появится нужный абзац. Возвращает ответ. */
export async function startLongAnswer(page: Page, { question = "Дай длинный ответ", paragraph = 3 } = {}) {
  await signIn(page);
  await send(page, question);
  const answer = lastAnswer(page);
  await expect(answer).toContainText(`Абзац ${paragraph}:`);
  return answer;
}

/** Один снимок текста: ожидание и последующие проверки используют одинаковые номера, даже если Markdown перемонтировался. */
async function paragraphSnapshot(answer: Locator, containing?: number): Promise<number[]> {
  let snapshot: number[] = [];
  await expect.poll(async () => {
    snapshot = await paragraphNumbers(answer);
    return containing === undefined ? snapshot.length > 0 : snapshot.includes(containing);
  }).toBe(true);
  return snapshot;
}

/**
 * «Остановить», затем обновление страницы: ответ остановлен и сохранён так, как был на экране. Абзацы идут подряд;
 * сервер мог дописать кусок, пока шёл запрос «стоп», но не больше. Возвращает ответ после обновления.
 */
export async function stopAndExpectKeptAfterReload(page: Page, answer: Locator) {
  const seenBeforeStop = Math.max(...await paragraphSnapshot(answer));
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(answer.getByText("Остановлено")).toBeVisible();
  const stopped = await paragraphSnapshot(answer, seenBeforeStop);
  expectConsecutiveFromOne(stopped);
  const shown = Math.max(...stopped);

  await page.reload();
  const restored = lastAnswer(page);
  await expect(restored.getByText("Остановлено")).toBeVisible();
  const kept = await paragraphSnapshot(restored, shown);
  expectConsecutiveFromOne(kept);
  expect(Math.max(...kept)).toBeGreaterThanOrEqual(shown);
  expect(Math.max(...kept)).toBeLessThanOrEqual(shown + 1);
  return restored;
}

/** «Повторить» после сбоя: идёт новый ответ, он начинается с первого абзаца; ответ один, вопрос один. Возвращает новый ответ. */
/**
 * Сервер упал посреди ответа и поднялся: ответ в базе ещё «идёт», пока сервер не сочтёт его брошенным — до ~20 с
 * после падения (FR-060). Экран сам перечитывает историю и показывает «Ответ прерван» и «Повторить» без обновления.
 */
export async function expectInterruptedWithoutReload(page: Page) {
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "interrupted", { timeout: 40_000 });
  await expect(answer.getByText("Ответ прерван")).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(1);
  return answer;
}

export async function expectRetryStartsFreshAnswer(page: Page, question: string) {
  await page.getByRole("button", { name: "Повторить" }).click();
  const retried = lastAnswer(page);
  await expect(retried).toHaveAttribute("data-status", "streaming");
  await expect(retried).toContainText("Абзац 2:");
  expect((await paragraphNumbers(retried))[0]).toBe(1);
  await expect(page.locator("[data-status]")).toHaveCount(1);
  await expect(page.getByRole("log").getByText(question)).toHaveCount(1);
  return retried;
}

/** Имитация сбоя провайдера в настройках стенда. */
export async function simulateFailure(page: Page, option: "Без сбоев" | "Перегрузка модели" | "Перегрузка у первого провайдера" | "Неверный ключ" | "Разговор завершён (409)" | "Урок закрыт (проверка перед ходом)") {
  await page.getByRole("button", { name: "Имитация сбоя" }).click();
  await page.getByRole("menuitemradio", { name: option }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** Короткие сроки связи стенда: вкладка терпит тишину 3 с, попытки — 0, 0,5 и 0,5 с, запрос — 2 с. */
export async function useShortLiveness(page: Page) {
  await page.addInitScript(() => localStorage.setItem("demo-liveness", "short"));
}

interface Appearance {
  /** Имя отметки, по нему время читается обратно. */
  name: string;
  /** Появление элемента по селектору. */
  selector?: string;
  /** Появление текста где-либо на странице. */
  text?: string;
}

/**
 * Запоминает миг, когда что-то впервые появилось в странице. Быстрые состояния (строка «Переподключаемся…» живёт
 * доли секунды) ускользают от опроса, а «не было раньше срока» иначе не проверить без паузы в тесте.
 */
export async function watchAppearance(page: Page, appearance: Appearance) {
  await page.evaluate((watched) => {
    const seen = ((window as unknown as { __seen?: Record<string, number> }).__seen ??= {});
    const check = () => {
      if (watched.name in seen) return;
      const found = watched.selector ? document.querySelector(watched.selector) !== null : document.body.textContent?.includes(watched.text ?? "");
      if (found) seen[watched.name] = Date.now();
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
    check();
  }, appearance);
}

/** Когда (по часам страницы) отмеченное появилось; ждёт появления. */
export async function appearedAt(page: Page, name: string, timeout: number): Promise<number> {
  await expect.poll(() => page.evaluate((key) => (window as unknown as { __seen?: Record<string, number> }).__seen?.[key] ?? null, name), { timeout }).not.toBeNull();
  return page.evaluate((key) => (window as unknown as { __seen: Record<string, number> }).__seen[key]!, name);
}

/** Кнопка выбора модели в поле ввода: подпись «Модель: <модель>, <провайдер>». */
export const modelButton = (page: Page) => page.getByRole("button", { name: /^Модель: / });

/** Кнопка уровня рассуждений: подпись «Рассуждения: <уровень>». */
export const reasoningButton = (page: Page) => page.getByRole("button", { name: /^Рассуждения: / });

/** Меню → подменю провайдера → модель. */
export async function chooseModel(page: Page, provider: string, model: string) {
  await modelButton(page).click();
  await page.getByRole("menuitem", { name: provider, exact: true }).click();
  await page.getByRole("menuitemradio", { name: model, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** Названия уровней в открытом меню рассуждений, по порядку; меню закрывается. */
export async function reasoningLevelNames(page: Page): Promise<string[]> {
  await reasoningButton(page).click();
  const names = await page.getByRole("menu").getByRole("menuitemradio").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  return names;
}

export async function chooseReasoning(page: Page, level: string) {
  await reasoningButton(page).click();
  await page.getByRole("menuitemradio", { name: level, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}
