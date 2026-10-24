import type { LookupAddress, LookupOptions } from "node:dns";
import { isIP } from "node:net";
import type { Agent, buildConnector } from "undici";
import { checkedAddresses } from "./page-address";
import type { HostResolver } from "./page-address";
import { WebToolError } from "./web-tool-error";

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * Разрешение имени в момент соединения: тот же ответ DNS и проверяется, и идёт в соединение. Между проверкой и
 * соединением нет второго запроса DNS — подмена ответа (DNS rebinding) во внутреннюю сеть не пустит.
 * Договор тот же, что у `lookup` из `node:net`: `all: true` — все адреса списком, иначе первый. Частный адрес среди
 * ответов — отказ в обоих режимах. Отказ — `WebToolError` вида `bad_address`.
 */
export function checkedLookup(resolveHost: HostResolver, allowPrivateNetwork: boolean) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    checkedAddresses(hostname, resolveHost, allowPrivateNetwork).then(
      (addresses) => {
        const all = addresses.map((address) => ({ address, family: isIP(address) || 4 }));
        if (options.all) callback(null, all);
        else callback(null, all[0]!.address, all[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, []),
    );
  };
}

/**
 * Каждое соединение — и по первому адресу, и после переадресации — проходит проверку. Имя проверяет `checkedLookup`;
 * адрес-число (`127.0.0.1`, `[::1]`) Node соединяет без разрешения имени, поэтому его проверка — здесь, той же
 * `checkedAddresses`.
 */
function checkedConnector(connector: buildConnector.connector, options: { allowPrivateNetwork: boolean }): buildConnector.connector {
  return (connectOptions, callback) => {
    const host = connectOptions.hostname.replace(/^\[|\]$/g, "");
    if (!isIP(host)) return connector(connectOptions, callback);
    checkedAddresses(host, async () => [host], options.allowPrivateNetwork).then(
      () => connector(connectOptions, callback),
      (error: Error) => callback(error, null),
    );
  };
}

/** Закреплённый `fetch` и закрытие его соединений. */
export interface PinnedFetch {
  fetch: typeof globalThis.fetch;
  close(): Promise<void>;
}

/** Отказ проверки адреса в цепочке причин: undici прячет его в общий «fetch failed». */
function findAddressRefusal(error: unknown): WebToolError | undefined {
  for (let current = error, depth = 0; current && depth < 8; depth++) {
    if (current instanceof WebToolError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * `fetch` только для сервера, который сам ходит по адресам извне (снимки, картинки провайдера, серверы MCP): имя
 * разрешается и проверяется в момент соединения (`checkedLookup`), соединение идёт на проверенный адрес. Адрес-число
 * проверяется там же, при соединении, — и в первом адресе, и после переадресации (`redirect` по умолчанию `follow`).
 * Без `allowPrivateNetwork` во внутреннюю сеть он не ходит. Отдельная проверка DNS перед запросом ему не нужна; схему,
 * логин в адресе и имена вроде `localhost` без точки проверяет `assertPublicWebAddress` вызывающего. Отказ —
 * `WebToolError` вида `bad_address`, остальное — как у `fetch`.
 * Пакет undici подгружается при первом запросе; соединения общие на все запросы, `close` их закрывает.
 */
export function createPinnedFetch(options: { resolveHost: HostResolver; allowPrivateNetwork: boolean }): PinnedFetch {
  let undici: Promise<{ agent: Agent; fetch: typeof import("undici").fetch }> | undefined;
  let closed = false;
  const connect = () =>
    (undici ??= import("undici").then(({ Agent, buildConnector, fetch }) => ({
      agent: new Agent({
        connect: checkedConnector(buildConnector({ lookup: checkedLookup(options.resolveHost, options.allowPrivateNetwork) as never }), options),
      }),
      fetch,
    })));

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (closed) throw new TypeError("fetch failed: соединения закрыты");
    const { agent, fetch: undiciFetch } = await connect();
    try {
      return (await undiciFetch(input as never, { ...(init as object), dispatcher: agent } as never)) as unknown as Response;
    } catch (error) {
      throw findAddressRefusal(error) ?? error;
    }
  };
  return {
    fetch,
    async close() {
      closed = true;
      if (undici) await (await undici).agent.close();
    },
  };
}

const shared = new WeakMap<HostResolver, PinnedFetch>();

/**
 * Общий на процесс закреплённый `fetch` без частных адресов для этого разрешателя имён: снимки и картинки делят одни
 * соединения, а не открывают свои на каждое скачивание. Живёт до конца процесса; простаивающие соединения процесс не держат.
 */
export function sharedPinnedFetch(resolveHost: HostResolver): typeof globalThis.fetch {
  let pinned = shared.get(resolveHost);
  if (!pinned) {
    pinned = createPinnedFetch({ resolveHost, allowPrivateNetwork: false });
    shared.set(resolveHost, pinned);
  }
  return pinned.fetch;
}
