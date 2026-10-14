import { z } from "zod";
import {
  AGENT_FLOW_FORMAT,
  AGENT_FLOW_FORMAT_VERSION,
  DEFAULT_LATE_START_HOURS,
  DEFAULT_SIDE_TASK_MAX_ATTEMPTS,
  FLOW_AFTER_END_MODES,
  FLOW_DATA_OPS,
  FLOW_EVENT_TYPES,
  FLOW_FIELD_TYPES,
  FLOW_TIMER_SPANS,
  FLOW_TIMER_UNITS,
  type AgentFlow,
} from "./flow-format";

// Схема только про форму JSON. Пустой текст условия, условие без цели, сценарий без старта, ссылки на несуществующие
// состояния — не ошибки формата: их показывает `checkFlow`, чтобы недописанный сценарий можно было сохранить.

const id = z.string().min(1);
const names = z.array(z.string()).default([]);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время суток пишется как «ЧЧ:ММ», например «10:00».");

const fieldShape = {
  id,
  name: z.string(),
  about: z.string().default(""),
  type: z.enum(FLOW_FIELD_TYPES).default("text"),
  options: names,
};

const flowField = z.strictObject(fieldShape);

const clientCardField = z.strictObject({
  ...fieldShape,
  refreshAfterMonths: z.int().positive().nullable().default(null),
});

const judgeCondition = z.strictObject({ type: z.literal("judge"), text: z.string() });

const dataCondition = z
  .strictObject({
    type: z.literal("data"),
    field: id,
    op: z.enum(FLOW_DATA_OPS).default("filled"),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .superRefine((condition, context) => {
    if (condition.op !== "filled" && condition.value === undefined) {
      context.addIssue({ code: "custom", path: ["value"], message: "Для сравнения нужно значение `value`." });
    }
  });

const eventCondition = z.strictObject({
  type: z.literal("event"),
  event: z.enum(FLOW_EVENT_TYPES),
  name: z.string().optional(),
});

const timerCondition = z.discriminatedUnion("from", [
  z.strictObject({
    type: z.literal("timer"),
    from: z.enum(FLOW_TIMER_SPANS),
    amount: z.number().positive(),
    unit: z.enum(FLOW_TIMER_UNITS),
  }),
  z.strictObject({ type: z.literal("timer"), from: z.literal("time_of_day"), at: clock }),
  // `days` < 1 — не ошибка формы: недописанный сценарий сохраняется, находку показывает `checkFlow`.
  z.strictObject({ type: z.literal("timer"), from: z.literal("state_days"), days: z.int() }),
]);

const duration = z.strictObject({ amount: z.number().positive(), unit: z.enum(FLOW_TIMER_UNITS) });

// Пустой ряд касаний — не ошибка формы, а находка `checkFlow`.
const nudges = z.strictObject({
  afterSilence: z.array(duration),
  dailyAt: z.array(clock).optional(),
  giveUpAfter: duration.optional(),
});

const schedule = z.strictObject({
  dayStart: clock,
  nightFrom: clock.optional(),
  lateStartHours: z.number().min(0).max(24).default(DEFAULT_LATE_START_HOURS),
  lengthDays: z.int().min(1).max(60).optional(),
  deadlineState: z.string().optional(),
  farewellOnDeadline: z.boolean().default(false),
  farewellText: z.string().optional(),
  firstMessages: z
    .strictObject({
      maxPerDay: z.int().min(0).optional(),
      morning: z.boolean().optional(),
      skipMorningIfHumanWithinMin: z.int().min(0).optional(),
    })
    .optional(),
  nudges: nudges.optional(),
  dayFrame: z
    .strictObject({ softFrom: z.int().positive().optional(), hardAt: z.int().positive().optional(), hardText: z.string().optional() })
    .optional(),
});

const sideTask = z.strictObject({
  id,
  text: z.string(),
  when: z.string().optional(),
  field: z.string().optional(),
  maxAttempts: z.int().positive().default(DEFAULT_SIDE_TASK_MAX_ATTEMPTS),
  perConversation: z.boolean().default(false),
});

const flowCondition = z.discriminatedUnion("type", [judgeCondition, dataCondition, eventCondition, timerCondition]);

const flowExit = z.strictObject({ id, when: flowCondition, to: z.string().nullable().default(null) });
const exits = z.array(flowExit).default([]);

const flowState = z.strictObject({
  id,
  kind: z.literal("state").default("state"),
  title: z.string().default(""),
  instructions: z.string().default(""),
  firstMessage: z.string().nullable().default(null),
  learn: names,
  noSideQuestions: z.boolean().default(false),
  tools: names,
  tags: names,
  exits,
  nudges: z.union([nudges, z.literal("off")]).optional(),
});

export const DEFAULT_SIDE_QUESTION_EVERY_MESSAGES = 5;

/** Схема сценария текущей версии формата. Вход — JSON без значений по умолчанию, выход — `AgentFlow`. */
export const agentFlowSchema = z
  .strictObject({
    $schema: z.string().optional(),
    format: z.literal(AGENT_FLOW_FORMAT),
    version: z.literal(AGENT_FLOW_FORMAT_VERSION),
    id,
    name: z.string(),
    start: z.string().nullable().default(null),
    common: z.string().default(""),
    pace: z
      .strictObject({ sideQuestionEveryMessages: z.int().positive().default(DEFAULT_SIDE_QUESTION_EVERY_MESSAGES) })
      .default({ sideQuestionEveryMessages: DEFAULT_SIDE_QUESTION_EVERY_MESSAGES }),
    clientCard: z.array(clientCardField).default([]),
    chatNotes: z.array(flowField).default([]),
    tools: names,
    anyState: z.strictObject({ except: names, exits }).default({ except: [], exits: [] }),
    states: z.array(flowState),
    layout: z.record(z.string(), z.strictObject({ x: z.number(), y: z.number() })).default({}),
    schedule: schedule.optional(),
    nudges: nudges.optional(),
    sideTasks: z.array(sideTask).optional(),
    afterEnd: z.enum(FLOW_AFTER_END_MODES).optional(),
  })
  .transform(({ $schema: _schema, ...flow }) => flow);

/** Выход схемы и `AgentFlow` описывают одно и то же: расхождение — ошибка сборки. */
type SchemaOutput = z.output<typeof agentFlowSchema>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesTypes: Same<SchemaOutput, AgentFlow> = true;
void schemaMatchesTypes;
