import { createRequestOriginCheck, isSafeMethod, originRefusalHint } from "@ykurilov/agent-chat-core";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { createDialogRelay } from "./server/dialog-relay";
import type { DialogConnection, DialogRelayOptions } from "./server/dialog-relay";
import { mountFillerRoutes } from "./server/filler-routes";
import { mountVoiceRoutes } from "./server/voices";

export { mountFillerRoutes } from "./server/filler-routes";
export type { FillerRoutesOptions } from "./server/filler-routes";
export { mountVoiceRoutes } from "./server/voices";
export type { VoiceRoutesOptions } from "./server/voices";

export type MountDialogRelayOptions = DialogRelayOptions & {
  /** Адрес: WebSocket поднимается на `{path}/stream`. */
  path: string;
  /** Подъём WebSocket от адаптера вашего сервера, например `createNodeWebSocket` из `@hono/node-ws`. */
  upgradeWebSocket: UpgradeWebSocket;
  /**
   * Чужие страницы, которым можно открывать диалог, например `["https://school.getcourse.ru"]` (схема, хост, порт).
   * Своя страница проходит всегда, чужая — ответ 403 `forbidden_origin`: так чужой сайт не откроет сокет с cookie
   * вошедшего человека. Проверяются подъём WebSocket и запросы, меняющие данные (выбор голоса).
   * Запрос не из браузера (без Origin и Sec-Fetch-Site) проходит: его судит `resolveUser`.
   */
  allowedOrigins?: string[] | undefined;
};

/**
 * Подключает голосовой диалог к Hono: `GET {path}/stream?chatId=…` поднимается до WebSocket.
 * Допуск (пользователь, чат, лимиты) решается сразу после подъёма закрытием с кодом 44xx, как описано в договоре.
 * Если озвучка настроена, рядом подключаются `GET {path}/voices` и `PUT {path}/voice` на том же каталоге голосов, что и у режима,
 * и `GET {path}/fillers` с звуком фраз-заполнителей (выключаются `speech.fillerPhrases: false`).
 */
export function mountDialogRelay(app: Hono, { path, upgradeWebSocket, allowedOrigins, ...options }: MountDialogRelayOptions): void {
  const relay = createDialogRelay(options);
  const base = path.replace(/\/+$/, "");
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins,
    onRefused: (refusal) => options.logError(`Голосовой диалог: ${originRefusalHint(refusal)}`),
  });
  // Подъём WebSocket — тоже GET, но браузер прикладывает к нему cookie человека: его проверяем всегда.
  const originGuard: MiddlewareHandler = async (context, next) => {
    const request = context.req.raw;
    const upgrade = new URL(request.url).pathname === `${base}/stream`;
    if ((upgrade || !isSafeMethod(request.method)) && !allowsOrigin(request)) {
      return context.json({ error: { kind: "forbidden_origin" } }, 403);
    }
    await next();
  };
  app.use(`${base}/*`, originGuard);
  if (relay.voices) mountVoiceRoutes(app, { path, catalog: relay.voices, resolveUser: options.resolveUser });
  const voiceIds = new Set(relay.voices?.voices.map((voice) => voice.id));
  if (relay.fillers) {
    mountFillerRoutes(app, { path, library: relay.fillers, storage: options.storage, voiceAllowed: (id) => voiceIds.has(id), resolveUser: options.resolveUser });
  }
  app.get(
    `${base}/stream`,
    upgradeWebSocket((context: Context) => {
      const request = context.req.raw;
      let connection: DialogConnection | undefined;
      // Куски звука и команды должны дойти по порядку, даже если платформа отдаёт их вразнобой (Blob).
      let queue: Promise<void> = Promise.resolve();
      return {
        onOpen(_event, socket) {
          // Кадры озвучки собираются в обычном ArrayBuffer (`encodeSpeechFrame`), общей памяти в них нет.
          connection = relay.accept({ send: (data) => socket.send(data as string | Uint8Array<ArrayBuffer>), close: (code) => socket.close(code) }, request);
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
