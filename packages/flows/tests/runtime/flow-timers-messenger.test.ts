import { afterEach, describe, expect, it, vi } from "vitest";
import { anna } from "../../../messengers/tests/fake-apis/rig";
import { telegramChannel } from "../../../messengers/tests/integration/support/channels";
import { type RealChat, startRealChat } from "../../../messengers/tests/integration/support/real-chat";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureJson } from "../flow-fixtures";
import { emptyClientCard, fakeJudge } from "./flow-chat";

// T074: сообщение по таймеру приходит в привязанный разговор мессенджера; в заблокированный не уходит.

const REMIND = "Вы ещё здесь? Можем продолжить, когда будет удобно.";
const annaChat = { id: anna.id, type: "private" as const };

let real: RealChat | undefined;
afterEach(async () => {
  await real?.close();
  real = undefined;
});

async function flowInTelegram() {
  const json = fixtureJson("sales-review");
  const { judge } = fakeJudge({ yes: [] });
  const logError = vi.fn<(message: string) => void>();
  const flow = buildAgentFlow(
    {
      loadFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow: json }),
      store: memoryFlowStore(),
      judge: { fallback: { modelId: "mock-model", providerId: "mock" } },
      logError,
    },
    { judge, clientCard: emptyClientCard() },
  );
  // Пояс человека в мессенджере неизвестен — берётся пояс приложения.
  real = await startRealChat({ channel: await telegramChannel(), server: flow.withChat({ agent: { instructions: "Ты помощник.", timeZone: "Europe/Moscow" } }) });
  flow.attach(real.service);
  await real.link(anna, "anna");
  real.model.script({ text: "Здравствуйте! О чём ваш курс?" });
  await real.human({ type: "text", chat: annaChat, from: anna, text: "Привет" });
  await flow.settled();
  return { flow, logError, chat: real };
}

describe("T074 таймер сценария в мессенджере", () => {
  it("тишина 3 ч — «Напоминание» приходит в чат мессенджера без хода модели", async () => {
    const { flow, logError, chat } = await flowInTelegram();
    expect(chat.textsIn(annaChat.id).at(-1)).toBe("Здравствуйте! О чём ваш курс?");
    const calls = chat.model.calls.length;

    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
    await flow.tick();
    await chat.until(() => chat.textsIn(annaChat.id).at(-1) === REMIND, "напоминание в мессенджере");
    expect(chat.model.calls.length).toBe(calls);
    expect(chat.errors).toEqual([]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("человек заблокировал бота — напоминание в мессенджер не уходит", async () => {
    const { flow, chat } = await flowInTelegram();
    const [conversation] = await chat.store.listConversationsOfUser("anna");
    await chat.store.setBlocked(conversation!, true, new Date().toISOString());
    const sent = chat.channel.outgoing.length;

    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
    await flow.tick();
    await flow.settled();
    await chat.settle();
    // Таймер сработал, «Напоминание» записано в чат, но в мессенджер не ушло.
    expect((await flow.readRun("anna", conversation!.currentChatId!))?.state).toBe("remind");
    expect(chat.channel.outgoing.length).toBe(sent);
    expect(chat.errors).toEqual([]);
  });
});
