import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/*
 * Замеры задержки первой фичи. Группа `perf-desktop` (`pnpm test:e2e:perf`): идёт одна, после замеров ленты, соседи не шумят.
 * SC-001: первые слова ответа на экране не позже чем через 1 с после того, как модель их отдала.
 * SC-002: после «Остановить» текст ответа не растёт дольше 1 с.
 * Модель-заглушка запоминает, когда отдала первый кусок текста (/api/demo/first-text-at),
 * страница — когда текст появился и рос. Сервер и браузер на одной машине: часы общие.
 */

const LIMIT_MS = 1_000;

/** Каждый кадр пишет время и длину текста ответа (без рассуждений и подписей) последнего ответа. */
async function recordAnswerText(page: Page) {
  await page.evaluate(() => {
    const samples: { at: number; length: number }[] = [];
    (window as unknown as { answerSamples: typeof samples }).answerSamples = samples;
    const sample = () => {
      const answers = document.querySelectorAll("[data-status]");
      const answer = answers[answers.length - 1];
      const text = answer ? [...answer.querySelectorAll(".tandem-markdown")].map((block) => block.textContent).join("") : "";
      samples.push({ at: Date.now(), length: text.length });
      requestAnimationFrame(sample);
    };
    sample();
  });
}

const answerSamples = (page: Page) =>
  page.evaluate(() => (window as unknown as { answerSamples: { at: number; length: number }[] }).answerSamples);

test("первые слова на экране не позже 1 с после того, как модель их отдала (SC-001)", async ({ page, baseURL }, testInfo) => {
  await signIn(page);
  const question = `Замер задержки ${testInfo.project.name} ${Date.now()}`;
  await recordAnswerText(page);
  await send(page, question);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");

  const response = await page.request.get(`${baseURL}/api/demo/first-text-at?question=${encodeURIComponent(question)}`);
  const { at: modelSentAt } = (await response.json()) as { at: number | null };
  expect(modelSentAt).not.toBeNull();
  const firstShown = (await answerSamples(page)).find((sample) => sample.length > 0);
  expect(firstShown).toBeDefined();
  const delayMs = firstShown!.at - modelSentAt!;
  console.log(`[${testInfo.project.name}] первые слова через ${delayMs} мс после модели`);
  expect(delayMs).toBeLessThanOrEqual(LIMIT_MS);
});

test("после «Остановить» текст не растёт дольше 1 с (SC-002)", async ({ page }, testInfo) => {
  await signIn(page);
  await recordAnswerText(page);
  await send(page, "Напиши длинный ответ");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  await expect.poll(async () => (await answer.innerText()).length).toBeGreaterThan(200);

  const stopButton = page.getByRole("button", { name: "Остановить" });
  await stopButton.evaluate((button) => {
    button.addEventListener("click", () => ((window as unknown as { stopClickedAt: number }).stopClickedAt = Date.now()), {
      capture: true,
      once: true,
    });
  });
  await stopButton.click();
  await expect(answer).toHaveAttribute("data-status", "stopped");
  // Ждём, пока по часам страницы пройдёт срок и ещё секунда после него: рост позже уже не в счёт, а раньше он записан.
  const stopClickedAt = await page.evaluate(() => (window as unknown as { stopClickedAt: number }).stopClickedAt);
  await page.waitForFunction((until) => Date.now() >= until, stopClickedAt + 2 * LIMIT_MS);

  const samples = await answerSamples(page);
  // Замер видел, как ответ рос до остановки: иначе «0 мс» ничего бы не значило.
  expect(samples.filter((sample) => sample.at < stopClickedAt).at(-1)?.length ?? 0).toBeGreaterThan(100);
  let lastGrowthAt = stopClickedAt;
  for (let index = 1; index < samples.length; index++) {
    if (samples[index]!.length > samples[index - 1]!.length) lastGrowthAt = Math.max(lastGrowthAt, samples[index]!.at);
  }
  const growthAfterStopMs = lastGrowthAt - stopClickedAt;
  console.log(`[${testInfo.project.name}] после «Остановить» текст рос ещё ${growthAfterStopMs} мс`);
  expect(growthAfterStopMs).toBeLessThanOrEqual(LIMIT_MS);
});
