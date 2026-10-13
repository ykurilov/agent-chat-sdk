import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessengerName } from "../messenger-adapter";
import { useMessengersLabels } from "./messengers-labels";
import type { MessengerConnectPanelProps, MessengerConnectRowView, MessengersLoadState, MessengersSkin } from "./messengers-skin";

type LinksFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface MessengerLinksOptions {
  /** Адрес пакета мессенджеров (`basePath`), без `/links` на конце. */
  url: string;
  fetch?: LinksFetch;
  /** Как часто перечитывать привязки, пока у человека открыта ссылка с кодом. */
  pollMs?: number;
}

/** Ответ `GET /links`: какие мессенджеры подключены к приложению и какие из них привязал этот пользователь. */
interface LinksAnswer {
  messengers: MessengerName[];
  links: Array<{ messenger: MessengerName; name: string; username?: string }>;
}

interface OpenOffer {
  url: string;
  code: string;
  expiresAtMs: number;
}

type Connected = NonNullable<MessengerConnectRowView["connected"]>;

const DEFAULT_POLL_MS = 3_000;
const pad = (value: number) => String(value).padStart(2, "0");
const clockTime = (ms: number) => {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const without = <T,>(record: Partial<Record<MessengerName, T>>, messenger: MessengerName) => {
  const next = { ...record };
  delete next[messenger];
  return next;
};
const toggled = (set: ReadonlySet<MessengerName>, messenger: MessengerName, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(messenger);
  else next.delete(messenger);
  return next;
};

/**
 * Привязка мессенджеров к пользователю приложения: `GET`, `POST`, `DELETE {url}/links`. Отдаёт готовые данные панели
 * `MessengerConnectPanel`. Пока открыта ссылка с кодом, привязки перечитываются: человек нажал «Начать» — строка
 * становится «Подключено», срок кода вышел — ссылка пропадает.
 */
export function useMessengerLinks({ url, fetch: fetchLinks = (...args) => globalThis.fetch(...args), pollMs = DEFAULT_POLL_MS }: MessengerLinksOptions): MessengerConnectPanelProps {
  const labels = useMessengersLabels();
  const fetchRef = useRef(fetchLinks);
  fetchRef.current = fetchLinks;
  const alive = useRef(true);
  const [state, setState] = useState<MessengersLoadState>("loading");
  const [messengers, setMessengers] = useState<MessengerName[]>([]);
  const [connected, setConnected] = useState<Partial<Record<MessengerName, Connected>>>({});
  const [offers, setOffers] = useState<Partial<Record<MessengerName, OpenOffer>>>({});
  const [busy, setBusy] = useState<ReadonlySet<MessengerName>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<MessengerName>>(new Set());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Перечитать привязки; `true` — получилось. Ссылки уже привязанных мессенджеров убираются. */
  const read = useCallback(async () => {
    try {
      const response = await fetchRef.current(`${url}/links`);
      if (!response.ok) return false;
      const answer = (await response.json()) as LinksAnswer;
      if (!alive.current) return true;
      const linked: Partial<Record<MessengerName, Connected>> = {};
      for (const link of answer.links) linked[link.messenger] = link.username ? { name: link.name, username: link.username } : { name: link.name };
      setMessengers(answer.messengers);
      setConnected(linked);
      setOffers((current) => {
        const open = Object.keys(current).filter((messenger) => !linked[messenger as MessengerName]);
        return open.length === Object.keys(current).length ? current : Object.fromEntries(open.map((messenger) => [messenger, current[messenger as MessengerName]]));
      });
      return true;
    } catch {
      return false;
    }
  }, [url]);

  const load = useCallback(async () => {
    setState("loading");
    const ok = await read();
    if (alive.current) setState(ok ? "ready" : "failed");
  }, [read]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasOffer = Object.keys(offers).length > 0;
  useEffect(() => {
    if (!hasOffer) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setOffers((current) => {
        const open = Object.entries(current).filter(([, offer]) => offer!.expiresAtMs > now);
        return open.length === Object.keys(current).length ? current : Object.fromEntries(open);
      });
      void read();
    }, pollMs);
    return () => clearInterval(timer);
  }, [hasOffer, pollMs, read]);

  /** Запрос строки: занятость на время запроса, ошибка — у этой строки. */
  const act = useCallback(async (messenger: MessengerName, request: () => Promise<boolean>) => {
    setBusy((current) => toggled(current, messenger, true));
    setFailed((current) => toggled(current, messenger, false));
    let ok = false;
    try {
      ok = await request();
    } catch {
      ok = false;
    }
    if (!alive.current) return;
    setBusy((current) => toggled(current, messenger, false));
    if (!ok) setFailed((current) => toggled(current, messenger, true));
  }, []);

  const connect = useCallback(
    (messenger: MessengerName) =>
      act(messenger, async () => {
        const response = await fetchRef.current(`${url}/links`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messenger }),
        });
        if (!response.ok) return false;
        const offer = (await response.json()) as { url: string; code: string; expiresAt: string };
        if (alive.current) setOffers((current) => ({ ...current, [messenger]: { url: offer.url, code: offer.code, expiresAtMs: Date.parse(offer.expiresAt) } }));
        return true;
      }),
    [act, url],
  );

  const disconnect = useCallback(
    (messenger: MessengerName) =>
      act(messenger, async () => {
        const response = await fetchRef.current(`${url}/links/${encodeURIComponent(messenger)}`, { method: "DELETE" });
        if (!response.ok) return false;
        if (alive.current) {
          setConnected((current) => without(current, messenger));
          setOffers((current) => without(current, messenger));
        }
        return true;
      }),
    [act, url],
  );

  const rows = useMemo(
    () =>
      messengers.map((messenger): MessengerConnectRowView => {
        const offer = connected[messenger] ? undefined : offers[messenger];
        return {
          messenger,
          connected: connected[messenger] ?? null,
          ...(offer && { offer: { url: offer.url, code: offer.code, expiresAt: labels.expiresAt(clockTime(offer.expiresAtMs)) } }),
          busy: busy.has(messenger),
          failed: failed.has(messenger),
          onConnect: () => void connect(messenger),
          onDisconnect: () => void disconnect(messenger),
        };
      }),
    [messengers, connected, offers, busy, failed, labels, connect, disconnect],
  );

  return { state, rows, onRetry: () => void load() };
}

export interface MessengerConnectProps extends MessengerLinksOptions {
  skin: MessengersSkin;
}

/** Панель «Подключить мессенджер»: данные из `useMessengerLinks`, вид — из скина. */
export function MessengerConnect({ skin, ...options }: MessengerConnectProps) {
  return createElement(skin.MessengerConnectPanel, useMessengerLinks(options));
}
