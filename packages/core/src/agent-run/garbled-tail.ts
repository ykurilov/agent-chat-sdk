import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { closesCodeFence, codeFenceOf, isIndentedCodeOrQuote } from "../text/markdown-code";
import { LENGTH_CUT_PART_TYPE } from "./length-cut";

type MessagePart = AgentChatMessage["parts"][number];

/**
 * Признаки срыва ответа в кашу — модель потеряла границу своего хода и пишет дальше за обоих. Правило общее для всех
 * моделей и смотрит каждый шаг ответа отдельно. Нужен опорный признак — он же место среза: `role` — строка с ролью сразу
 * после законченного ответа (с начала строки, после конца предложения, без двоеточия). Пара `</think>` в шаге перед такой
 * строкой переносит место среза на первый `</think>`. Второй признак зависит от строки с ролью:
 * - `userНу…` (роль слиплась с репликой): `think` — служебная метка в шаге (`</think>`, `<|im_end|>`, `<｜…｜>`);
 *   `restart` — после неё ещё одна строка с ролью или склейка русских предложений «месяц.Считать»; `tool` — вызов
 *   инструмента в том же шаге после неё;
 * - `user` одной строкой: `think` — служебная метка в шаге; `restart` — ещё одна строка с ролью после неё;
 * - метка шаблона (`<|im_start|>user`, `<｜User｜>`): `think` — метка конца своего хода перед ней (`<|im_end|>`);
 *   `restart` — ещё одна строка с ролью или склейка после неё.
 * Код (блоки ```, отступ в 4 пробела, `…`, ``…``) и цитаты (`> …`) не смотрятся. Роли за обоих (`user` и `assistant`
 * строками или метками шаблона) — запись диалога или шаблона по просьбе, а не срыв. Метка в начале шага (DeepSeek
 * ставит `</think>` перед текстом шага) — не след срыва.
 */
export type GarbleSign = "think" | "role" | "restart" | "tool";

const SIGN_ORDER: readonly GarbleSign[] = ["think", "role", "restart", "tool"];

/** Место срыва: часть с текстом, знак в ней, с которого начинается хвост, и найденные признаки. */
export interface GarbledTail {
  partIndex: number;
  offset: number;
  signs: GarbleSign[];
}

const TOKEN_SOURCE = String.raw`<\/?think>|<\|[^|\n<>]{1,40}\|>|<｜[^｜\n<>]{1,40}｜>`;
const TEMPLATE_TOKEN = new RegExp(TOKEN_SOURCE, "g");
/** Строка с ролью с самого начала строки: слиплась с русской репликой (`userНу`) или стоит одна. */
const ROLE_LINE = /(?<=^|\n)(user|assistant)(?=[ \t]*(?:\n|$)|[А-ЯЁа-яё])/g;
/** Метка шаблона с ролью с начала строки: `<|im_start|>user`, `<|user|>`, `<｜User｜>`. */
const TOKEN_ROLE_LINE =
  /(?<=^|\n)(?:(?:<\|im_start\|>|<\|start_header_id\|>)(?:user|assistant)\b|<\|(?:user|assistant)\|>|<｜(?:User|Assistant)｜>)/g;
/** Что может стать местом срыва: строка с ролью с начала строки или `</think>`. */
const ANCHOR_HINT =
  /(?:^|\n)(?:(?:user|assistant)(?:[ \t]*(?:\n|$)|[А-ЯЁа-яё])|(?:<\|im_start\|>|<\|start_header_id\|>)(?:user|assistant)|<\|(?:user|assistant)\|>|<｜(?:User|Assistant)｜>)/;
/** Метка шаблона с ролью где угодно в тексте: роли за обоих — шаблон по просьбе. */
const ROLE_TOKEN = /(?:<\|im_start\|>|<\|start_header_id\|>)(user|assistant)\b|<\|(user|assistant)\|>|<｜(User|Assistant)｜>/g;
/** Склейка русских предложений без пробела: `месяц.Считать`. */
const GLUED_SENTENCES = /[а-яё]{2}[.!?…][А-ЯЁ][а-яё]/;
/**
 * Новые строки, без которых решение правила не меняется: нет ни места срыва, ни признака. Код, цитаты и диалог могут
 * только снять признак, поэтому строки без этого правило не пересчитывают.
 */
const changesVerdict = (lines: string): boolean => ANCHOR_HINT.test(lines) || GLUED_SENTENCES.test(lines) || new RegExp(TOKEN_SOURCE).test(lines);
/** Конец законченного ответа перед строкой с ролью. */
const FINISHED = /[.!?…»)"]$/;
/** Хвост из пробелов и служебных меток — в конце текста не в счёт. */
const TRAILING_TOKENS = new RegExp(String.raw`(?:\s|${TOKEN_SOURCE})+$`);

interface StepText {
  partIndex: number;
  /** Видимый текст: код и цитаты — пробелами той же длины. */
  visible: string;
}

interface Step {
  /** Части шага: от `from` до `to`, не включая. */
  from: number;
  to: number;
  texts: StepText[];
}

interface Marker {
  partIndex: number;
  offset: number;
  kind: "role" | "token" | "close-think";
  /** Строка с ролью без метки шаблона: какая роль и слиплась ли с репликой. */
  bareRole?: { name: string; glued: boolean };
  /** Строка с ролью — метка шаблона. */
  roleToken?: boolean;
}

/** Ищет срыв в частях ответа. `null` — срыва нет. */
export function findGarbledTail(parts: readonly MessagePart[]): GarbledTail | null {
  // Без строки с ролью с начала строки места срыва нет: длинные обычные ответы не разбираются.
  if (!parts.some((part) => part.type === "text" && ANCHOR_HINT.test(part.text))) return null;
  const steps = stepsOf(parts);
  const markersByStep = steps.map((step) => step.texts.flatMap((text, at) => markersIn(text, step.texts.slice(0, at))));
  // Роли строками за обоих — запись диалога по просьбе: такие строки не признак. Так же метки шаблона за обоих.
  const bareRoles = new Set(markersByStep.flat().flatMap((marker) => (marker.bareRole ? [marker.bareRole.name] : [])));
  const tokenRoles = new Set(
    steps.flatMap((step) => step.texts.flatMap((text) => [...text.visible.matchAll(ROLE_TOKEN)].map((match) => (match[1] ?? match[2] ?? match[3]!).toLowerCase()))),
  );
  const dialog = bareRoles.size > 1;
  const template = tokenRoles.size > 1;
  for (const [index, step] of steps.entries()) {
    const markers = markersByStep[index]!.filter((marker) => !(dialog && marker.bareRole) && !(template && marker.roleToken));
    const found = garbleInStep(parts, step, markers);
    if (found) return found;
  }
  return null;
}

/** Ответ без хвоста срыва и что отрезано. */
export interface GarbledTailCut {
  parts: MessagePart[];
  signs: GarbleSign[];
  /** Сколько знаков текста и рассуждений отрезано. */
  removedChars: number;
  /** Последний оставшийся текст до места срыва: индекс один и тот же в исходных частях и в обрезанных; -1 — нет. */
  textIndex: number;
}

/**
 * Ответ без хвоста срыва: в шаге срыва — текст до места срыва, вызовы инструментов и служебные данные (`data-*`);
 * текст и рассуждения после места срыва в этом шаге отброшены. Следующие шаги — как были: вызовы и запросы
 * подтверждения не пропадают. Обрыв по длине в последнем шаге снят — ответ законченный. `null` — срыва нет или без
 * хвоста в ответе не осталось бы текста.
 */
export function cutGarbledTail(parts: readonly MessagePart[]): GarbledTailCut | null {
  const found = findGarbledTail(parts);
  if (!found) return null;
  const stepEnd = parts.findIndex((part, index) => index > found.partIndex && part.type === "step-start");
  const end = stepEnd === -1 ? parts.length : stepEnd;
  const cutPart = parts[found.partIndex] as Extract<MessagePart, { type: "text" }>;
  const answer = cutPart.text.slice(0, found.offset).replace(TRAILING_TOKENS, "");
  let removedChars = cutPart.text.length - answer.length;
  const kept: MessagePart[] = parts.slice(0, found.partIndex);
  if (answer) kept.push({ ...cutPart, text: answer, state: "done" });
  for (const part of parts.slice(found.partIndex + 1, end)) {
    // В счёт — только видимый текст: рассуждения человек не видел.
    if (part.type === "text") removedChars += part.text.length;
    else if (part.type === "reasoning") continue;
    else if (!(stepEnd === -1 && part.type === LENGTH_CUT_PART_TYPE)) kept.push(part);
  }
  kept.push(...parts.slice(end));
  if (!kept.some((part) => part.type === "text" && /[\p{L}\p{N}]/u.test(part.text.replace(TEMPLATE_TOKEN, "")))) return null;
  const textIndex = answer ? found.partIndex : parts.slice(0, found.partIndex).findLastIndex((part) => part.type === "text");
  return { parts: kept, signs: found.signs, removedChars, textIndex };
}

/**
 * История для модели без хвостов срыва в ответах ассистента. Только в запросе: запись не меняется. Из той же истории —
 * те же байты (кэш модели). Нечего резать — тот же массив, сообщения без срыва — те же объекты.
 */
export function withoutGarbledTails(history: readonly AgentChatMessage[]): readonly AgentChatMessage[] {
  let changed = false;
  const cleaned = history.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = rememberedCut(message);
    if (!parts) return message;
    changed = true;
    return { ...message, parts };
  });
  return changed ? cleaned : history;
}

/** Обрезка ответов из истории, запомненная по id: каждый запрос несёт ту же историю — разбор не повторяется. */
const rememberedCuts = new Map<string, { source: string; parts: MessagePart[] | null }>();
const REMEMBERED_CUTS_LIMIT = 500;

/**
 * Части ответа без хвоста или `null`. Ответы без строки с ролью отсеиваются сразу; остальные запоминаются по id и
 * содержимому: изменённое сообщение с тем же id разбирается заново.
 */
function rememberedCut(message: AgentChatMessage): MessagePart[] | null {
  if (!message.parts.some((part) => part.type === "text" && ANCHOR_HINT.test(part.text))) return null;
  const source = JSON.stringify(message.parts);
  const known = rememberedCuts.get(message.id);
  if (known?.source === source) return known.parts;
  const parts = cutGarbledTail(message.parts)?.parts ?? null;
  rememberedCuts.delete(message.id);
  rememberedCuts.set(message.id, { source, parts });
  if (rememberedCuts.size > REMEMBERED_CUTS_LIMIT) rememberedCuts.delete(rememberedCuts.keys().next().value!);
  return parts;
}

/** Вызов, отброшенный в потоке до запуска: для правила он — вызов в конце последнего шага. */
const DROPPED_CALL = { type: "tool-dropped", toolCallId: "", state: "input-available", input: {} } as unknown as MessagePart;

/**
 * Срыв, пока идёт поток ответа модели (каждый шаг попытки). Решение — по тому же правилу, что при сохранении, и только
 * на целых строках: незаконченная строка ждёт конца строки или конца текста. Сработало — текст и рассуждения дальше не
 * идут (ни на экран, ни в запись), вызовы инструментов после этого отброшены до запуска, шаг кончается без вызовов —
 * нового шага нет. Отброшенный вызов при сохранении учитывается через `forCut`: запись и поток решают одинаково.
 */
export function createGarbledTailGuard() {
  let parts: MessagePart[] = [];
  let garbled = false;
  let droppedCalls = 0;
  // Места срыва в попытке пока не было — правило не считается: длинный ответ не пересчитывается на каждой строке.
  let hinted = false;
  /** Новые целые строки: если в них есть что-то для правила — пересчитать. */
  const worthChecking = (lines: string): boolean => {
    hinted ||= ANCHOR_HINT.test(lines);
    return hinted && changesVerdict(lines);
  };
  const textAt = new Map<string, number>();
  const open = new Set<number>();
  const droppedIds = new Set<string>();

  /** Правило на том, что известно: у открытого текста — только целые строки. */
  const garbledNow = (withCall: boolean): boolean => {
    if (!hinted) return false;
    const known = parts.map((part, index) =>
      part.type === "text" && open.has(index) ? { ...part, text: part.text.slice(0, part.text.lastIndexOf("\n") + 1) } : part,
    );
    return cutGarbledTail(withCall ? [...known, DROPPED_CALL] : known) !== null;
  };

  const transform = (part: LanguageModelV4StreamPart, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>): void => {
    switch (part.type) {
      case "text-start": {
        const index = parts.push({ type: "text", text: "" }) - 1;
        textAt.set(part.id, index);
        open.add(index);
        break;
      }
      case "text-delta": {
        if (garbled) return;
        const index = textAt.get(part.id);
        if (index === undefined) break;
        const text = parts[index] as { text: string };
        const before = text.text.length;
        const lineStart = text.text.lastIndexOf("\n") + 1;
        text.text += part.delta;
        if (!part.delta.includes("\n")) break;
        if (worthChecking(text.text.slice(lineStart, text.text.lastIndexOf("\n") + 1)) && garbledNow(false)) {
          garbled = true;
          // Дальше последней целой строки ничего не уходит: запись — ровно то, на чём решено.
          const keep = text.text.lastIndexOf("\n") + 1 - before;
          text.text = text.text.slice(0, before + Math.max(keep, 0));
          if (keep > 0) controller.enqueue({ ...part, delta: part.delta.slice(0, keep) });
          return;
        }
        break;
      }
      case "text-end": {
        const index = textAt.get(part.id);
        if (index === undefined || garbled) break;
        open.delete(index);
        const { text } = parts[index] as { text: string };
        if (worthChecking(text.slice(text.lastIndexOf("\n") + 1)) && garbledNow(false)) garbled = true;
        break;
      }
      case "reasoning-delta":
        if (garbled) return;
        break;
      case "tool-input-start":
      case "tool-call": {
        const callId = part.type === "tool-call" ? part.toolCallId : part.id;
        if (droppedIds.has(callId)) return;
        const started = part.type === "tool-call" && parts.some((known) => (known as { toolCallId?: string }).toolCallId === callId);
        if (started) break;
        if (garbled || garbledNow(true)) {
          garbled = true;
          droppedIds.add(callId);
          droppedCalls += 1;
          return;
        }
        parts.push({ type: "tool-call", toolCallId: callId, state: "input-streaming" } as unknown as MessagePart);
        break;
      }
      case "tool-input-delta":
      case "tool-input-end":
        if (droppedIds.has(part.id)) return;
        break;
      case "finish":
        // Вызовы шага отброшены — шаг кончился словами: нового шага нет.
        if (droppedCalls > 0 && part.finishReason.unified === "tool-calls") {
          controller.enqueue({ ...part, finishReason: { ...part.finishReason, unified: "stop" } });
          return;
        }
        break;
    }
    controller.enqueue(part);
  };

  return {
    /** Новая попытка: шаги прежней стёрты — всё сначала. */
    reset(): void {
      parts = [];
      garbled = false;
      droppedCalls = 0;
      hinted = false;
      textAt.clear();
      open.clear();
      droppedIds.clear();
    },
    /** Модель попытки под присмотром: каждый запрос — новый шаг. */
    wrap(model: LanguageModel): LanguageModel {
      if (typeof model === "string") return model;
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v4",
          wrapStream: async ({ doStream }) => {
            const result = await doStream();
            parts.push({ type: "step-start" });
            return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform })) };
          },
        },
      });
    },
    /** Срыв уже замечен в этой попытке: нового шага не нужно. */
    garbled: (): boolean => garbled,
    /** Сколько вызовов отброшено до запуска. */
    droppedCalls: (): number => droppedCalls,
    /** Части ответа для правила при сохранении: отброшенный вызов — на своём месте, в конце. */
    forCut: (saved: readonly MessagePart[]): readonly MessagePart[] => (droppedCalls > 0 ? [...saved, DROPPED_CALL] : saved),
    /** Заглушка отброшенного вызова из `forCut`: в запись не идёт. */
    isDroppedCall: (part: MessagePart): boolean => part === DROPPED_CALL,
  };
}

const isToolPart = (part: MessagePart): boolean => part.type.startsWith("tool-") || part.type === "dynamic-tool";

function stepsOf(parts: readonly MessagePart[]): Step[] {
  const steps: Step[] = [];
  let current: Step = { from: 0, to: 0, texts: [] };
  parts.forEach((part, partIndex) => {
    if (part.type === "step-start") {
      current.to = partIndex;
      steps.push(current);
      current = { from: partIndex, to: partIndex, texts: [] };
    } else if (part.type === "text") current.texts.push({ partIndex, visible: withoutCodeAndQuotes(part.text) });
  });
  current.to = parts.length;
  steps.push(current);
  return steps.filter((step) => step.texts.length > 0);
}

function garbleInStep(parts: readonly MessagePart[], step: Step, markers: readonly Marker[]): GarbledTail | null {
  const roles = markers.filter((marker) => marker.kind === "role");
  const role = roles.find((marker) => finishedBefore(step.texts, marker));
  if (!role) return null;
  const after = (marker: Marker) => byPlace(marker, role) > 0;
  const tokens = markers.filter((marker) => marker.kind !== "role");
  const gluedAfter = () => textAfter(step.texts, role).some((text) => GLUED_SENTENCES.test(text));
  const others = new Set<GarbleSign>();
  if (role.roleToken) {
    // Метка шаблона: свой ход закрыт меткой перед ней; метки внутри реплики — часть шаблона.
    if (tokens.some((marker) => !after(marker))) others.add("think");
    if (roles.some(after) || gluedAfter()) others.add("restart");
  } else {
    if (tokens.length > 0) others.add("think");
    if (roles.some(after)) others.add("restart");
    // Одинокая строка `user` — часто подпись примера: склейка и вызов после неё не признак.
    if (role.bareRole!.glued) {
      if (gluedAfter()) others.add("restart");
      if (parts.slice(role.partIndex + 1, step.to).some(isToolPart)) others.add("tool");
    }
  }
  if (others.size === 0) return null;
  // Пара `</think>` перед строкой с ролью: срыв начался с первого `</think>`.
  const closeThinks = markers.filter((marker) => marker.kind === "close-think" && !after(marker));
  const anchor = closeThinks.length >= 2 ? closeThinks[0]! : role;
  const signs = new Set<GarbleSign>(["role", ...others]);
  return { partIndex: anchor.partIndex, offset: anchor.offset, signs: SIGN_ORDER.filter((sign) => signs.has(sign)) };
}

const byPlace = (a: Marker, b: Marker): number => a.partIndex - b.partIndex || a.offset - b.offset;

/** Видимый текст шага после опоры. */
function textAfter(texts: readonly StepText[], anchor: Marker): string[] {
  return texts.flatMap((text) =>
    text.partIndex < anchor.partIndex ? [] : [text.partIndex === anchor.partIndex ? text.visible.slice(anchor.offset) : text.visible],
  );
}

function markersIn(text: StepText, earlier: readonly StepText[]): Marker[] {
  const { partIndex, visible } = text;
  const markers: Marker[] = [];
  // Метка или роль в начале шага — не след срыва: DeepSeek ставит `</think>` перед текстом шага.
  const hasTextBefore = (offset: number) => visibleBefore(earlier, visible, offset) !== "";
  const roleTokens = new Set<number>();
  for (const match of visible.matchAll(TOKEN_ROLE_LINE)) {
    roleTokens.add(match.index);
    if (hasTextBefore(match.index)) markers.push({ partIndex, offset: match.index, kind: "role", roleToken: true });
  }
  // Метка с ролью — одна отметка, а не две: служебной меткой отдельно она не считается.
  for (const match of visible.matchAll(TEMPLATE_TOKEN)) {
    if (roleTokens.has(match.index) || !hasTextBefore(match.index)) continue;
    markers.push({ partIndex, offset: match.index, kind: match[0] === "</think>" ? "close-think" : "token" });
  }
  for (const match of visible.matchAll(ROLE_LINE)) {
    if (!hasTextBefore(match.index)) continue;
    const name = match[1]!;
    const glued = /[А-ЯЁа-яё]/.test(visible[match.index + name.length] ?? "");
    markers.push({ partIndex, offset: match.index, kind: "role", bareRole: { name, glued } });
  }
  return markers.sort(byPlace);
}

/** Перед строкой с ролью — законченный ответ: видимый текст шага до неё кончается точкой, вопросом и т. п. */
function finishedBefore(texts: readonly StepText[], marker: Marker): boolean {
  const at = texts.findIndex((text) => text.partIndex === marker.partIndex);
  return FINISHED.test(visibleBefore(texts.slice(0, at), texts[at]!.visible, marker.offset));
}

/** Видимый текст шага до места — без пробелов и служебных меток в конце. */
function visibleBefore(earlier: readonly StepText[], visible: string, offset: number): string {
  const own = visible.slice(0, offset).replace(TRAILING_TOKENS, "");
  if (own) return own;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const text = earlier[index]!.visible.replace(TRAILING_TOKENS, "");
    if (text) return text;
  }
  return "";
}

/** Код и цитаты заменены пробелами той же длины: места в тексте не сдвигаются. */
function withoutCodeAndQuotes(text: string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      if (fence !== null) {
        if (closesCodeFence(line, fence)) fence = null;
        return " ".repeat(line.length);
      }
      const opener = codeFenceOf(line);
      if (opener) {
        fence = opener;
        return " ".repeat(line.length);
      }
      if (isIndentedCodeOrQuote(line)) return " ".repeat(line.length);
      return line.replace(/(`+)[^`\n]*?\1/g, (code) => " ".repeat(code.length));
    })
    .join("\n");
}
