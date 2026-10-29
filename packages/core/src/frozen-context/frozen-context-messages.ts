import { hasAnswerContent } from "../agent-run/auto-continue";
import { GREETING_LEAD } from "../agent-run/greeting-lead";
import type { AgentChatMessage } from "../conversation/types";
import { noticeText } from "../notices/notices-for-model";
import { FROZEN_CONTEXT_PART_TYPE, frozenContextOf, isMemoryKey, isReservedKey, latestFrozenContextOf, noLongerValid, notShownForSpace } from "./context-blocks";
import type { FrozenContextData } from "./context-blocks";
import { isSummaryPart } from "../compaction/summary-part";

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
  options: FrozenContextProjection,
): AgentChatMessage[] {
  const { current, group } = options;
  const dataOf = (message: AgentChatMessage): FrozenContextData | undefined =>
    message.role !== "assistant" ? undefined : current && message.id === current.answerId ? current.data : frozenContextOf(message.parts);
  // Только сжатая история. Включение history-start посреди обычного чата не переносит будущие данные назад.
  const root = history[0];
  const anchorHistory = options.anchorHistory && options.anchorHistory[0]?.id === root?.id ? options.anchorHistory : history;
  const allowed = options.includeKey ?? (() => true);
  const anchor = root?.parts.some(isSummaryPart)
    ? anchorHistory.flatMap(message => message.role === "assistant"
      ? [dataOf(message), ...message.parts.filter(p => p.type === FROZEN_CONTEXT_PART_TYPE).slice(1).map(p => (p as { data: FrozenContextData }).data)]
      : []).concat(current?.data).find(data => data?.appContextFrom === root.id)
    : undefined;
  const latestKeys = new Set((options.latestKeys ?? []).filter(key => !isReservedKey(key)));
  const lastUpdates = new Map<string, FrozenContextData>();
  if (anchor) for (const block of anchor.blocks) if (latestKeys.has(block.key)) lastUpdates.set(block.key, anchor);
  if (latestKeys.size) {
    const bases = new Map<string, FrozenContextData>();
    const noteUpdate = (data: FrozenContextData, base: FrozenContextData | undefined) => {
      const keys = data.sent === "all" || !base ? [...latestKeys]
        : [...data.sent.changed, ...data.sent.removed, ...(data.sent.hidden ?? [])];
      for (const key of keys) if (latestKeys.has(key)) lastUpdates.set(key, data);
    };
    let currentSeen = false;
    for (const message of history) {
      const data = dataOf(message);
      if (data) { noteUpdate(data, data.base === null ? undefined : bases.get(data.base)); bases.set(message.id, data); if (message.id === current?.answerId) currentSeen = true; }
      for (const part of (message.role === "assistant" ? message.parts.filter(part => part.type === FROZEN_CONTEXT_PART_TYPE).slice(1) : [])) {
        const note = (part as { data: FrozenContextData }).data;
        noteUpdate(note, bases.get(message.id)); bases.set(message.id, note);
      }
    }
    if (current && !currentSeen) noteUpdate(current.data, current.data.base === null ? undefined : bases.get(current.data.base));
  }
  const keptUpdate = (key: string, data: FrozenContextData) => !latestKeys.has(key) || lastUpdates.get(key) === data;
  let anchored = false;
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
  const textsOf = (data: FrozenContextData, base: FrozenContextData | undefined) => {
    // У summary уже полный app snapshot. До его исходного места старые app блоки не показываем;
    // дату, память, место и notices по-прежнему выводим на своих местах. После него — прежние delta.
    const include = (key: string) => allowed(key) && keptUpdate(key, data) && (!anchor || anchored || isReservedKey(key));
    const texts = blockTexts(data, base, group, anchor || options.includeKey || latestKeys.size ? include : undefined);
    if (data === anchor) anchored = true;
    return texts;
  };
  let currentPlaced = false;
  for (const message of history) {
    const data = dataOf(message);
    if (data) {
      place(textsOf(data, data.base === null ? undefined : seen.get(data.base)));
      seen.set(message.id, data);
      if (message.id === current?.answerId) currentPlaced = true;
    }
    // База заметки — прошлые блоки её же ответа, а не номер в ней: у копии «Повторить» номер ответа другой.
    const placed = anchor && message === root ? { ...message, parts: message.parts.flatMap(part => isSummaryPart(part)
      ? [part, ...anchor.blocks.filter(block => !isReservedKey(block.key) && allowed(block.key) && keptUpdate(block.key, anchor) && !(group && block.private)).map(block => ({ type: "text" as const, text: block.text }))]
      : [part]) } : message;
    output.push(...withResumeNotes(placed, (note) => {
      const texts = textsOf(note, seen.get(message.id));
      seen.set(message.id, note);
      return texts;
    }));
  }
  if (current && !currentPlaced) place(textsOf(current.data, current.data.base === null ? undefined : seen.get(current.data.base)));
  return output;
}

/** Внутренняя проекция общего сборщика; не настройка агента и не данные модели. */
export interface FrozenContextProjection {
  current?: { answerId: string; data: FrozenContextData };
  group: boolean;
  /** При сжатии префикса anchor ищется в полной эффективной ветке; её текст сюда не переносится. */
  anchorHistory?: readonly AgentChatMessage[];
  /** Допустимые ключи блоков в проекции; нет — прежний набор. Текст переписки не фильтруется. */
  includeKey?: (key: string) => boolean;
  /** Только последнее выданное обновление выбранных app-ключей; raw snapshots и прочие блоки сохраняются. */
  latestKeys?: readonly string[];
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
function blockTexts(data: FrozenContextData, base: FrozenContextData | undefined, group: boolean, include?: (key: string) => boolean): string[] {
  return [...changedBlockTexts(data, base, group, include), ...(data.notices ?? []).map(noticeText)];
}

function changedBlockTexts(data: FrozenContextData, base: FrozenContextData | undefined, group: boolean, include?: (key: string) => boolean): string[] {
  const shown = (block: { key: string; private?: boolean }) => (!include || include(block.key)) && !(group && block.private);
  if (data.sent === "all" || !base) return data.blocks.filter(shown).map((block) => block.text);
  const now = new Map(data.blocks.map((block) => [block.key, block]));
  const before = new Map(base.blocks.map((block) => [block.key, block]));
  const texts = data.sent.changed.flatMap((key) => {
    const block = now.get(key);
    return block && shown(block) ? [block.text] : [];
  });
  const visibleKeys = (keys: readonly string[]) => keys.filter((key) => (!include || include(key)) && !(group && (before.get(key)?.private ?? isMemoryKey(key))));
  const removed = visibleKeys(data.sent.removed);
  if (removed.length > 0) texts.push(noLongerValid(removed));
  const hidden = visibleKeys(data.sent.hidden ?? []);
  if (hidden.length > 0) texts.push(notShownForSpace(hidden));
  return texts;
}
