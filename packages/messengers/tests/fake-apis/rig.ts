import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { BotCommand, ExternalChat, InboundUpdate, MessengerAdapter, MessengerName } from "../../src/messenger-adapter";

/** Человек, который пишет боту. */
export interface Person {
  id: string;
  name: string;
  username?: string;
}

/** Что делает человек. Каждый поддельный сервер превращает это в сырое событие своего мессенджера. */
export type HumanEvent =
  | { type: "text"; chat: ExternalChat; from: Person; text: string; mentionsBot?: boolean; repliesToBot?: boolean }
  | { type: "start"; from: Person; payload?: string }
  | { type: "press"; chat: ExternalChat; from: Person; data: string; messageId: string }
  | { type: "voice"; chat: ExternalChat; from: Person; audio: Uint8Array; durationMs: number; transcription?: string }
  | { type: "file"; chat: ExternalChat; from: Person; name: string; mediaType: string; bytes: Uint8Array; caption?: string }
  | { type: "bot_added" | "bot_removed"; chat: ExternalChat; by: Person }
  | { type: "blocked" | "allowed"; from: Person };

/** Сообщение бота так, как его видит сервер мессенджера (с учётом правок). */
export interface Outgoing {
  chatId: string;
  messageId: string;
  kind: "text" | "photo" | "voice" | "audio-file";
  text: string;
  format: "html" | "plain";
  buttons: Array<Array<{ text: string; data?: string; url?: string }>>;
  bytes?: Uint8Array;
  edits: number;
}

/** Поддельный мессенджер глазами общих тестов адаптера. */
export interface AdapterRig {
  readonly messenger: MessengerName;
  readonly botId: string;
  readonly adapter: MessengerAdapter;
  readonly anna: Person;
  readonly boris: Person;
  readonly chats: { annaPrivate: ExternalChat; group: ExternalChat };
  /** Человек пишет боту: событие приходит на вебхук адаптера. */
  deliver(event: HumanEvent): Promise<InboundUpdate[]>;
  /** Запрос на вебхук с верным секретом и этим телом как есть. */
  signedWebhook(body: string): Request;
  /** То же, но по опросу: события лежат на сервере, адаптер их забирает. */
  poll(events: HumanEvent[]): Promise<InboundUpdate[]>;
  readonly outgoing: Outgoing[];
  readonly answers: Array<{ callbackId: string; text?: string }>;
  readonly commands: Array<{ scope: "private" | "group"; commands: BotCommand[] }>;
  /** Для каких областей у мессенджера есть меню команд. */
  readonly commandScopes: Array<"private" | "group">;
  /** У MAX нет отдельного события «разрешил писать»: оно приходит как начало разговора. */
  readonly allowedArrivesAsStart: boolean;
  readonly typing: string[];
  /** Мессенджер откажет в следующем голосовом (но примет звук файлом). */
  rejectNextVoice(): void;
  close(): Promise<void>;
}

export const anna: Person = { id: "100", name: "Анна Петрова", username: "anna" };
export const boris: Person = { id: "200", name: "Борис" };

/** Ogg с Opus: страница с `OpusHead` и страница данных, у которой позиция — длина в отсчётах 48 кГц. Контрольные суммы поддельные. */
export function oggOpusBytes(durationMs = 1000): Uint8Array {
  const page = (granule: bigint, flags: number, sequence: number, payload: Uint8Array) => {
    const bytes = new Uint8Array(28 + payload.length);
    bytes.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
    new DataView(bytes.buffer).setBigInt64(6, granule, true);
    new DataView(bytes.buffer).setUint32(18, sequence, true);
    bytes[26] = 1;
    bytes[27] = payload.length;
    bytes.set(payload, 28);
    return bytes;
  };
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  const first = page(0n, 0x02, 0, head);
  const second = page(BigInt(Math.round(durationMs * 48)), 0x04, 1, new Uint8Array(40).fill(7));
  return new Uint8Array([...first, ...second]);
}

/** Звук — Ogg с `OpusHead`: так сервер отличает голосовое от обычного файла. */
export function isOggOpus(bytes: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 64));
  return text.startsWith("OggS") && text.includes("OpusHead");
}

export interface RawRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Buffer;
  /** Тело как JSON; не JSON — `undefined`. */
  json: unknown;
  /** Тело как форма (multipart или urlencoded); иначе `undefined`. */
  form(): Promise<FormData | undefined>;
}

export interface RawResponse {
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

/** Поддельный сервер на `node:http`: обработчик получает разобранный запрос и отвечает данными, а не потоком. */
export async function listen(handler: (request: RawRequest) => RawResponse | Promise<RawResponse>) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://fake");
      let json: unknown;
      try {
        json = body.length > 0 ? JSON.parse(body.toString("utf8")) : undefined;
      } catch {
        json = undefined;
      }
      const contentType = req.headers["content-type"] ?? "";
      const request: RawRequest = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
        json,
        async form() {
          if (/multipart\/form-data|application\/x-www-form-urlencoded/.test(contentType)) {
            return new Response(body, { headers: { "content-type": contentType } }).formData();
          }
          return undefined;
        },
      };
      try {
        const answer = await handler(request);
        // `connection: close`: клиент не держит соединение открытым, и поддельные часы не рвут «простаивающее» соединение между повторами.
        const headers = { connection: "close", ...(answer.json !== undefined && { "content-type": "application/json" }), ...answer.headers };
        res.writeHead(answer.status ?? 200, headers);
        res.end(answer.bytes ? Buffer.from(answer.bytes) : answer.json !== undefined ? JSON.stringify(answer.json) : (answer.text ?? ""));
      } catch (error) {
        res.writeHead(500);
        res.end(String(error));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Собрать обновления опроса: читает адаптер, пока их не станет `count`, потом останавливает опрос. */
export async function collectPolled(adapter: MessengerAdapter, count: number): Promise<InboundUpdate[]> {
  const controller = new AbortController();
  const updates: InboundUpdate[] = [];
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    for await (const update of adapter.poll(controller.signal)) {
      updates.push(update);
      if (updates.length >= count) break;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return updates;
}

export const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));
