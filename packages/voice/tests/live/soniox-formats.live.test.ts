// Живая проверка форматов записи браузеров (FR-009): куски ~120 мс в webm/opus (Chrome, Firefox) и
// в фрагментированном mp4/AAC (Safari) уходят в настоящий Soniox тем же путём, что из браузера.
// Запуск: `pnpm test:live soniox-formats`. Ключ — из окружения (`pnpm secrets:load`).
import { describe, expect, it } from "vitest";
import { dictate, expectPhraseRecognized, requestSession, speechAs } from "./support";

// ~120 мс при 32 кбит/с.
const chunkBytes = 480;

describe.skipIf(!process.env.SONIOX_API_KEY)("Soniox: форматы записи кусками", () => {
  it("webm/opus кусками", async () => {
    const audio = speechAs(["-c:a", "libopus", "-b:a", "32k", "-f", "webm"]);
    expectPhraseRecognized(await dictate(await requestSession(), audio, chunkBytes));
  });

  it("ogg/opus кусками", async () => {
    const audio = speechAs(["-c:a", "libopus", "-b:a", "32k", "-f", "ogg"]);
    expectPhraseRecognized(await dictate(await requestSession(), audio, chunkBytes));
  });

  it("фрагментированный mp4/AAC кусками (как пишет Safari)", async () => {
    const audio = speechAs(["-c:a", "aac", "-b:a", "32k", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]);
    expect(audio.length).toBeGreaterThan(chunkBytes);
    expectPhraseRecognized(await dictate(await requestSession(), audio, chunkBytes));
  });
});
