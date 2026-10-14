import type { StepContextInput } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowStepContextInput } from "../../src/runtime/flow-types";
import { withoutSilenceTimers } from "../flow-fixtures";
import { clockAt, human, MSK, OWNER, tick, timerChat } from "./timer-chat";
import { msk, promptText, systemOf } from "./days-chat";

// 0.50: почему агент пишет первым — в хвосте приложения (`agent.stepContext` получает `firstReasons`). Постоянная
// инструкция от причины не зависит: меняется только хвост.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 20, 50)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const schedule = {
  dayStart: "09:00",
  nightFrom: "21:00",
  nudges: { afterSilence: [{ amount: 15, unit: "min" }] },
  firstMessages: { morning: true },
};

function chatOf() {
  const seen: Array<FlowStepContextInput["firstReasons"]> = [];
  const stepContext = (input: StepContextInput) => {
    const { firstReasons } = input as FlowStepContextInput;
    seen.push(firstReasons);
    return firstReasons?.some((reason) => reason.kind === "morning") ? "Хвост: утро." : "Хвост приложения.";
  };
  const chat = timerChat({ edit: (json) => (withoutSilenceTimers(json), (json.schedule = schedule)), agent: { stepContext } });
  return { chat, seen };
}

describe("причины «пишет первым» в хвосте приложения", () => {
  it("ход «пишет первым» — причины в хвосте, касание утром заменено утренним; обычный ход — без причин; инструкция та же", async () => {
    const { chat, seen } = chatOf();
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Привет", MSK);
    expect(seen).toEqual([undefined]);

    // Касание по тишине в 21:05 — уже ночь: ждёт утра. В 9:00 его заменяет утреннее: один ход, причина — только утро.
    clockAt(msk(14, 21, 5));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    clockAt(msk(15, 9));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(seen.at(-1)).toEqual([{ kind: "morning" }]);
    const [answer, touch] = chat.model.doStreamCalls;
    expect(promptText(touch!)).toContain("Хвост: утро.");
    expect(systemOf(touch!)).toBe(systemOf(answer!));

    await human(chat, id, "Я тут", MSK);
    expect(seen.at(-1)).toBeUndefined();
    expect(await chat.flow.readRun(OWNER, id)).not.toHaveProperty("firstReasons");
  });
});
