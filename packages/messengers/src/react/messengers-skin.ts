import type { ComponentType } from "react";
import type { MessengerName } from "../messenger-adapter";

/** Что со списком мессенджеров: грузится, готов, не загрузился (тогда `onRetry`). */
export type MessengersLoadState = "loading" | "ready" | "failed";

/** Ссылка для привязки: человек открывает её в мессенджере и нажимает «Начать». */
export interface MessengerLinkOffer {
  url: string;
  code: string;
  /** Когда код перестанет действовать, готовой надписью («до 12:35»). */
  expiresAt: string;
}

/** Один мессенджер в панели «Подключить мессенджер». */
export interface MessengerConnectRowView {
  messenger: MessengerName;
  /** Подключён ли аккаунт; `name` — как человек записан в мессенджере. */
  connected: { name: string; username?: string } | null;
  /** Ссылка с кодом, пока человек подключает. */
  offer?: MessengerLinkOffer;
  /** Идёт запрос на сервер: кнопку сделать занятой. */
  busy: boolean;
  /** Запрос не удался: показать `labels.failed`. */
  failed: boolean;
  onConnect(): void;
  onDisconnect(): void;
}

/** Панель подключения мессенджеров: «Подключить», ссылка с кодом, «Подключено», «Отвязать». */
export interface MessengerConnectPanelProps {
  state: MessengersLoadState;
  rows: MessengerConnectRowView[];
  onRetry(): void;
}

/**
 * Договор скина мессенджеров, версия 1. Слой поведения (`useMessengerLinks`, этап 2) собирает панель только из этой
 * части и ничего своего не рисует. Надписи компонент берёт из `useMessengersLabels()`.
 */
export interface MessengersSkin {
  MessengerConnectPanel: ComponentType<MessengerConnectPanelProps>;
}
