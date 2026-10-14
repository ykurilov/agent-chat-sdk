import { hasAnswerContent } from "../agent-run/auto-continue";
import { GREETING_LEAD } from "../agent-run/greeting-lead";
import type { AgentChatMessage } from "../conversation/types";
import { noticeText } from "../notices/notices-for-model";
import { FROZEN_CONTEXT_PART_TYPE, frozenContextOf, isMemoryKey, latestFrozenContextOf, noLongerValid, notShownForSpace } from "./context-blocks";
import type { FrozenContextData } from "./context-blocks";

/**
 * База хода: последний ответ со словами и с частью застывших блоков в видимой истории — с тем, что модель видела в нём
 * последним (заметка продолжения, иначе блоки ответа). Ответ без слов выпадает из запроса вместе со своими блоками,
 * поэтому базой не считается.
 */
export function frozenContextBase(history: readonly AgentChatMessage[]): { id: string; data: FrozenContextData } | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== "assistant" || !hasAnswerContent(message.parts)) continue;
    const data = latestFrozenContextOf(message.parts);
    if (data) return { id: message.id, data };
  }
  return null;
}

/** Начало id сообщения человека с заметкой продолжения: по нему её узнаёт `holdNoteAfterApprovals`. */
const RESUME_NOTE_ID = "frozen-context-note-";

/**
 * Застывшие блоки текстовыми частями в конец сообщения человека прямо перед своим ответом; нет его — отдельное сообщение
 * человека. Заметка продолжения (ответ человека на паузе ответа: виджет, подтверждение) режет свой ответ: части до неё,
 * сообщение человека с её текстами, части после — заметка встаёт сразу за ответом человека, а не в его давнем вопросе.
 * Чистая функция видимой истории: та же история — те же байты на каждом шаге и на следующем ходе.
 * `current` — блоки ответа, которого в истории ещё нет (первый запрос хода): в конец последнего сообщения человека.
 * В групповом ходе личные блоки не показываются ни из этого хода, ни из прошлых.
 */
export function withFrozenContext(
  history: readonly AgentChatMessage[],
  options: { current?: { answerId: string; data: FrozenContextData }; group: boolean },
): AgentChatMessage[] {
  const { current, group } = options;
  const dataOf = (message: AgentChatMessage): FrozenContextData | undefined =>
    message.role !== "assistant" ? undefined : current && message.id === current.answerId ? current.data : frozenContextOf(message.parts);
  // Что модель видела последним у каждого ответа: его блоки, затем заметки продолжения по порядку. База — всегда раньше.
  const seen = new Map<string, FrozenContextData>();
  const output: AgentChatMessage[] = [];
  const place = (texts: string[]) => {
    if (texts.length === 0) return;
    const parts = texts.map((text) => ({ type: "text" as const, text }));
    const last = output.at(-1);
    if (last?.role === "user") output[output.length - 1] = { ...last, parts: [...last.parts, ...parts] };
    else output.push({ id: `frozen-context-${output.length}`, role: "user", parts: output.length === 0 ? [{ type: "text", text: GREETING_LEAD }, ...parts] : parts });
  };
  const textsOf = (data: FrozenContextData) => blockTexts(data, data.base === null ? undefined : seen.get(data.base), group);
  let currentPlaced = false;
  for (const message of history) {
    const data = dataOf(message);
    if (data) {
      place(textsOf(data));
      seen.set(message.id, data);
      if (message.id === current?.answerId) currentPlaced = true;
    }
    // База заметки — прошлые блоки её же ответа, а не номер в ней: у копии «Повторить» номер ответа другой.
    output.push(...withResumeNotes(message, (note) => {
      const texts = blockTexts(note, seen.get(message.id), group);
      seen.set(message.id, note);
      return texts;
    }));
  }
  if (current && !currentPlaced) place(textsOf(current.data));
  return output;
}

/** Ответ, разрезанный заметками продолжения (все части застывших блоков после первой). Заметка без текстов не режет. */
function withResumeNotes(message: AgentChatMessage, textsOf: (note: FrozenContextData) => string[]): AgentChatMessage[] {
  if (message.role !== "assistant") return [message];
  const first = message.parts.findIndex((part) => part.type === FROZEN_CONTEXT_PART_TYPE);
  if (first === -1 || !message.parts.some((part, index) => index > first && part.type === FROZEN_CONTEXT_PART_TYPE)) return [message];
  const pieces: AgentChatMessage[] = [];
  let segment: AgentChatMessage["parts"] = [];
  message.parts.forEach((part, index) => {
    if (part.type !== FROZEN_CONTEXT_PART_TYPE || index === first) {
      segment.push(part);
      return;
    }
    const texts = textsOf((part as { data: FrozenContextData }).data);
    if (texts.length === 0) return;
    if (segment.length > 0) pieces.push({ ...message, parts: segment });
    pieces.push({ id: `${RESUME_NOTE_ID}${message.id}-${index}`, role: "user", parts: texts.map((text) => ({ type: "text" as const, text })) });
    segment = [];
  });
  if (segment.length > 0) pieces.push({ ...message, parts: segment });
  return pieces;
}

/**
 * Заметка продолжения последней, а перед ней — решения подтверждения, по которым инструмент ещё не выполнен: AI SDK
 * выполняет одобренные вызовы, только если запрос кончается ответом инструмента. Тогда заметка отдаётся отдельно —
 * её ставят в конец первого шага, сразу за результатами этих вызовов (тот же порядок, что в истории после хода).
 */
export function holdNoteAfterApprovals(messages: AgentChatMessage[]): { messages: AgentChatMessage[]; note?: AgentChatMessage } {
  const note = messages.at(-1);
  const answer = messages.at(-2);
  if (!note?.id.startsWith(RESUME_NOTE_ID) || answer?.role !== "assistant" || !answer.parts.some(awaitsApprovedRun)) return { messages };
  return { messages: messages.slice(0, -1), note };
}

const awaitsApprovedRun = (part: AgentChatMessage["parts"][number]): boolean => (part as { state?: string }).state === "approval-responded";

/** Тексты блоков, которые ушли модели с этим ответом, и служебные сообщения хода. База не видна — весь набор. */
function blockTexts(data: FrozenContextData, base: FrozenContextData | undefined, group: boolean): string[] {
  return [...changedBlockTexts(data, base, group), ...(data.notices ?? []).map(noticeText)];
}

function changedBlockTexts(data: FrozenContextData, base: FrozenContextData | undefined, group: boolean): string[] {
  const shown = (block: { private?: boolean }) => !(group && block.private);
  if (data.sent === "all" || !base) return data.blocks.filter(shown).map((block) => block.text);
  const now = new Map(data.blocks.map((block) => [block.key, block]));
  const before = new Map(base.blocks.map((block) => [block.key, block]));
  const texts = data.sent.changed.flatMap((key) => {
    const block = now.get(key);
    return block && shown(block) ? [block.text] : [];
  });
  const visibleKeys = (keys: readonly string[]) => keys.filter((key) => !(group && (before.get(key)?.private ?? isMemoryKey(key))));
  const removed = visibleKeys(data.sent.removed);
  if (removed.length > 0) texts.push(noLongerValid(removed));
  const hidden = visibleKeys(data.sent.hidden ?? []);
  if (hidden.length > 0) texts.push(notShownForSpace(hidden));
  return texts;
}
