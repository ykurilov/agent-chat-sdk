import type { IncomingMessage } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RawData } from "ws";
import type { RelayConnection, VoiceRelay } from "./server/voice-relay";

export interface VoiceUpgradeOptions {
  /** Адрес соединения голоса, например `"/api/voice/stream"`. Остальные подъёмы (`/_next/webpack-hmr`) — не наши. */
  path: string;
  /**
   * Ретранслятор (`createVoiceRelay`) или функция, которая его отдаёт. Функция нужна, когда ретранслятор создаётся в коде
   * Next.js позже сервера: `sharedVoiceRelay`. Вернула `null` — ответ 503.
   */
  relay: VoiceRelay | (() => VoiceRelay | null);
  /** Предел одного куска от браузера, байты. Больше — закрытие 1009 («слишком длинно»). По умолчанию 1 МиБ. */
  maxFrameBytes?: number;
  /** Сколько ждать проверки входа (`resolveUser`, лимиты), мс. Дольше — ответ 503 и сокет закрыт. По умолчанию 10 000. */
  authorizeTimeoutMs?: number;
}

const DEFAULT_AUTHORIZE_TIMEOUT_MS = 10_000;
const TIMED_OUT = Symbol("timed out");

/**
 * Подъём WebSocket голоса на своём HTTP-сервере Node.js: Next.js с custom server, Express, голый `node:http`.
 * Возвращает обработчик события `upgrade`: `true` — соединение наше и обработано, `false` — адрес чужой, отдайте его
 * дальше (Next.js). Проверки те же, что у Hono: своя страница (Origin), вход, частота, лимит расходов. Отказ с причиной
 * браузер получает кодом закрытия, чужая страница — HTTP 403. Next.js держите на отдельном сервере
 * (`next({ httpServer })`, см. README): на общем он сам подписывается на `upgrade` и может закрыть соединение голоса.
 */
export function createVoiceUpgrade(options: VoiceUpgradeOptions): (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: options.maxFrameBytes ?? 1024 * 1024 });
  const currentRelay = typeof options.relay === "function" ? options.relay : () => options.relay as VoiceRelay;

  return (request, socket, head) => {
    // Пока сокет наш, а ws его ещё не взял, ошибки сети (ECONNRESET) слушаем сами: без обработчика процесс упал бы.
    const destroyOnError = () => socket.destroy();
    let path: string;
    try {
      path = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      // Путь вроде `//` не разбирается: отвечаем сами, иначе исключение уронило бы процесс.
      socket.on("error", destroyOnError);
      refuseHttp(socket, 400);
      return true;
    }
    if (path !== options.path) return false;
    socket.on("error", destroyOnError);
    void (async () => {
      const relay = currentRelay();
      if (!relay) return refuseHttp(socket, 503);
      const access = await withTimeout(relay.authorize(toRequest(request)), options.authorizeTimeoutMs ?? DEFAULT_AUTHORIZE_TIMEOUT_MS);
      if (socket.destroyed) return;
      if (access === TIMED_OUT) return refuseHttp(socket, 503);
      if ("refusal" in access && access.closeCode === undefined) return refuseHttp(socket, access.refusal.status);
      // Дальше ошибки сокета слушает ws.
      socket.off("error", destroyOnError);
      sockets.handleUpgrade(request, socket, head, (client) => {
        if ("refusal" in access) return client.close(access.closeCode);
        const connection: RelayConnection = relay.accept(
          { send: (data) => client.send(data), close: (code, reason) => client.close(code, reason) },
          access.user,
          access.chatId,
        );
        client.on("message", (data, isBinary) => connection.receive(isBinary ? bytes(data) : data.toString()));
        client.on("close", () => connection.closed());
        client.on("error", () => connection.closed());
      });
    })().catch(() => refuseHttp(socket, 500));
    return true;
  };
}

const SHARED_RELAY = Symbol.for("@ykurilov/agent-chat-voice/relay");
type WithSharedRelay = { [SHARED_RELAY]?: VoiceRelay | null };

/**
 * Мостик процесса: Next.js собирает свой код отдельно от `server.ts`, и общий модуль у них — разные копии. Код Next.js
 * кладёт ретранслятор сюда (`shareVoiceRelay(relay)`), сервер берёт его (`relay: sharedVoiceRelay`).
 */
export function shareVoiceRelay(relay: VoiceRelay | null): void {
  (globalThis as WithSharedRelay)[SHARED_RELAY] = relay;
}

export function sharedVoiceRelay(): VoiceRelay | null {
  return (globalThis as WithSharedRelay)[SHARED_RELAY] ?? null;
}

/** Запрос Node.js как стандартный `Request` с настоящими заголовками: Host и Origin нужны проверке страницы. */
function toRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return new Request(new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`), { headers });
}

function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** HTTP-отказ и закрытие сокета: ответ уходит, сокет не остаётся висеть полуоткрытым. */
function refuseHttp(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  const text = STATUS_CODES[status] ?? "Error";
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`, () =>
    socket.destroy(),
  );
}
