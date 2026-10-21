// Живой замер цены заголовка раздумья (0.69.1): что уходит DeepSeek 4.1 Flash, сколько входа попало в кэш, сколько
// стоит заголовок. Раздумья — длинные английские черновики, как у DeepSeek в ходе со сборкой. Падает, только если
// заголовков нет; числа — в отчёт. 3 вызова на прогон. Запуск: `pnpm test:live thought-title-cost`.
import { describe, expect, it } from "vitest";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { createThoughtTitleModel } from "../../src/thought-titles/thought-title-model";
import { cleanThoughtTitle } from "../../src/thought-titles/thought-title-text";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY в окружении");

const thoughts: string[] = [
  `The user wants a tic-tac-toe game in src/game.ts. First I should understand the existing structure. README says the code lives in src/game.ts and tests run with npm test. The current file only has a newGame stub with a TODO. I need to design the state: a 3x3 board as an array of 9 cells, each null, "X" or "O"; the current player; the winner or a draw flag. Then functions: newGame() returning initial state, makeMove(state, index) returning a new state or throwing on an occupied cell or a finished game, and a helper to check winning lines — rows, columns and two diagonals, eight lines total. For a draw: all cells filled and no winner. I should keep it immutable so tests are easy. Also export the lines constant maybe. Edge cases: move out of range, move after game over. Tests mention: win by row, by diagonal, and a draw. Let me also think about the score across games — README doesn't mention it, but the user said "игра", a simple score object {X, O, draws} could be handy but it's extra scope; I'll skip unless asked. Now write the file with clear names. After writing I'll run the tests to verify. If a test fails, I'll read the output and fix the logic, most likely the diagonal check or the draw condition ordering, because a full board with a winning line must count as a win, not a draw. So check win first, then draw.`,
  `Tests passed: 3 tests — row win, diagonal win, draw. Good. Now the user expects a summary in Russian, short. I should mention what I did: read README, implemented the game logic in src/game.ts with newGame and makeMove, win detection over eight lines, draw detection, and ran the tests which passed. I couldn't find separate test files earlier when I tried reading game.test.ts — the tool said no such file — but run_tests reported three passing tests, so tests exist somewhere the tool can run. I shouldn't claim I wrote tests. Maybe suggest next steps: a simple UI or a score counter. Keep it concise, no code dump. Mention the API briefly so the user knows how to use it: newGame(), makeMove(state, index). Also note that moves into occupied cells throw an error. That's enough for the report; avoid over-explaining internals like the lines array.`,
  `Hmm, the user now asks to make the board size configurable, like 4x4 with four in a row. That changes the win detection: I can't hardcode eight lines anymore. I need to generate lines for an N x N board with K in a row: for each cell, look in four directions (right, down, down-right, down-left) and collect K cells if they stay inside the board. Precompute the lines once per board size and cache them. The state should carry size and winLength. newGame(size = 3, winLength = size) keeps the old behaviour by default, so existing tests still pass. makeMove needs bounds check against size*size. Draw detection stays the same. Performance is fine for small boards. I should also update the README example. Then run tests again; the old three should pass unchanged, and I might add a quick sanity check mentally for 4x4: lines count = rows 4 + cols 4 + diagonals 2 when K = 4, total 10. With K = 3 on 4x4 there are more: rows 2*4 + cols 2*4 + diag 4 + anti-diag 4 = 24.`,
];
// Длинное раздумье (≈3800 знаков), как у конструктора приложений в больших ходах: три черновика подряд.
thoughts.push(thoughts.join(" "));
const chosen = process.env.ONLY_LONG === "1" ? thoughts.slice(-1) : thoughts;

describe("цена заголовка раздумья вживую", () => {
  it("вход, кэш и цена каждого заголовка — в отчёт", async () => {
    const usages: Array<{ prompt: number; hit: number; out: number; system: number; user: number }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await realFetch(url, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const json = (await response.clone().json()) as { usage?: { prompt_tokens: number; prompt_cache_hit_tokens?: number; completion_tokens: number } };
      const length = (role: string) => body.messages?.filter((message) => message.role === role).map((message) => message.content.length).reduce((a, b) => a + b, 0) ?? 0;
      if (json.usage) usages.push({ prompt: json.usage.prompt_tokens, hit: json.usage.prompt_cache_hit_tokens ?? 0, out: json.usage.completion_tokens, system: length("system"), user: length("user") });
      return response;
    }) as typeof fetch;
    const storage = createInMemoryChatStorage();
    const titleModel = createThoughtTitleModel(
      { storage, catalog: standardCatalog, env: process.env, logError: console.error, assertWithinLimit: async () => {}, afterSpending: () => {} },
      { modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "off" },
      20_000,
    );
    const titles: string[] = [];
    try {
      for (const text of chosen) titles.push((await titleModel({ ownerId: "tester", chatId: "c1", messageId: "a1", text, language: "ru" })) ?? "");
    } finally {
      globalThis.fetch = realFetch;
    }
    const [sum] = await storage.sumUsage({ chatId: "c1", source: "thought_title" });
    console.log("\nзаголовок | знаков system/user | вход (кэш) | выход");
    usages.forEach((usage, index) => console.log(`«${titles[index]}» → ${cleanThoughtTitle(titles[index]!, { maxLength: 60, language: "ru" }) ?? "ОТБРОШЕН"} | ${usage.system}/${usage.user} | ${usage.prompt} (${usage.hit}) | ${usage.out}`));
    console.log(`итого: $${sum!.costUsd.toFixed(6)} за ${titles.length}, в среднем $${(sum!.costUsd / titles.length).toFixed(6)} за заголовок`);
    expect(titles.filter(Boolean)).toHaveLength(chosen.length);
  });
});
