import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR, MIN, withoutSilenceTimers } from "../flow-fixtures";
import { appNotices, clockAt, human, MSK, OWNER, T0, tick, timerChat } from "./timer-chat";
import { daysChat, msk, threeDays } from "./days-chat";

// 100: в служебном сообщении «пишет первым» — данные для строки на экране: сколько человек молчал (по часам чата)
// и какой срок сработал. Текст для модели прежний.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(T0) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

describe("100 данные пометки «пишет первым» для экрана", () => {
  it("переход по тишине: silentMs — от сообщения человека до хода; exit — шаг и условие срока", async () => {
    const chat = timerChat();
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели, продал 5 штук", MSK);
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    const [notice] = await appNotices(chat.storage, id);
    expect(notice!.data).toMatchObject({
      silentMs: 3 * HOUR,
      exit: { stateTitle: expect.any(String), when: { type: "timer", from: "silence", amount: 3, unit: "h" } },
    });
  });

  it("касание 2: «человек молчал» — от сообщения человека, а не от прошлого касания", async () => {
    const schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: [{ amount: 15, unit: "min" }, { amount: 30, unit: "min" }] } };
    const chat = timerChat({ edit: (json) => (withoutSilenceTimers(json), (json.schedule = schedule)) });
    const humanAt = msk(14, 12);
    clockAt(humanAt);
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели", MSK);
    for (let at = humanAt + MIN; at <= humanAt + 2 * HOUR; at += MIN) {
      clockAt(at);
      await tick(chat, id);
    }
    const silences = (await appNotices(chat.storage, id)).filter((notice) =>
      (notice.data as { reasons: Array<{ kind: string }> }).reasons.some((reason) => reason.kind === "silence"),
    );
    expect(silences.map((notice) => (notice.data as { silentMs: number }).silentMs)).toEqual([15 * MIN, 45 * MIN]);
  });

  it("прощание по сроку: silentMs от последнего сообщения человека", async () => {
    vi.setSystemTime(new Date(msk(13, 15)));
    const chat = daysChat({ edit: (json) => threeDays(json, { farewellOnDeadline: true }) });
    clockAt(msk(13, 15));
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели", MSK);
    for (const at of [msk(14, 9), msk(15, 9), msk(16, 9)]) {
      clockAt(at);
      await tick(chat, id);
    }
    const farewell = (await appNotices(chat.storage, id)).find((notice) => notice.name === "flow_deadline");
    expect(farewell!.data).toMatchObject({ reasons: [{ kind: "farewell" }], silentMs: expect.any(Number) });
    expect((farewell!.data as { silentMs: number }).silentMs).toBe(msk(16, 9) - msk(13, 15));
  });
});

describe("100 проекция для экрана: в браузер — только то, что нужно строке", () => {
  it("с правом appNotices: flow_timer — reasons, silentMs, exit; сигнал приложения с секретом не уходит", async () => {
    const chat = timerChat({ chatOptions: { chatCapabilities: () => ({ appNotices: true }) } });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели, продал 5 штук", MSK);
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid", data: { card: "4111 1111 1111 1111" } });
    clockAt(T0 + 3 * HOUR);
    await tick(chat, id);
    const history = (await chat.service.getHistory(OWNER, id))!;
    expect(JSON.stringify(history)).not.toContain("4111");
    const shown = history.messages.flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "data-agent-notice" ? ((part as { data: { notices: unknown[] } }).data.notices as unknown[]) : [])),
    );
    expect(shown).toEqual([
      {
        kind: "app",
        name: "flow_timer",
        data: { reasons: [{ kind: "transition" }], silentMs: 3 * HOUR, exit: { stateTitle: expect.any(String), when: { type: "timer", from: "silence", amount: 3, unit: "h" } } },
      },
    ]);
  });
});
