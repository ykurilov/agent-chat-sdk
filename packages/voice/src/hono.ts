import type { Context, Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { RelayConnection, VoiceRelay } from "./server/voice-relay";

type VoiceRelayEnv = { Variables: { voiceUser: { id: string } } };

/**
 * Подключает ретранслятор голоса к Hono: `GET {path}` поднимается до WebSocket.
 * `upgradeWebSocket` даёт адаптер вашего сервера, например `createNodeWebSocket` из `@hono/node-ws`.
 * Допуск (401, 429, 503) решается до подъёма, обычным ответом.
 */
export function mountVoiceRelay(app: Hono, path: string, relay: VoiceRelay, upgradeWebSocket: UpgradeWebSocket): void {
  (app as unknown as Hono<VoiceRelayEnv>).get(
    path,
    async (context, next) => {
      const access = await relay.authorize(context.req.raw);
      if ("refusal" in access) return access.refusal;
      context.set("voiceUser", access.user);
      await next();
    },
    upgradeWebSocket((context: Context<VoiceRelayEnv>) => {
      const user = context.get("voiceUser");
      let connection: RelayConnection | undefined;
      // Куски звука и «конец звука» должны дойти по порядку, даже если платформа отдаёт их вразнобой (Blob).
      let queue: Promise<void> = Promise.resolve();
      return {
        onOpen(_event, socket) {
          connection = relay.accept({ send: (data) => socket.send(data), close: (code, reason) => socket.close(code, reason) }, user);
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
