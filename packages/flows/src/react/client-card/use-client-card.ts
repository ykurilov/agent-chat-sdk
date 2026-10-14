import { useCallback, useEffect, useRef, useState } from "react";
import { isFieldStale } from "../../engine/side-questions";
import type { ClientCardField } from "../../format/flow-format";
import { fieldValueText } from "../../prompt/client-card-block";
import { FACT_PREFIX } from "../../runtime/client-facts";
import type { ClientCardEntry } from "../../store/flow-store";
import { useFlowLabels } from "../flow-labels";
import type { ClientCardFieldView, ClientCardLoadState, ClientCardPanelProps } from "../client-card-skin";

export interface UseClientCardOptions {
  /** Поля карточки сценариев приложения: порядок = что важнее, имена видит человек. Чужих полей здесь может не быть — их покажет `id`. */
  fields: Array<Pick<ClientCardField, "id" | "name" | "refreshAfterMonths">>;
  /** Карточка человека с сервера: `flow.readClientCard(ownerId)` за HTTP-ручкой приложения. */
  read(): Promise<ClientCardEntry[]>;
  /** Стереть поле или `"all"`: `flow.forgetClientCard(ownerId, fieldId)`. */
  forget(fieldId: string | "all"): Promise<void>;
  /** Как назвать свободный факт о человеке («ведёт блог») в списке; по умолчанию — `useFlowLabels().clientCard.fact`. */
  factName?: string;
  /** Часы; для тестов. */
  now?: () => number;
  /** Пояс для даты записи; нет — пояс браузера. */
  timeZone?: string;
}

/** Слой поведения экрана карточки: грузит, готовит строки для скина, стирает поле или всё. Скин только рисует. */
export function useClientCard(options: UseClientCardOptions): ClientCardPanelProps {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<ClientCardLoadState>("loading");
  const [entries, setEntries] = useState<ClientCardEntry[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [forgettingAll, setForgettingAll] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const loaded = await latest.current.read();
      if (!alive.current) return;
      setEntries(loaded);
      setState("ready");
    } catch {
      if (alive.current) setState("failed");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const forgetField = async (fieldId: string) => {
    setBusy((current) => new Set(current).add(fieldId));
    try {
      await latest.current.forget(fieldId);
      if (alive.current) setEntries((current) => current.filter((entry) => entry.fieldId !== fieldId));
    } catch {
      if (alive.current) setState("failed");
    } finally {
      if (alive.current)
        setBusy((current) => {
          const next = new Set(current);
          next.delete(fieldId);
          return next;
        });
    }
  };

  const forgetAll = async () => {
    setForgettingAll(true);
    try {
      await latest.current.forget("all");
      if (alive.current) setEntries([]);
    } catch {
      if (alive.current) setState("failed");
    } finally {
      if (alive.current) setForgettingAll(false);
    }
  };

  const labels = useFlowLabels().clientCard;
  const { fields, now = Date.now, timeZone, factName = labels.fact } = options;
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", ...(timeZone && { timeZone }) });
  const position = (fieldId: string) => {
    const index = fields.findIndex((field) => field.id === fieldId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const views: ClientCardFieldView[] = [...entries]
    .sort((left, right) => position(left.fieldId) - position(right.fieldId) || left.fieldId.localeCompare(right.fieldId))
    .map((entry) => {
      const field = fields.find((item) => item.id === entry.fieldId);
      const updatedAt = Date.parse(entry.updatedAt);
      return {
        fieldId: entry.fieldId,
        name: field?.name ?? (entry.fieldId.startsWith(FACT_PREFIX) ? factName : entry.fieldId),
        value: fieldValueText(entry.value),
        updatedAt: dateFormat.format(updatedAt),
        stale: field ? isFieldStale(field, updatedAt, now()) : false,
        busy: busy.has(entry.fieldId),
        onForget: () => void forgetField(entry.fieldId),
      };
    });

  return { state, fields: views, forgettingAll, onForgetAll: () => void forgetAll(), onRetry: () => void load() };
}
