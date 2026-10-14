import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { fieldValueFits, parseBooleanAnswer } from "../engine/data-conditions";
import { FLOW_STATE_KEY, type FlowRun } from "../engine/flow-run";
import { fieldById, sameText, type FieldPlace } from "../engine/flow-graph";
import { noteSideQuestion } from "../engine/run-updates";
import { isFieldStale } from "../engine/side-questions";
import type { AgentFlow, FlowField } from "../format/flow-format";
import { fieldValueText } from "../prompt/client-card-block";
import type { FlowStore } from "../store/flow-store";
import { currentRun } from "./flow-events";
import { MAX_FACTS, MAX_FACT_LENGTH, factId, isFactEntry, sameFact } from "./client-facts";
import type { CardToolsTurn, ClientFactStore } from "./flow-types";

export const FLOW_NOTE_TOOL = "flow_note";
export const CLIENT_CARD_TOOL = "client_card";

const NO_FLOW = "В этом чате нет сценария: записывать некуда, продолжай разговор.";
const STAFF_READ_ONLY = "ход ведёт сотрудник: карточку клиента он только читает";

type Pinned = NonNullable<Awaited<ReturnType<CardToolsTurn["flow"]>>>;

/** Поле сценария по `id` или по имени, как его назвал человек или модель. */
function findField(flow: AgentFlow, ref: string): FieldPlace | undefined {
  const byId = fieldById(flow, ref);
  if (byId) return byId;
  const card = flow.clientCard.find((field) => sameText(field.name, ref));
  if (card) return { field: card, place: "card" };
  const note = flow.chatNotes.find((field) => sameText(field.name, ref));
  return note ? { field: note, place: "notes" } : undefined;
}

const fieldList = (flow: AgentFlow) =>
  [...flow.clientCard, ...flow.chatNotes].map((field) => `${field.id} («${field.name}»)`).join(", ");

const unknownField = (flow: AgentFlow, ref: string) => `Не записано: в сценарии нет поля «${ref}». Поля: ${fieldList(flow)}.`;

/** Значение, приведённое к виду поля, или причина отказа словами для модели. */
function fitValue(field: FlowField, raw: unknown): { ok: true; value: string | number | boolean } | { ok: false; why: string } {
  if (field.type === "boolean") {
    const answer = parseBooleanAnswer(raw);
    return answer === undefined ? { ok: false, why: `«${field.name}» — «да» или «нет», а пришло «${String(raw)}»` } : { ok: true, value: answer };
  }
  if (field.type === "number") {
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.replace(",", ".")) : raw;
    return fieldValueFits(field, value) ? { ok: true, value: value as number } : { ok: false, why: `«${field.name}» — число, а пришло «${String(raw)}»` };
  }
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, why: `«${field.name}» — непустой текст, а пришло «${String(raw)}»` };
  if (field.type === "choice" && field.options.length > 0) {
    const option = field.options.find((item) => sameText(item, raw));
    return option ? { ok: true, value: option } : { ok: false, why: `«${field.name}» принимает только: ${field.options.join(", ")}` };
  }
  return { ok: true, value: raw.trim() };
}

const dateText = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
};

/**
 * `flow_note` (записать узнанное: поле карточки или заметку чата; отметить вопрос между делом) и `client_card` (показать
 * или стереть то, что агент знает о человеке). Собираются на ход чата: им нужны человек, состояние чата и сценарий.
 */
export function noteTools(input: { store: FlowStore; now: () => Date; turn: CardToolsTurn; facts?: ClientFactStore }): ToolSet {
  const { store, now, turn, facts } = input;
  const { ownerId, chatId, state, staff } = turn.model;

  /** Записать ход сценария в состояние чата: чтение и запись подряд, без пауз между ними. */
  const updateRun = (pinned: Pinned, change: (run: FlowRun) => FlowRun) => {
    if (!state) return;
    state.set(FLOW_STATE_KEY, change(currentRun(pinned.flow, { [FLOW_STATE_KEY]: state.get(FLOW_STATE_KEY) }, now().getTime())));
  };
  const runNow = (pinned: Pinned) => currentRun(pinned.flow, { [FLOW_STATE_KEY]: state?.get(FLOW_STATE_KEY) }, now().getTime());

  const noteShape = {
    field: z.string().optional().describe("id поля (или его имя)"),
    value: z.union([z.string(), z.number(), z.boolean()]).optional().describe("Значение: текст, число, «да»/«нет» или один из вариантов поля"),
    asked: z.string().optional().describe("id поля, о котором только что спросил между делом"),
  };
  // Факты включаются настройкой приложения: без неё схема и описание те же, что были, и запрос у старых приложений не меняется.
  const factShape = { fact: z.string().optional().describe("Свободный факт о человеке одной короткой фразой, если для него нет поля") };

  const flowNote = tool({
    description:
      "Записать то, что узнал о человеке: поле из карточки состояния («Узнать здесь») или из блока flow:client. { field, value } — запись; { asked } — отметить, что спросил человека о поле между делом. Значение не по типу поля не записывается." +
      (facts ? " { fact } — свободный факт о человеке, для которого нет поля («ведёт блог»)." : ""),
    inputSchema: z.object(facts ? { ...noteShape, ...factShape } : noteShape) as z.ZodObject<typeof noteShape & typeof factShape>,
    execute: async ({ field, value, asked, fact }) => {
      const pinned = await turn.flow();
      if (!pinned || !state) return NO_FLOW;
      const { flow } = pinned;

      if (fact !== undefined) {
        if (!facts) return "Не записано: факты о человеке в этом приложении не ведутся. Продолжай разговор.";
        if (field !== undefined || value !== undefined || asked !== undefined) return "Не записано: укажи что-то одно — поле с значением (field, value) или свободный факт (fact).";
        return writeFact(facts, pinned, fact);
      }

      if (asked !== undefined) {
        const found = findField(flow, asked);
        if (!found) return unknownField(flow, asked);
        updateRun(pinned, noteSideQuestion);
        return `Отмечено: про «${found.field.name}» спросил.`;
      }
      if (field === undefined || value === undefined) return "Не записано: укажи поле (field) и значение (value).";
      const found = findField(flow, field);
      if (!found) return unknownField(flow, field);
      const fitted = fitValue(found.field, value);
      if (!fitted.ok) return `Не записано: ${fitted.why}. Считай поле неизвестным и спроси ещё раз, когда уместно.`;

      // Сотрудник (песочница) не пишет в данные человека: заметки этого чата можно, карточку — нет.
      if (staff && found.place === "card") return `Не записано: ${STAFF_READ_ONLY}.`;
      if (found.place === "notes") {
        updateRun(pinned, (run) => ({ ...run, notes: { ...run.notes, [found.field.id]: fitted.value } }));
      } else {
        await store.writeCardField({ ownerId, fieldId: found.field.id, value: fitted.value, chatId, flowId: pinned.flowId, at: now().toISOString() });
      }
      return `Записано: «${found.field.name}» = ${fieldValueText(fitted.value)}.`;
    },
  });

  const writeFact = async (store: ClientFactStore, pinned: Pinned, raw: string) => {
    const text = raw.trim().replace(/\s+/g, " ");
    if (text === "") return "Не записано: факт — непустая фраза.";
    if (text.length > MAX_FACT_LENGTH) return `Не записано: факт должен быть короче ${MAX_FACT_LENGTH} знаков — сократи до сути одной фразой.`;
    if (staff) return `Не записано: ${STAFF_READ_ONLY}.`;
    const known = await store.read(ownerId);
    const id = factId(text);
    if (known.some((item) => item.id === id)) return `Уже записано: «${text}».`;
    if (known.length >= MAX_FACTS) return `Не записано: фактов уже ${MAX_FACTS}. Сначала забудь устаревший (client_card { action: "forget", field: id }), потом запиши новый.`;
    await store.add({ ownerId, fact: { id, text }, chatId, flowId: pinned.flowId, at: now() });
    return `Записано, факт [${id}]: ${text}.`;
  };

  const clientCard = tool({
    description:
      "Карточка клиента: что ты знаешь о человеке. { action: \"show\" } — показать (когда спросили, что ты о нём знаешь); { action: \"forget\", field } — стереть поле по id или имени, { field: \"all\" } — стереть всё (когда просят забыть)." +
      (facts ? " Факт стирается по id из «show» или теми же словами." : ""),
    inputSchema: z.object({
      action: z.enum(["show", "forget"]),
      field: z.string().optional().describe("id или имя поля; «all» — всё"),
    }),
    execute: async ({ action, field }) => {
      const pinned = await turn.flow();
      if (!pinned) return NO_FLOW;
      const { flow } = pinned;
      const entries = (await store.readCard(ownerId)).filter((entry) => !isFactEntry(entry.fieldId));
      const known = facts ? await facts.read(ownerId) : [];

      if (action === "show") {
        const nameOf = (id: string) => flow.clientCard.find((item) => item.id === id)?.name ?? id;
        const order = (id: string) => {
          const index = flow.clientCard.findIndex((item) => item.id === id);
          return index === -1 ? Number.MAX_SAFE_INTEGER : index;
        };
        const sorted = [...entries].sort((left, right) => order(left.fieldId) - order(right.fieldId) || left.fieldId.localeCompare(right.fieldId));
        const lines = sorted.map((entry) => {
          const known = flow.clientCard.find((item) => item.id === entry.fieldId);
          const stale = known && isFieldStale(known, Date.parse(entry.updatedAt), now().getTime()) ? ", давно — могло измениться" : "";
          return `- ${nameOf(entry.fieldId)}: ${fieldValueText(entry.value)} (записано ${dateText(entry.updatedAt)}${stale})`;
        });
        const run = runNow(pinned);
        const notes = flow.chatNotes.flatMap((item) => (fieldValueFits(item, run.notes[item.id]) ? [`- ${item.name}: ${fieldValueText(run.notes[item.id])}`] : []));
        const factLines = known.map((item) => `- [${item.id}] ${item.text} (записано ${dateText(item.updatedAt)})`);
        if (lines.length === 0 && notes.length === 0 && factLines.length === 0) return "О человеке пока ничего не записано.";
        return [
          ...(lines.length > 0 ? ["Что известно о человеке:", ...lines] : []),
          ...(factLines.length > 0 ? ["Факты о человеке (id — для «забудь»):", ...factLines] : []),
          ...(notes.length > 0 ? ["Заметки этого чата:", ...notes] : []),
        ].join("\n");
      }

      if (staff) return `Не стёр: ${STAFF_READ_ONLY}.`;
      if (field === undefined || field.trim() === "") return "Какое поле стереть? Укажи id или имя поля, а «all» — стереть всё.";
      if (field.trim() === "all") {
        await store.forgetCard(ownerId, "all");
        updateRun(pinned, (run) => ({ ...run, notes: {} }));
        return "Стёр всё, что знал о человеке.";
      }
      const found = findField(flow, field);
      if (found?.place === "notes") {
        updateRun(pinned, ({ notes: { [found.field.id]: _gone, ...rest }, ...run }) => ({ ...run, notes: rest }));
        return `Стёр заметку «${found.field.name}».`;
      }
      if (!found) {
        const wanted = field.trim().replace(/^fact:/, "");
        const fact = known.find((item) => item.id === wanted || sameFact(item.text, field));
        if (fact) {
          await facts!.forget(ownerId, fact.id);
          return `Стёр факт: «${fact.text}».`;
        }
      }
      const fieldId = found?.field.id ?? entries.find((entry) => entry.fieldId === field.trim())?.fieldId;
      const name = found?.field.name ?? fieldId;
      if (!fieldId || !entries.some((entry) => entry.fieldId === fieldId)) {
        return found
          ? `«${name}» и так не записано: стирать нечего.`
          : `Такого поля или факта нет среди записанного. Записано: ${[...entries.map((entry) => entry.fieldId), ...known.map((item) => item.id)].join(", ") || "ничего"}.`;
      }
      await store.forgetCard(ownerId, fieldId);
      return `Стёр: «${name}».`;
    },
  });

  return { [FLOW_NOTE_TOOL]: flowNote, [CLIENT_CARD_TOOL]: clientCard };
}
