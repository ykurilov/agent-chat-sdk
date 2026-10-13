// Живая проверка голоса с настоящим Soniox (FR-025, SC-006), прямой режим: сервер выдаёт временный ключ,
// русская речь (`say -v Milena`) уходит по WebSocket так же, как из браузера, и возвращается текстом.
// Ключ — только из окружения (`pnpm secrets:load`), в вывод не попадает. Запуск: `pnpm test:live soniox`.
// Из России: SONIOX_API_BASE_URL — адрес прокси, PROXY_TOKEN — его токен; WebSocket идёт напрямую или на SONIOX_WEBSOCKET_URL.
import { describe, expect, it } from "vitest";
import { dictate, expectPhraseRecognized, requestSession, speechAs } from "./support";

describe.skipIf(!process.env.SONIOX_API_KEY)("Soniox: русская речь → текст (прямой режим)", () => {
  it("временный ключ от сервера, диктовка проходит, слова узнаны", async () => {
    const session = await requestSession();
    expect(session.apiKey).not.toBe(process.env.SONIOX_API_KEY);

    expectPhraseRecognized(await dictate(session, speechAs(["-f", "wav"]), 4096));
  });
});
