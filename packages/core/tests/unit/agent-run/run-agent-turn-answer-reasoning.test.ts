import { expect, it } from "vitest";
import { toAgentChatMessage } from "../../../src/conversation/to-agent-chat-message";
import { answerReasoningOf } from "../../../src/conversation/answer-reasoning";
import { mockModel, readAll, streamOf, streamStart, textParts, finishPart } from "../support/mock-model";
import { startTurn, storageWithQuestion, savedAnswer } from "../support/turn-fixtures";

it("уровень ответа одинаков в потоке и после чтения из базы, служебная часть не уходит в UI", async () => {
  const storage = await storageWithQuestion();
  const model = mockModel(() => streamOf([streamStart, ...textParts(["Готово"]), finishPart()]));
  const chunks = await readAll(startTurn(storage, model, { reasoning: "high" }));
  expect(chunks.some((chunk) => "messageMetadata" in chunk && (chunk.messageMetadata as { reasoningLevel?: string } | undefined)?.reasoningLevel === "high")).toBe(true);
  const stored = await savedAnswer(storage);
  expect(answerReasoningOf(stored!.parts)).toBe("high");
  const view = toAgentChatMessage(stored!);
  expect(view.metadata?.reasoningLevel).toBe("high");
  expect(view.parts.some((part) => part.type === "data-answer-reasoning")).toBe(false);
});
