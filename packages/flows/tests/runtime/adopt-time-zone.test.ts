import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying } from "../../../core/tests/unit/support/notice-chat";
import { clockAt, human, MSK, OWNER, stateOfChat, tick, timerChat } from "./timer-chat";
import { iso, msk, NSK, nsk, promptText, threeDays } from "./days-chat";

// 0.55, боевой чат приложения-генератора: закреплён через `flow.adopt` без хода, пока пояс неизвестен (`defaultTimeZone`
// Москва). В первый день агент узнаёт город и зовёт `flow_time_zone` — первый день и все сроки пересчитываются по поясу
// человека (→ В1, FR-207), как у чата, закреплённого первым ходом.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 12)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

/** Как в приложении: закрепление при первом сообщении из мессенджера, пояса нет; затем ход, где агент узнал город. */
async function adoptedThenNovosibirsk(at: number) {
  clockAt(at);
  const chat = timerChat({
    edit: threeDays,
    defaultTimeZone: MSK,
    scripts: [callTool("flow_time_zone", "z1", { timeZone: NSK }), saying("Буду писать по вашему времени."), saying("Доброе утро!"), saying("Новый день.")],
  });
  const { id } = await chat.service.createChat(OWNER);
  await chat.flow.adopt({ ownerId: OWNER, chatId: id, flowId: "sales-review", versionId: "v1", flow: chat.json, startedAt: new Date(at), lastAgentAt: new Date(at) });
  clockAt(at + 5 * 60_000);
  await human(chat, id, "Я из Новосибирска", null);
  expect(await chat.store.readTimeZone(OWNER)).toBe(NSK);
  return { chat, id };
}

const runOf = async (chat: ReturnType<typeof timerChat>, id: string) => (await chat.service.getChatState(OWNER, id)).values.flow as Record<string, any>;

describe("adopt без хода, затем пояс человека в первый день", () => {
  it("днём: якорь, сроки нод, срок программы и «День N из M» — по Новосибирску", async () => {
    // 12:00 по Москве — 16:00 в Новосибирске: первый день — сегодня, 09:00 по его часам.
    const { chat, id } = await adoptedThenNovosibirsk(msk(13, 12));
    expect(await runOf(chat, id)).toMatchObject({ dayAnchorAt: nsk(13, 9) });
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ day: { day: 1, totalDays: 3, nextDayStartAt: nsk(14, 9) } });
    // «Знакомство» длится 1 день: переход в 09:00 завтра по его часам, а не по Москве.
    expect(await chat.store.getChat(id)).toMatchObject({ timeZone: NSK, dueAt: iso(nsk(14, 9)) });

    clockAt(msk(13, 12, 10));
    await human(chat, id, "Отлично", null);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain("День 1 из 3. Сейчас 16:10");

    clockAt(nsk(14, 9));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("block");
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ day: { day: 2, totalDays: 3 } });

    // Срок программы: начало 4-го дня по его часам.
    clockAt(nsk(15, 9));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(nsk(16, 9)), dueExitId: "@deadline" });
  });

  it("вечером: у него уже ночь — первый день переносится на завтра, утреннее в 09:00 по его часам", async () => {
    // 17:00 по Москве — 21:00 в Новосибирске: по Москве первый день сегодня, по его часам — завтра (поздний старт).
    const { chat, id } = await adoptedThenNovosibirsk(msk(13, 17));
    expect(await runOf(chat, id)).toMatchObject({ dayAnchorAt: nsk(14, 9) });
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ day: { day: 0, totalDays: 3 } });
    expect(await chat.store.getChat(id)).toMatchObject({ timeZone: NSK, dueAt: iso(nsk(14, 9)), dueExitId: "@first" });

    clockAt(msk(13, 17, 10));
    await human(chat, id, "Спокойной ночи", null);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain("Первый день начнётся завтра в 09:00. Сейчас 21:10");

    // Утреннее первого дня — в 09:00 по Новосибирску; «Знакомство» длится до 09:00 второго дня.
    clockAt(nsk(14, 9));
    await tick(chat, id);
    expect(await chat.flow.readRun(OWNER, id)).toMatchObject({ state: "intro", day: { day: 1, totalDays: 3 } });
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(nsk(15, 9)) });
  });
});
