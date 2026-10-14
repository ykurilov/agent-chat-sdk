import type { BeforeTurnDecision, BeforeTurnHandler } from "@ykurilov/agent-chat-core";
import type { FlowAdmit } from "./admit";

// Этап 8 сценариев: то же решение о входящем для каналов SDK — через `beforeTurn` службы чата.

/**
 * Ворота хода сценария: сообщение человека (`send`) проходит через `admit`. Готовая фраза — `{ reply }`, промолчать —
 * `{ hold }`. Закончен разговор — по режиму сценария (→ В6): `reply` — ход идёт, агент ответит по общей части;
 * `silent` — сообщение записано, агент молчит.
 */
export function flowTurnGate(admit: FlowAdmit): BeforeTurnHandler {
  return async ({ chat, action, text, burstMessageIds }): Promise<BeforeTurnDecision | void> => {
    if (action !== "send") return;
    // Пачка сообщений (`sendBurstMessage`) решается разом: в рамки дня идёт каждое её сообщение.
    const decision = await admit({ ownerId: chat.ownerId, chatId: chat.id, ...(text !== undefined && { text }), ...(burstMessageIds && { messages: burstMessageIds.length }) });
    switch (decision.kind) {
      case "answer":
        return;
      case "ended":
        return decision.afterEnd === "silent" ? { hold: true } : undefined;
      case "reply":
        return { reply: { text: decision.text } };
      case "hold":
      case "paused":
        return { hold: true };
    }
  };
}
