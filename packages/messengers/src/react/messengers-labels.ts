import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { MessengerName } from "../messenger-adapter";

/** Надписи панели мессенджеров. */
export interface MessengersLabels {
  title: string;
  /** Названия мессенджеров для людей. */
  messengerNames: Record<MessengerName, string>;
  connect: string;
  disconnect: string;
  connected: string;
  /** «Подключено: Анна (@anna)». */
  connectedAs: (name: string, username?: string) => string;
  /** Подсказка рядом со ссылкой: что сделать в мессенджере. */
  openLinkHint: string;
  openLink: string;
  /** «Код: 4F7K». */
  codeLabel: (code: string) => string;
  /** Срок кода: «до 12:35». */
  expiresAt: (time: string) => string;
  loading: string;
  failed: string;
  retry: string;
}

export const russianMessengersLabels: MessengersLabels = {
  title: "Мессенджеры",
  messengerNames: { telegram: "Telegram", vk: "ВКонтакте", max: "MAX" },
  connect: "Подключить",
  disconnect: "Отвязать",
  connected: "Подключено",
  connectedAs: (name, username) => (username ? `Подключено: ${name} (@${username})` : `Подключено: ${name}`),
  openLinkHint: "Откройте ссылку в мессенджере и нажмите «Начать»",
  openLink: "Открыть в мессенджере",
  codeLabel: (code) => `Код: ${code}`,
  expiresAt: (time) => `до ${time}`,
  loading: "Загружаем…",
  failed: "Не получилось. Попробуйте ещё раз",
  retry: "Повторить",
};

export const englishMessengersLabels: MessengersLabels = {
  title: "Messengers",
  messengerNames: { telegram: "Telegram", vk: "VK", max: "MAX" },
  connect: "Connect",
  disconnect: "Disconnect",
  connected: "Connected",
  connectedAs: (name, username) => (username ? `Connected: ${name} (@${username})` : `Connected: ${name}`),
  openLinkHint: "Open the link in the messenger and press “Start”",
  openLink: "Open in the messenger",
  codeLabel: (code) => `Code: ${code}`,
  expiresAt: (time) => `until ${time}`,
  loading: "Loading…",
  failed: "That did not work. Try again",
  retry: "Retry",
};

const MessengersLabelsContext = createContext<MessengersLabels>(russianMessengersLabels);

/** Свой словарь панели мессенджеров; без провайдера — русский. */
export function MessengersLabelsProvider({ labels, children }: { labels: MessengersLabels; children?: ReactNode }) {
  return createElement(MessengersLabelsContext.Provider, { value: labels }, children);
}

export function useMessengersLabels(): MessengersLabels {
  return useContext(MessengersLabelsContext);
}
