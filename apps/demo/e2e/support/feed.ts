import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import type { JSHandle, Locator, Page } from "@playwright/test";
import { signIn } from "./chat";

/** Помощники для проверок длинной ленты (фича 002): засев чата, открытие снизу, прокрутка пальцем, долгие задачи. */

const execFileAsync = promisify(execFile);
const demoDir = fileURLToPath(new URL("../..", import.meta.url));

export const OPEN_LIMIT_MS = 1_000;
export const LONG_TASK_LIMIT_MS = 200;
export const FEED_ITEMS_LIMIT = 40;
/** Телефон средней руки: процессор в 4 раза медленнее компьютера. */
export const PHONE_CPU_SLOWDOWN = 4;

interface LongTask {
  start: number;
  duration: number;
}

/** Долгие задачи главного потока копятся с самой загрузки страницы; у каждой запоминается начало. */
export async function observeLongTasks(page: Page) {
  await page.addInitScript(() => {
    const tasks: LongTask[] = [];
    (window as unknown as { longTasks: LongTask[] }).longTasks = tasks;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Движок без longtask (WebKit): замеров нет.
    }
  });
}

/** Замедление процессора в Chromium через CDP; в WebKit его нет, и страница идёт на полной скорости. */
export async function slowDownCpu(page: Page, rate = PHONE_CPU_SLOWDOWN) {
  if (page.context().browser()?.browserType().name() !== "chromium") return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

/** Долгие задачи, начавшиеся не раньше `since`, и сброс накопленного. */
export async function takeLongTasks(page: Page, since = 0): Promise<number[]> {
  return page.evaluate((from) => {
    const tasks = (window as unknown as { longTasks: LongTask[] }).longTasks;
    return tasks.splice(0, tasks.length).filter((task) => task.start >= from).map((task) => task.duration);
  }, since);
}

export const longest = (tasks: number[]) => Math.max(0, ...tasks);

export async function seedChat(messageCount: number): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=@ykurilov/agent-chat-source", "--import", "tsx", "server/seed-long-chat.ts", "--user", "anna", "--messages", String(messageCount)],
    { cwd: demoDir, env: { ...process.env, DEMO_DB_FILE: process.env.DEMO_E2E_DB_FILE } },
  );
  return stdout.trim();
}

/** Метка последнего ответа засеянного чата: заголовок «Ответ N» у пары номер N. */
export const lastAnswerMarker = (messageCount: number) => `Ответ ${messageCount / 2}`;

/**
 * Следит за открытием чата с самой загрузки страницы: записывает, когда последнее сообщение
 * впервые целиком в экране. Приход истории — `responseEnd` запроса `GET /api/chat/:id`.
 */
async function watchOpening(page: Page, marker: string) {
  await page.addInitScript(
    ({ marker: mark }) => {
      const state = { lastMessageShownAt: null as number | null };
      (window as unknown as { opening: typeof state }).opening = state;
      const frame = () => {
        const answers = document.querySelectorAll("[data-status]");
        const last = answers[answers.length - 1];
        const scroller = document.querySelector('[role="log"]')?.parentElement;
        if (last && scroller && last.textContent?.includes(mark)) {
          const box = last.getBoundingClientRect();
          const view = scroller.getBoundingClientRect();
          if (box.bottom <= view.bottom + 1 && (box.top >= view.top - 1 || box.height > view.height)) {
            state.lastMessageShownAt = performance.now();
            return;
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { marker },
  );
}

export interface Opening {
  historyArrivedAt: number;
  lastMessageShownAt: number;
  openingMs: number;
}

export async function readOpening(page: Page, chatId: string): Promise<Opening> {
  await page.waitForFunction(() => (window as unknown as { opening: { lastMessageShownAt: number | null } }).opening.lastMessageShownAt !== null, undefined, {
    timeout: 30_000,
  });
  const { historyArrivedAt, lastMessageShownAt } = await page.evaluate((id) => {
    const arrivals = performance
      .getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).pathname === `/api/chat/${id}` && (entry as PerformanceResourceTiming).responseEnd > 0)
      .map((entry) => (entry as PerformanceResourceTiming).responseEnd);
    return {
      historyArrivedAt: Math.min(...arrivals),
      lastMessageShownAt: (window as unknown as { opening: { lastMessageShownAt: number } }).opening.lastMessageShownAt,
    };
  }, chatId);
  expect(Number.isFinite(historyArrivedAt), "запрос истории чата не найден среди ресурсов страницы").toBe(true);
  return { historyArrivedAt, lastMessageShownAt, openingMs: lastMessageShownAt - historyArrivedAt };
}

/**
 * Ждёт, пока у последнего ответа станет нужный статус. Не через `expect(...).toHaveAttribute`: каждый его опрос
 * снимает снимок доступности всей страницы, и на огромном ответе этот снимок сам занимает главный поток на
 * 50–200 мс (research.md, R16). В замере долгих задач это чужая работа, а не продукта.
 */
export async function waitForLastAnswerStatus(page: Page, status: "streaming" | "complete", timeout = 30_000) {
  await page.waitForFunction(
    (wanted) => {
      const answers = document.querySelectorAll("[data-status]");
      return answers[answers.length - 1]?.getAttribute("data-status") === wanted;
    },
    status,
    { polling: 500, timeout },
  );
}

export const feedItems = (page: Page) => page.locator("[data-feed-item]");

/** Расстояние от низа окна ленты до конца списка. */
export const distanceFromBottom = (page: Page) =>
  page.getByRole("log").evaluate((log) => {
    const scroller = log.parentElement!;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  });

export interface Sweep {
  reachedEdge: boolean;
  frames: number;
  maxItems: number;
  emptyFrames: number;
  firstShown: boolean;
  lastShown: boolean;
}

/**
 * Прокрутка ленты пальцем: шагами по кадрам до края. В каждом кадре считает элементы ленты и
 * проверяет, что экран закрыт сообщениями без пустот: сообщения идут вплотную, а сверху и снизу
 * пусто может быть только у самого первого и самого последнего сообщения (там отступ ленты).
 */
export async function sweepFeed(
  page: Page,
  direction: "up" | "down",
  firstMarker: string,
  lastMarker: string,
  { flingScreens }: { flingScreens?: number } = {},
): Promise<Sweep> {
  return page.getByRole("log").evaluate(
    async (log, args) => {
      const scroller = log.parentElement!;
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const step = scroller.clientHeight * 0.8;
      // Ждёт, пока прокрутка затихнет: от последнего события прошло 250 мс. Так читатель останавливается между бросками.
      const untilScrollQuiet = () =>
        new Promise<void>((resolve) => {
          let timer = setTimeout(done, 250);
          function done() {
            scroller.removeEventListener("scroll", restart);
            resolve();
          }
          function restart() {
            clearTimeout(timer);
            timer = setTimeout(done, 250);
          }
          scroller.addEventListener("scroll", restart, { passive: true });
        });
      const flingFrames = args.flingScreens ? Math.ceil(args.flingScreens / 0.8) : 0;
      const sweep = { reachedEdge: false, frames: 0, maxItems: 0, emptyFrames: 0, firstShown: false, lastShown: false };
      const atEdge = () =>
        args.direction === "up" ? scroller.scrollTop <= 0 : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      for (; sweep.frames < 800; sweep.frames++) {
        const view = scroller.getBoundingClientRect();
        const items = [...document.querySelectorAll("[data-feed-item]")]
          .map((item) => ({ box: item.getBoundingClientRect(), text: item.textContent ?? "" }))
          .filter(({ box }) => box.bottom > view.top && box.top < view.bottom)
          .sort((a, b) => a.box.top - b.box.top);
        sweep.maxItems = Math.max(sweep.maxItems, document.querySelectorAll("[data-feed-item]").length);
        const first = items[0];
        const last = items[items.length - 1];
        const gaps = items.some((item, index) => index > 0 && item.box.top - items[index - 1]!.box.bottom > 1);
        const topOpen = !first || (first.box.top > view.top + 1 && !first.text.includes(args.firstMarker));
        const bottomOpen = !last || (last.box.bottom < view.bottom - 1 && !last.text.includes(args.lastMarker));
        if (gaps || topOpen || bottomOpen) sweep.emptyFrames++;
        sweep.firstShown ||= items.some((item) => item.text.includes(args.firstMarker));
        sweep.lastShown ||= items.some((item) => item.text.includes(args.lastMarker));
        if (atEdge()) {
          // Бросок упёрся в край до того, как окно ленты измерило сообщения за ним: после остановки список
          // подрос, и до настоящего края ещё есть путь. Край засчитывается, только если и после остановки лента у края.
          if (flingFrames) {
            await untilScrollQuiet();
            if (!atEdge()) continue;
          }
          sweep.reachedEdge = true;
          // Крайнее сообщение окно ленты дорисовывает через кадр-другой после последнего шага (на нагруженной
          // машине дольше): ждём его показа, а эти кадры в пустоты не считаем.
          const edgeMarker = args.direction === "up" ? args.firstMarker : args.lastMarker;
          for (let settle = 0; settle < 120; settle++) {
            const shown = [...document.querySelectorAll("[data-feed-item]")].some((item) => (item.textContent ?? "").includes(edgeMarker));
            if (shown) {
              if (args.direction === "up") sweep.firstShown = true;
              else sweep.lastShown = true;
              break;
            }
            await frame();
          }
          break;
        }
        scroller.scrollTop += args.direction === "up" ? -step : step;
        await frame();
        if (flingFrames && (sweep.frames + 1) % flingFrames === 0) await untilScrollQuiet();
      }
      return sweep;
    },
    { direction, firstMarker, lastMarker, flingScreens },
  );
}

/** Бросок читателя в WebKit: см. `expectCleanSweep` в feed.spec.ts; в Chromium проход идёт без остановок. */
export const readerFling = (browserName: string) => (browserName === "webkit" ? { flingScreens: 8 } : {});

export const FIRST_QUESTION_MARKER = "Вопрос 1:";

/** Проход ленты до края без пустот на экране; возвращает проход для замеров. */
export async function expectCleanSweep(page: Page, direction: "up" | "down", messageCount: number, options?: { flingScreens?: number }): Promise<Sweep> {
  const sweep = await sweepFeed(page, direction, FIRST_QUESTION_MARKER, lastAnswerMarker(messageCount), options);
  const up = direction === "up";
  expect(sweep.reachedEdge, `${up ? "верх" : "низ"} ленты достигнут`).toBe(true);
  expect(up ? sweep.firstShown : sweep.lastShown, `${up ? "первое" : "последнее"} сообщение чата показано`).toBe(true);
  expect(sweep.emptyFrames, `кадров с пустотой на экране при прокрутке ${up ? "вверх" : "вниз"}`).toBe(0);
  expect(sweep.maxItems).toBeGreaterThan(0);
  expect(sweep.maxItems).toBeLessThanOrEqual(FEED_ITEMS_LIMIT);
  return sweep;
}

/** Лента едет за растущим ответом: читатель остаётся у его низа, пока пишутся абзацы 8 и 14 (модель — около абзаца в секунду). */
export async function expectFeedFollowsAnswer(page: Page, answer: Locator) {
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
  for (const paragraph of [8, 14]) {
    // Под нагрузкой полного прогона 10 с по умолчанию мало.
    await expect(answer).toContainText(`Абзац ${paragraph}:`, { timeout: 30_000 });
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
  }
}

/**
 * Входит, засевает чат нужной длины и открывает его, следя за открытием с самой загрузки страницы;
 * возвращается, когда последнее сообщение показано.
 */
export async function openLongChat(page: Page, messageCount: number): Promise<Opening> {
  await signIn(page);
  const chatId = await seedChat(messageCount);
  await watchOpening(page, lastAnswerMarker(messageCount));
  await page.goto(`/?chat=${chatId}`);
  return readOpening(page, chatId);
}

/**
 * Ждёт, пока место на экране первого видимого сообщения простоит неподвижно 30 кадров подряд (около полсекунды).
 * Окно ленты после открытия или прыжка измеряет сообщения и поправляет прокрутку; пока оно не улеглось,
 * положение читателя ещё не установилось. Возвращает это сообщение.
 */
export async function waitUntilFeedStill(page: Page): Promise<JSHandle<Element>> {
  const stillFirst = await page.waitForFunction(
    () => {
      const view = document.querySelector('[role="log"]')!.parentElement!.getBoundingClientRect();
      const first = [...document.querySelectorAll("[data-feed-item]")].find((element) => element.getBoundingClientRect().bottom > view.top + 40);
      const top = first?.getBoundingClientRect().top;
      const still = window as unknown as { __feedSpot?: { top?: number; frames: number } };
      const spot = still.__feedSpot;
      still.__feedSpot = spot && spot.top === top ? { top, frames: spot.frames + 1 } : { top, frames: 0 };
      return still.__feedSpot.frames >= 30 && first;
    },
    undefined,
    { polling: "raf" },
  );
  return stillFirst as JSHandle<Element>;
}

/**
 * Подводит элемент в окно ленты и ждёт, пока лента уляжется. Автопрокрутка Playwright в WebKit тут не годится: она
 * сверяет элемент с окном страницы, а не с лентой, и кнопку, ушедшую под шапку над лентой, считает видимой — клик
 * попадает в шапку.
 */
export async function scrollIntoFeedView(page: Page, target: Locator) {
  await expect(async () => {
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await waitUntilFeedStill(page);
    const inside = await target.evaluate((element) => {
      const view = document.querySelector('[role="log"]')!.parentElement!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return box.top >= view.top && box.bottom <= view.bottom;
    });
    expect(inside, "элемент не встал в окно ленты").toBe(true);
  }).toPass({ timeout: 30_000 });
}
