import type { AgentFlow, FlowField } from "../format/flow-format";
import type { FlowRun } from "../engine/flow-run";
import { fieldValueFits } from "../engine/data-conditions";
import { fieldById } from "../engine/flow-graph";
import { isFieldStale, sideQuestion } from "../engine/side-questions";
import type { ClientCardEntry, ClientFact } from "../store/flow-store";

/** Значение поля готовой строкой: для блока модели, ответа `client_card` и экрана. */
export function fieldValueText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "да" : "нет";
  return JSON.stringify(value);
}

function questionLine(flow: AgentFlow, run: FlowRun, card: Record<string, { value: unknown; updatedAt: number }>, now: number): string {
  const question = sideQuestion(flow, run, { card, now });
  const found = question && fieldById(flow, question.fieldId);
  if (!question || !found) return "Сейчас не спрашивай ничего о человеке между делом: ответь на то, что он пишет.";
  const { field } = found;
  const noted = `flow_note { asked: "${field.id}" }`;
  if (question.reason === "learn") return `Сначала узнай: «${field.name}» — ${field.about} Запиши ответ через flow_note.`;
  if (question.reason === "stale") {
    return `Давно не уточняли: «${field.name}» (сейчас записано: ${fieldValueText(card[field.id]!.value)}). Мягко сверь одним коротким вопросом к месту. Спросил — отметь ${noted}; если изменилось — запиши новое значение через flow_note.`;
  }
  return `Можно спросить между делом: «${field.name}» — ${field.about} Один короткий вопрос к месту, не в лоб. Спросил — отметь ${noted}.`;
}

/**
 * Блок `flow:client`: что известно о человеке, что устарело, о чём можно спросить между делом. Известное и заметки идут
 * по порядку полей сценария (порядок = что важнее). Значение не по типу поля считается неизвестным.
 */
export function clientCardBlock(input: { flow: AgentFlow; run: FlowRun; card: ClientCardEntry[]; facts?: ClientFact[]; now: number }): string {
  const { flow, run, now } = input;
  const facts = input.facts ?? [];
  if (flow.clientCard.length === 0 && flow.chatNotes.length === 0 && facts.length === 0) return "";

  const byId = new Map(input.card.map((entry) => [entry.fieldId, { value: entry.value, updatedAt: Date.parse(entry.updatedAt) }]));
  const known = (field: FlowField, value: unknown) => fieldValueFits(field, value);

  const cardLines = flow.clientCard.flatMap((field) => {
    const entry = byId.get(field.id);
    if (!entry || !known(field, entry.value)) return [];
    const stale = isFieldStale(field, entry.updatedAt, now) ? " (записано давно, могло измениться)" : "";
    return [`- ${field.name}: ${fieldValueText(entry.value)}${stale}`];
  });
  const noteLines = flow.chatNotes.flatMap((field) => (known(field, run.notes[field.id]) ? [`- ${field.name}: ${fieldValueText(run.notes[field.id])}`] : []));

  const lines = ["Что известно о человеке (карточка клиента):", ...(cardLines.length > 0 ? cardLines : facts.length > 0 ? [] : ["- пока ничего не записано"])];
  if (facts.length > 0) lines.push("", "Факты о человеке:", ...facts.map((fact) => `- ${fact.text}`));
  if (noteLines.length > 0) lines.push("", "Заметки этого чата:", ...noteLines);
  lines.push("", questionLine(flow, run, Object.fromEntries(byId), now));
  return lines.join("\n");
}
