import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFlow, compactFlow, parseFlow, type AgentFlow } from "../../src/format";
import { stateNudges } from "../../src/engine/nudges";
import { fixtureFlow, fixtureJson, stateOf, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, MSK, OWNER, tick, timerChat } from "./timer-chat";
import { iso, msk } from "./days-chat";

// 0.50: касания на весь сценарий (`nudges` в корне) — без «Дней и времени». Без поля — как в 0.49.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 11)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const NUDGES = { afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }], giveUpAfter: { amount: 1, unit: "d" } };

const withRootNudges = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.nudges = NUDGES;
};

const parsed = (json: unknown): AgentFlow => {
  const result = parseFlow(json);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  return result.flow;
};

describe("общие касания сценария (`nudges` в корне)", () => {
  it("разбираются и сжимаются обратно; сценарий без поля — без ключа", () => {
    const json = fixtureJson("sales-review");
    withRootNudges(json);
    const flow = parsed(json);
    expect(flow.nudges).toEqual(NUDGES);
    expect(compactFlow(flow)).toMatchObject({ nudges: NUDGES });
    expect(parsed(compactFlow(flow))).toEqual(flow);
    const plain = parsed(fixtureJson("sales-review"));
    expect(plain).not.toHaveProperty("nudges");
    expect(compactFlow(plain)).not.toHaveProperty("nudges");
  });

  it("порядок: своё у ноды → «off» → касания «Дней и времени» → общие сценария", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      withRootNudges(json);
      stateOf(json, "offer").nudges = "off";
      stateOf(json, "block").nudges = { afterSilence: [{ amount: 5, unit: "min" }] };
    });
    expect(stateNudges(flow, "intro")).toEqual(NUDGES);
    expect(stateNudges(flow, "block")?.afterSilence).toEqual([{ amount: 5, unit: "min" }]);
    expect(stateNudges(flow, "offer")).toBeNull();
    const both = { ...flow, schedule: { ...parsed({ ...fixtureJson("sales-review"), schedule: { dayStart: "09:00", nudges: { afterSilence: [{ amount: 2, unit: "h" }] } } }).schedule! } };
    expect(stateNudges(both, "intro")?.afterSilence).toEqual([{ amount: 2, unit: "h" }]);
  });

  it("проверка: пустой ряд — предупреждение; и в корне, и в «Днях и времени» — предупреждение, что действуют вторые", () => {
    const catalog = { tools: ["give_booking_link", "call_expert"], events: ["paid"], widgets: ["booking_link"] };
    const empty = checkFlow(fixtureFlow("sales-review", (json) => (json.nudges = { afterSilence: [] })), catalog);
    expect(empty).toContainEqual(expect.objectContaining({ level: "warning", code: "empty_nudges" }));
    const twice = checkFlow(
      fixtureFlow("sales-review", (json) => {
        json.nudges = NUDGES;
        json.schedule = { dayStart: "09:00", nudges: NUDGES };
      }),
      catalog,
    );
    expect(twice).toContainEqual(expect.objectContaining({ level: "warning", code: "nudges_shadowed" }));
  });

  it("живой чат без «Дней и времени»: касания по тишине в срок, потом «не завершил»", async () => {
    const chat = timerChat({ edit: withRootNudges });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет", MSK);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 15)) });

    clockAt(msk(14, 11, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    const timer = (await appNotices(chat.storage, id)).filter((notice) => notice.name === "flow_timer");
    expect(timer.at(-1)).toMatchObject({ data: { reasons: [{ kind: "silence", step: 1 }] } });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 12, 15)) });

    clockAt(msk(14, 12, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(3);

    // Сутки тишины от последней реплики человека — конец без сообщения.
    clockAt(msk(15, 11));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(3);
    expect(chat.finished).toMatchObject([{ chatId: id, reason: "abandoned" }]);
  });
});
