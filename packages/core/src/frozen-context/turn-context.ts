import type { AgentTurnInput } from "../agent-run/run-agent-turn";
import type { AgentViewer } from "../agent-run/agent-viewer";
import type { AppStateValues } from "../app-state/app-state";
import { screenPlaceBlock } from "../agent-run/screen-place";
import { todayBlock } from "../agent-run/today";
import type { AgentChatMessage } from "../conversation/types";
import { appBlocksSource, DEFAULT_CONTEXT_BLOCKS_TIMEOUT_MS } from "./app-blocks";
import { frozenContextOf, hasNewBlocks, latestFrozenContextOf, MEMORY_KEY, SCREEN_PLACE_KEY } from "./context-blocks";
import type { ContextBlockEntry, FrozenContextData } from "./context-blocks";
import { freezeContext } from "./freeze-context";
import type { FrozenContextSources } from "./freeze-context";
import { frozenContextBase } from "./frozen-context-messages";
import { withoutUndelivered } from "../agent-run/undelivered";
import { isHumanMessage } from "../agent-run/channel-notes";
import { isStateMessage } from "../app-state/state-messages";

/**
 * Застывшие блоки ответа: уже есть в ответе (продолжение, копия «Повторить») — они, источники не спрашиваются; иначе
 * собираются один раз против базы хода. `fresh` — часть новая, её надо записать в ответ.
 */
export async function frozenContextForTurn(
  input: AgentTurnInput,
  turn: { history: readonly AgentChatMessage[]; answer?: AgentChatMessage; state: AppStateValues; viewer?: AgentViewer },
): Promise<{ data: FrozenContextData; fresh: boolean }> {
  const existing = turn.answer && frozenContextOf(turn.answer.parts);
  if (existing) return { data: existing, fresh: false };
  return { data: await freezeTurnContext(input, turn, frozenContextBase(withoutUndelivered(turn.history)), screenPlaceBlock(input.place)), fresh: true };
}

/**
 * Заметка продолжения: человек ответил на паузе ответа (виджет, подтверждение) — блоки собираются заново против того,
 * что модель видела в этом ответе последним. Страница без места (`samePlace`) место не меняет. Нового нет — `undefined`:
 * запрос как раньше. Заметка пишется частью ответа и встаёт в запросе сразу за ответом человека (`withFrozenContext`).
 */
export async function resumeNoteForTurn(
  input: AgentTurnInput,
  turn: { history: readonly AgentChatMessage[]; answer: AgentChatMessage; state: AppStateValues; viewer?: AgentViewer },
): Promise<FrozenContextData | undefined> {
  const seen = latestFrozenContextOf(turn.answer.parts);
  if (!seen) return undefined;
  const place = input.samePlace ? (seen.blocks.find((block) => block.key === SCREEN_PLACE_KEY)?.text ?? null) : screenPlaceBlock(input.place);
  const note = await freezeTurnContext(input, turn, { id: turn.answer.id, data: seen }, place);
  return hasNewBlocks(note) ? note : undefined;
}

/** Блоки хода против базы: дата, место, память и блоки приложения на сейчас. */
async function freezeTurnContext(
  input: AgentTurnInput,
  turn: { history: readonly AgentChatMessage[]; state: AppStateValues; viewer?: AgentViewer },
  base: { id: string; data: FrozenContextData } | null,
  place: string | null,
): Promise<FrozenContextData> {
  const sources: FrozenContextSources = {
    today: todayBlock((input.now ?? (() => new Date()))(), input.timeZone),
    place,
  };
  const { memory, ownerId } = input;
  if (memory && ownerId && !input.group) sources.memory = () => memoryBlocks(memory, { userId: ownerId, chatId: input.chatId });
  if (input.contextBlocks) {
    const question = turn.history.findLast((message) => message.role === "user" && !isStateMessage(message));
    const human = question && isHumanMessage(question) ? question : undefined;
    sources.app = appBlocksSource({
      contextBlocks: input.contextBlocks,
      timeoutMs: input.contextBlocksTimeoutMs ?? DEFAULT_CONTEXT_BLOCKS_TIMEOUT_MS,
      signal: input.abortSignal,
      // Кто, где и о чём — как у инструментов, но копиями: правка функции не доходит до хода.
      input: {
        chatId: input.chatId,
        ownerId: input.ownerId ?? "",
        messageId: input.messageId,
        userMessage: human ? { id: human.id, text: human.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") } : null,
        chat: structuredClone({ ...(input.chatData && { data: input.chatData }) }),
        state: structuredClone(turn.state),
        ...(input.subject && { subject: structuredClone(input.subject) }),
        channel: input.channel ?? "web",
        audience: input.group ? "group" : "private",
        ...(input.staff && { staff: structuredClone(input.staff) }),
        ...(turn.viewer && { viewer: turn.viewer }),
        modelId: input.modelId,
        providerId: input.providerId,
      },
    });
  }
  return freezeContext({
    chatId: input.chatId,
    sources,
    // Начало видимой истории: то же — память из базы; после сжатия другое — память заново. Агент говорит первым — сам ответ.
    memoryFrom: turn.history[0]?.id ?? input.messageId,
    base,
    signal: input.abortSignal,
    ...(input.logError && { logError: input.logError }),
  });
}

/** Блоки памяти: по записям, если память их даёт (`blocks`), иначе один блок из `snapshot`. */
async function memoryBlocks(memory: NonNullable<AgentTurnInput["memory"]>, owner: { userId: string; chatId: string }): Promise<ContextBlockEntry[] | null> {
  if (memory.blocks) return memory.blocks(owner);
  const text = await memory.snapshot(owner);
  return text ? [{ key: MEMORY_KEY, text, private: true }] : null;
}
