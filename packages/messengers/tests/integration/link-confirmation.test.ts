import { describe, expect, it, vi } from "vitest";
import { createMessengers } from "../../src/create-messengers";
import { createMemoryMessengerStore } from "../../src/store/memory-store";
import { anna, type HumanEvent } from "../fake-apis/rig";
import { telegramChannel, vkChannel } from "./support/channels";
import { createFakeChatService } from "../support/fake-chat-service";

for (const withService of [false, true]) {
  describe.each([{ name: "Telegram", open: telegramChannel }, { name: "VK", open: vkChannel }])(`подтверждение через HTTP адаптера, service=${withService}, $name`, ({ open }) => {
    it("ссылка не привязывает, явное Да привязывает и подтверждает callback; награда одна", async () => {
      const channel = await open();
      const store = createMemoryMessengerStore();
      const onLinked = vi.fn();
      const errors: unknown[] = [];
      const service = createFakeChatService();
      const messengers = createMessengers({
        store, bots: [channel.bot], basePath: "/api/messengers",
        resolveUser: async () => ({ id: "target" }),
        linkConfirmation: { label: () => "t***@mail.test <account>" },
        onLinked, logError: (error) => errors.push(error),
        ...(withService && { service: service.service }),
      });
      const deliver = async (event: HumanEvent) => {
        const response = await messengers.handler.fetch(channel.webhookRequest(`http://app.test/api/messengers${channel.webhookPath}`, event));
        expect(response.status).toBe(200);
        await messengers.flush();
      };
      try {
        const response = await messengers.handler.fetch(new Request("http://app.test/api/messengers/links", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messenger: channel.messenger }),
        }));
        expect(response.status).toBe(200);
        const { code } = await response.json() as { code: string };
        await deliver({ type: "start", from: anna, payload: code });
        const question = channel.outgoing.at(-1)!;
        expect(question.text).toContain("t***@mail.test <account>");
        expect(question.format).toBe("plain");
        expect(question.buttons[0]?.[0]?.text).toBe("Да");
        expect(await store.findLink(channel.messenger, channel.bot.botId, anna.id)).toBeNull();
        expect(onLinked).not.toHaveBeenCalled();
        const click: HumanEvent = {
          type: "press", chat: channel.privateChatOf(anna), from: anna,
          data: question.buttons[0]![0]!.data!, messageId: question.messageId,
        };
        await deliver(click);
        expect((await store.findLink(channel.messenger, channel.bot.botId, anna.id))?.userId).toBe("target");
        expect(onLinked).toHaveBeenCalledTimes(1);
        expect(channel.answers).toHaveLength(1);
        expect(channel.outgoing.at(-1)?.text).toBe("Готово: аккаунт подключён.");
        await deliver(click);
        expect(onLinked).toHaveBeenCalledTimes(1);
        expect(channel.answers).toHaveLength(2);
        expect(service.sent).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await messengers.stop();
        await channel.close();
      }
    });
  });
}
