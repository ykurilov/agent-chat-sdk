import { describe, expect, it } from "vitest";
import type { AgentChatMessage } from "../src/chat-types";
import { closeStoppedToolCalls } from "../src/close-stopped-tool-calls";

type MessagePart = AgentChatMessage["parts"][number];

/** Тексты сервера при «Стопе» (core: approval-parts.ts): экран показывает то же, что покажет перезагрузка. */
const interruptedText = "Ход прерван раньше, чем пользователь ответил на запрос. Действие не выполнялось.";
const resultUnknownText =
  "Пользователь разрешил действие, но ход прервался до результата. Неизвестно, выполнено оно или нет; не повторяй его, не проверив.";

const part = (fields: Record<string, unknown>) => ({ type: "tool-clear_notes", toolCallId: "c1", input: {}, ...fields }) as unknown as MessagePart;

describe("closeStoppedToolCalls: подтверждения после «Стопа», как denyPendingApprovals сервера", () => {
  it("разрешённый, но без результата вызов становится отказом «результат неизвестен»", () => {
    const [closed] = closeStoppedToolCalls([part({ state: "approval-responded", approval: { id: "ap1", approved: true } })]);
    expect(closed).toMatchObject({ state: "output-denied", approval: { id: "ap1", approved: false, reason: resultUnknownText } });
  });

  it("отклонённый человеком с причиной сохраняет его причину", () => {
    const [closed] = closeStoppedToolCalls([
      part({ state: "approval-responded", approval: { id: "ap1", approved: false, reason: "Не надо" } }),
    ]);
    expect(closed).toMatchObject({ state: "output-denied", approval: { id: "ap1", approved: false, reason: "Не надо" } });
  });

  it("отклонённый без причины получает текст «ход прерван»", () => {
    const [closed] = closeStoppedToolCalls([part({ state: "approval-responded", approval: { id: "ap1", approved: false } })]);
    expect(closed).toMatchObject({ state: "output-denied", approval: { id: "ap1", approved: false, reason: interruptedText } });
  });
});
