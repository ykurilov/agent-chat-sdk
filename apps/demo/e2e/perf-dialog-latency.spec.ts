import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LatencyReport } from "@ykurilov/agent-chat-voice-dialog";
import { lastAnswer, signIn } from "./support/chat";
import { dialogSound, installFakeDialogMicrophone, speakDialog } from "./support/fake-dialog-microphone";

/*
 * Замер задержки голосового режима на подменённых Soniox и ElevenLabs (фича 016, T605). Не входит в обычный прогон:
 * `pnpm test:e2e:dialog-latency` (проект `dialog-latency` появляется только с `DEMO_E2E_DIALOG_LATENCY=1`). Запускать после правок,
 * влияющих на скорость, и в конце этапа.
 * На подменах нет ни сети, ни настоящей модели озвучки, поэтому всё, что осталось между готовым первым предложением ответа
 * и первым звуком в браузере, — накладные расходы SDK (сервер, соединение озвучки, плеер). Цель: медиана ≤ 0,4 с (SC-001, вклад SDK).
 * Время самой модели ответа замер показывает отдельно; цели на него на подменах нет.
 */

const TURNS = 8;
const SDK_MEDIAN_LIMIT_MS = 400;

const start = (page: Page) => page.getByRole("button", { name: "Голосовой режим" });
const leave = (page: Page) => page.getByRole("button", { name: "Выйти", exact: true });
const panel = (page: Page) => page.locator("[data-state]").filter({ has: page.getByRole("status") }).first();
const reports = (page: Page) => page.evaluate(() => (window as unknown as { voiceDialogLatency?: LatencyReport[] }).voiceDialogLatency ?? []);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

test(`накладные расходы SDK: от первого предложения до первого звука, медиана ≤ ${SDK_MEDIAN_LIMIT_MS} мс на ${TURNS} ходах`, async ({ page }) => {
  await installFakeDialogMicrophone(page);
  await signIn(page);

  for (let turn = 1; turn <= TURNS; turn += 1) {
    await start(page).click();
    await expect(panel(page)).toHaveAttribute("data-state", "listening");
    await speakDialog(page, dialogSound.phraseOne, 3);
    await speakDialog(page, dialogSound.phraseEnd);
    await expect.poll(async () => (await reports(page)).length, { timeout: 15_000 }).toBe(turn);
    await leave(page).click();
    await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  }

  const all = await reports(page);
  const sdk = all.map((report) => (report.legs.speech ?? NaN) + (report.legs.delivery ?? NaN));
  const leg = (name: "model" | "sentence" | "speech" | "delivery") => median(all.map((report) => report.legs[name] ?? NaN));
  console.log(
    `[dialog-latency] ходов ${all.length}; медиана: всего ${median(all.map((report) => report.totalMs))} мс, ` +
      `модель ${leg("model")}, предложение ${leg("sentence")}, озвучка ${leg("speech")}, доставка ${leg("delivery")}; SDK ${median(sdk)} мс`,
  );
  expect(sdk.every(Number.isFinite)).toBe(true);
  expect(median(sdk)).toBeLessThanOrEqual(SDK_MEDIAN_LIMIT_MS);
});
