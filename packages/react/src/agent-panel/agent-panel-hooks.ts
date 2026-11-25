import { useCallback, useEffect, useRef, useState } from "react";
import type { RefCallback } from "react";
import type { AppDataChange, ScreenPlace } from "../app-bridge/app-bridge";
import { useAppBridgeControl, usePanelControls, usePanelView } from "./panel-context";
import type { AgentPanelControls } from "./panel-context";

export type { AgentPanelControls } from "./panel-context";

/** Управление панелью из кода приложения: открыть, закрыть, открыть чат, новый чат с готовым текстом, отступ для `push`. */
export function useAgentPanel(): AgentPanelControls {
  return usePanelControls("useAgentPanel");
}

/** Что разложить на свою кнопку вызова панели: `<button {...useAgentPanelLauncher()}>`. */
export interface AgentPanelLauncherProps {
  ref: RefCallback<HTMLElement>;
  type: "button";
  "aria-expanded": boolean;
  onClick: () => void;
}

/**
 * Своя кнопка вызова панели в любом месте страницы: открывает и закрывает панель, а после закрытия панели фокус
 * возвращается на неё, если открыли ею (открыли из кода, а элемента, бывшего в фокусе, уже не видно, — на последнюю нажатую из своих кнопок). Встроенную плавающую кнопку убирает `<AgentPanel launcher={false} />`.
 */
export function useAgentPanelLauncher(): AgentPanelLauncherProps {
  const { controls, launchers } = usePanelView("useAgentPanelLauncher");
  const button = useRef<HTMLElement | null>(null);
  const removal = useRef<(() => void) | null>(null);
  const ref = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      removal.current?.();
      removal.current = null;
      button.current = element;
      if (element) removal.current = launchers.add(element);
    },
    [launchers],
  );
  const { open, setOpen } = controls;
  const onClick = useCallback(() => {
    if (!open && button.current) launchers.pressed(button.current);
    setOpen(!open);
  }, [launchers, open, setOpen]);
  return { ref, type: "button", "aria-expanded": open, onClick };
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
