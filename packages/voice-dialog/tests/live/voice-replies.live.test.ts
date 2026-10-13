// Живая озвучка голосовых ответов в ElevenLabs (027, T094). Ключ — только из окружения (`.env.local` читает проект `live`).
// Запуск: `pnpm exec vitest run --project live packages/voice-dialog/tests/live/voice-replies.live.test.ts`.
// Платный тест: сначала печатает оценку (знаки × цена за 1000 знаков, `eleven_v4_turbo` $0,11) и отказывается идти дальше,
// если оценка выше $0,5. 4 ответа по ~500 знаков ≈ $0,22. Проверяет: пришёл настоящий Ogg/Opus, длительность в упаковке
// сходится с длительностью по независимому разбору и по ffprobe (звук играет), длительность правдоподобна для речи,
// расход записан по числу отправленных знаков. Тексты и ключ не печатаются; печатаются знаки, секунды и цена.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createVoiceReplies } from "../../src/server";
import { readOggOpus } from "../support/ogg-reader";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("Нет ELEVENLABS_API_KEY: выполните `pnpm secrets:load`");

const PRICE_PER_THOUSAND = 0.11;
const BUDGET_USD = 0.5;
const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George, готовый голос ElevenLabs (не секрет)

const sentences = [
  "Сегодня в офисе тихо, и это отличный повод разобрать накопившиеся письма.",
  "Сначала отвечаем на срочные, потом на те, что можно отложить до завтра.",
  "Если что-то непонятно, лучше уточнить сразу, чем потом переделывать работу.",
  "К вечеру список дел обычно сам становится короче, главное не отвлекаться.",
  "Кофе на кухне свежий, а отчёт за неделю уже лежит в общей папке.",
  "Пожалуйста, посмотрите его до обеда и оставьте комментарии прямо в документе.",
];
/** Ответ около 500 знаков из предложений выше; у каждого ответа свой сдвиг, чтобы тексты различались. */
const replyText = (shift: number) => [...sentences.slice(shift), ...sentences.slice(0, shift)].join(" ").slice(0, 520).replace(/[^.]*$/, "").trim();
const replies = [0, 1, 2, 3].map(replyText);

describe("T094: живая озвучка голосового ответа (ElevenLabs eleven_v4_turbo)", { timeout: 150_000 }, () => {
  it("4 ответа по ~500 знаков: звук настоящий, длительность верная, расход записан", async () => {
    const totalChars = replies.reduce((sum, text) => sum + text.length + 1, 0);
    const estimateUsd = (totalChars * PRICE_PER_THOUSAND) / 1000;
    console.log(`[live-estimate] ответов ${replies.length}, знаков ≈${totalChars}, оценка ≈$${estimateUsd.toFixed(3)} (потолок $${BUDGET_USD})`);
    if (estimateUsd > BUDGET_USD) throw new Error(`Оценка $${estimateUsd.toFixed(3)} выше потолка $${BUDGET_USD}: тест не запущен`);

    const storage = createInMemoryChatStorage();
    const logged: string[] = [];
    const voice = createVoiceReplies({
      apiKey: apiKey!,
      voiceId: VOICE_ID,
      model: "eleven_v4_turbo",
      language: "ru",
      storage,
      pricePerThousandChars: { eleven_v4_turbo: PRICE_PER_THOUSAND },
      logError: (message) => logged.push(message),
    });
    const folder = mkdtempSync(join(tmpdir(), "voice-replies-live-"));
    try {
      const facts: string[] = [];
      for (const [index, text] of replies.entries()) {
        const started = Date.now();
        const result = await voice.speak({ text, ownerId: "anna", chatId: "chat-live", messageId: `m-${index}`, signal: new AbortController().signal });
        if (!("audio" in result)) throw new Error(`ответ ${index + 1}: озвучка пропущена (${JSON.stringify(result)}), журнал: ${logged.join(" | ")}`);
        expect(result.mediaType).toBe("audio/ogg");

        const stream = readOggOpus(result.audio);
        expect(stream.pages.every((page) => page.checksum === page.computedChecksum)).toBe(true);
        expect(result.durationMs).toBe(stream.durationMs);

        const file = join(folder, `reply-${index}.ogg`);
        writeFileSync(file, result.audio);
        const probed = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim());
        // Речь по-русски — от 8 до 28 знаков в секунду; ffprobe и упаковщик расходятся не больше чем на 0,3 с.
        const seconds = result.durationMs / 1000;
        expect(seconds).toBeGreaterThan(text.length / 28);
        expect(seconds).toBeLessThan(text.length / 8);
        expect(Math.abs(probed - seconds)).toBeLessThan(0.3);
        facts.push(`ответ ${index + 1}: ${text.length} знаков, ${seconds.toFixed(1)} с (ffprobe ${probed.toFixed(1)} с), файл ${(result.audio.length / 1024).toFixed(0)} КБ, ${((Date.now() - started) / 1000).toFixed(1)} с работы`);
      }
      console.log(`[live-voice]\n  ${facts.join("\n  ")}`);

      const spentRows = await storage.sumUsage({});
      const spent = { costUsd: spentRows.reduce((sum, row) => sum + row.costUsd, 0), chars: spentRows.reduce((sum, row) => sum + row.inputTokens, 0) };
      console.log(`[live-cost] T094 озвучка: записано в расход ≈$${spent.costUsd.toFixed(4)} за ${spent.chars} знаков (оценка по тексту: ${totalChars})`);
      expect(spent.costUsd).toBeGreaterThan(0);
      expect(spent.costUsd).toBeLessThan(BUDGET_USD);
      expect(logged).toEqual([]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
