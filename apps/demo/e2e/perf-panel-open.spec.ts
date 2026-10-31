import { expect, test } from "@playwright/test";
import { lastAnswerMarker, seedChat } from "./support/feed";

/*
 * Замер открытия панели агента (фича 021, SC-002): с загруженной историей панель открывается и последнее сообщение
 * на экране не позже чем через 300 мс после нажатия на кнопку агента. Группа `perf-desktop` (`pnpm test:e2e:perf`): идёт одна, соседи не шумят.
 * Чат на 500 сообщений засеян человеку `anna`; панель открывает его по запомненному ключу: самым свежим в списке он не будет.
 */

const OPEN_LIMIT_MS = 300;
const MESSAGE_COUNT = 500;

test.use({ trace: "off" });

test(`панель с загруженной историей открывается за ${OPEN_LIMIT_MS} мс (SC-002)`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const chatId = await seedChat(MESSAGE_COUNT);
  await page.context().addCookies([{ name: "demo-user", value: "anna", domain: "localhost", path: "/" }]);
  await page.addInitScript((id) => localStorage.setItem("agent-chat:panel-chat:/api/chat:anna", id), chatId);
  const historyLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/chat/${chatId}` && response.ok());
  let historyRequests = 0;
  page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === `/api/chat/${chatId}`) historyRequests++; });
  const watchOpened = page.waitForResponse(response => new URL(response.url()).pathname === `/api/chat/${chatId}/watch` && response.ok());
  await page.goto("/panel-app");
  await historyLoaded;
  await expect(page.getByRole("complementary", { name: "Панель агента" })).toHaveCount(0);
  // История пришла и разобрана; даём странице успокоиться, чтобы замер не ловил хвост загрузки.
  const watch = await watchOpened;
  expect(watch.headers()["x-agent-chat-history-match"]).toBe("1");
  await page.waitForTimeout(1_000);
  expect(historyRequests).toBe(1);

  const openingMs = await page.evaluate(
    ({ marker }) =>
      new Promise<number>((resolve, reject) => {
        const launcher = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Открыть агента");
        if (!launcher) return reject(new Error("кнопки агента нет"));
        const started = performance.now();
        const deadline = started + 10_000;
        const frame = () => {
          const answers = document.querySelectorAll("aside [data-status]");
          const last = answers[answers.length - 1];
          const scroller = document.querySelector('aside [role="log"]')?.parentElement;
          if (last && scroller && last.textContent?.includes(marker)) {
            const box = last.getBoundingClientRect();
            const view = scroller.getBoundingClientRect();
            if (box.bottom <= view.bottom + 1 && (box.top >= view.top - 1 || box.height > view.height)) return resolve(performance.now() - started);
          }
          if (performance.now() > deadline) return reject(new Error("последнее сообщение не показано за 10 с"));
          requestAnimationFrame(frame);
        };
        launcher.click();
        requestAnimationFrame(frame);
      }),
    { marker: lastAnswerMarker(MESSAGE_COUNT) },
  );
  console.log(`[${testInfo.project.name}] панель с историей на ${MESSAGE_COUNT} сообщений открылась за ${Math.round(openingMs)} мс`);
  expect(openingMs).toBeLessThanOrEqual(OPEN_LIMIT_MS);
});
