import type { Context, Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { RelayConnection, VoiceRelay } from "./server/voice-relay";

type VoiceRelayEnv = { Variables: { voiceUser: { id: string }; voiceChatId: string; voiceCloseCode: number | undefined } };

/**
 * Подключает ретранслятор голоса к Hono: `GET {path}` поднимается до WebSocket.
 * `upgradeWebSocket` даёт адаптер вашего сервера, например `createNodeWebSocket` из `@hono/node-ws`.
 * Допуск решается до подъёма. Отказ с причиной (не вошёл, лимит, частота, сервис недоступен) браузер видит только кодом
 * закрытия: соединение поднимается и сразу закрывается этим кодом. Чужая страница — обычный HTTP-ответ 403.
 */
export function mountVoiceRelay(app: Hono, path: string, relay: VoiceRelay, upgradeWebSocket: UpgradeWebSocket): void {
  (app as unknown as Hono<VoiceRelayEnv>).get(
    path,
    async (context, next) => {
      const access = await relay.authorize(context.req.raw);
      if ("refusal" in access) {
        if (access.closeCode === undefined) return access.refusal;
        context.set("voiceCloseCode", access.closeCode);
      } else {
        context.set("voiceUser", access.user);
        context.set("voiceChatId", access.chatId);
      }
      await next();
    },
    upgradeWebSocket((context: Context<VoiceRelayEnv>) => {
      const user = context.get("voiceUser");
      const chatId = context.get("voiceChatId");
      const closeCode = context.get("voiceCloseCode");
      let connection: RelayConnection | undefined;
      // Куски звука и «конец звука» должны дойти по порядку, даже если платформа отдаёт их вразнобой (Blob).
      let queue: Promise<void> = Promise.resolve();
      return {
        onOpen(_event, socket) {
          if (closeCode !== undefined) return socket.close(closeCode);
          connection = relay.accept({ send: (data) => socket.send(data), close: (code, reason) => socket.close(code, reason) }, user, chatId);
        },
        onMessage(event) {
          const data = event.data as unknown;
          queue = queue.then(async () => {
            if (typeof data === "string") connection?.receive(data);
            else if (data instanceof Blob) connection?.receive(new Uint8Array(await data.arrayBuffer()));
            else if (ArrayBuffer.isView(data)) connection?.receive(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            else if (data instanceof ArrayBuffer) connection?.receive(data);
          });
        },
        onClose: () => connection?.closed(),
        onError: () => connection?.closed(),
      };
    }),
  );
}
