import { useEffect, useRef, useState } from "react";
import type { AppDataChange, ScreenPlace } from "../app-bridge/app-bridge";
import { useAppBridgeControl, usePanelControls } from "./panel-context";
import type { AgentPanelControls } from "./panel-context";

export type { AgentPanelControls } from "./panel-context";

/** Управление панелью из кода приложения: открыть, закрыть, открыть чат, новый чат с готовым текстом, отступ для `push`. */
export function useAgentPanel(): AgentPanelControls {
  return usePanelControls("useAgentPanel");
}

/**
 * Где сейчас человек: место уходит с каждым запросом хода, пока компонент на экране. Главнее место компонента, который
 * появился на экране позже; вложенный всегда главнее внешнего (страница главнее макета, в котором стоит), и при первом
 * показе, и после переходов. Смена места не меняет, чьё главнее. `null` или размонтирование снимает только это место —
 * снова действует место другого компонента.
 */
export function useAgentPlace(place: ScreenPlace | null): void {
  const control = useAppBridgeControl("useAgentPlace");
  const [owner] = useState(() => control.createPlaceOwner());
  const latest = useRef(place);
  latest.current = place;
  const placeKey = place === null ? null : placeIdentity(place);
  useEffect(() => {
    control.setPlace(owner, latest.current);
  }, [control, owner, placeKey]);
  useEffect(() => () => control.removePlace(owner), [control, owner]);
}

/** Ключ места для зависимостей эффекта. `data` не превращается в JSON (цикл, BigInt) — ключ без неё: при отправке её отбросят. */
function placeIdentity(place: ScreenPlace): string {
  try {
    return JSON.stringify(place);
  } catch {
    return JSON.stringify({ description: place.description });
  }
}

/** Подписка на изменения данных по метке (или списку меток). Подписчик зовётся один раз на сообщение, всегда свежий. */
export function useAgentDataChanges(tag: string | readonly string[], handler: (change: AppDataChange) => void): void {
  const control = useAppBridgeControl("useAgentDataChanges");
  const latest = useRef(handler);
  latest.current = handler;
  const tagsKey = JSON.stringify(typeof tag === "string" ? [tag] : tag);
  useEffect(() => control.subscribe(JSON.parse(tagsKey) as string[], (change) => latest.current(change)), [control, tagsKey]);
}
