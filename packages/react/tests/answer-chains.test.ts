import { describe, expect, it } from "vitest";
import { settledWithoutText } from "../src/answer-chains";
import type { AgentChatMessage } from "../src/chat-types";

// Цепочки ответов пересчитываются на каждом куске потока: текст законченных ответов не собирается заново каждый раз.

function countingAnswer(text: string) {
  let reads = 0;
  const part = { type: "text", state: "done" } as { type: "text"; state: "done"; text: string };
  Object.defineProperty(part, "text", { get: () => (reads++, text), enumerable: true });
  const message = { id: "a1", role: "assistant", parts: [part], metadata: { status: "complete" } } as unknown as AgentChatMessage;
  return { message, reads: () => reads };
}

describe("settledWithoutText: законченный ответ без текста", () => {
  it("ответ с текстом — нет; ответ без текста — да; идущий — нет", () => {
    expect(settledWithoutText(countingAnswer("Готово.").message, { streaming: false, voiceAnswer: false })).toBe(false);
    expect(settledWithoutText(countingAnswer("  ").message, { streaming: false, voiceAnswer: false })).toBe(true);
    expect(settledWithoutText(countingAnswer("").message, { streaming: true, voiceAnswer: false })).toBe(false);
  });

  it("тот же законченный ответ на следующем куске потока — текст не перечитывается", () => {
    const answer = countingAnswer("Готово.");
    settledWithoutText(answer.message, { streaming: false, voiceAnswer: false });
    const first = answer.reads();
    for (let chunk = 0; chunk < 5; chunk++) settledWithoutText(answer.message, { streaming: false, voiceAnswer: false });
    expect(answer.reads()).toBe(first);
  });

  it("ответ изменился (другой объект или другие части) — считается заново", () => {
    const answer = countingAnswer("Готово.");
    settledWithoutText(answer.message, { streaming: false, voiceAnswer: false });
    const changed = { ...answer.message, parts: [] } as AgentChatMessage;
    expect(settledWithoutText(changed, { streaming: false, voiceAnswer: false })).toBe(true);
  });
});
