import type { ReplyCheck } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it } from "vitest";
import type { AnswerDeliveryReport } from "../../src/types";
import { anna } from "../fake-apis/rig";
import { telegramChannel } from "./support/channels";
import { type RealChat, startRealChat } from "./support/real-chat";

// 061 этап 5 (T504): служба с проверками ответа — в мессенджер уходит только проверенный текст, без черновика по ходу.

const annaChat = { id: anna.id, type: "private" as const };

/** Латинская «p» внутри русского слова → русская. */
const latinLetters: ReplyCheck = async ({ text }) => (text.includes("Пpивет") ? { text: text.replaceAll("Пpивет", "Привет"), note: "латиница в слове" } : undefined);

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

describe("проверка ответа и мессенджеры (061, T504)", () => {
  it("ответ человеку и ход notice: человек видит только проверенный текст, черновика с ошибкой не было", async () => {
    const reports: AnswerDeliveryReport[] = [];
    const channel = await telegramChannel();
    chat = await startRealChat({ channel, replyChecks: [latinLetters], messengers: { onAnswerDelivery: (report) => void reports.push(report) } });
    await chat.link(anna, "anna");

    const long = "Пpивет! Расскажу подробно, с чего начать работу над первым приложением.";
    chat.model.script({ text: long });
    await chat.human({ type: "text", chat: annaChat, from: anna, text: "Привет" });
    const seen = () => [...channel.fake.state.drafts.map((draft) => draft.text), ...chat!.textsIn(annaChat.id)];
    expect(chat.textsIn(annaChat.id).at(-1)).toBe(long.replace("Пpивет", "Привет"));
    expect(seen().some((text) => text?.includes("Пpивет"))).toBe(false);
    expect(reports.at(-1)).toMatchObject({ ownerId: "anna", trigger: "human", outcome: { status: "delivered" } });

    const [current] = await chat.messengerService.listChats("anna");
    chat.model.script({ text: "Пpивет снова! Принёс новое: короткий план на сегодня из трёх шагов." });
    await chat.messengerService.deliverNotices({
      ownerId: "anna",
      chatId: current!.id,
      notices: [{ kind: "app", name: "flow_timer", title: "Утро" }],
      wakeAgent: true,
      deliveryKey: "morning-1",
    });
    await chat.until(() => chat!.textsIn(annaChat.id).at(-1)?.startsWith("Привет снова") === true, "утреннее сообщение");
    expect(seen().some((text) => text?.includes("Пpивет"))).toBe(false);
    expect(reports.at(-1)).toMatchObject({ ownerId: "anna", chatId: current!.id, trigger: "notice", outcome: { status: "delivered" } });
    expect(chat.errors).toEqual([]);
  });
});
