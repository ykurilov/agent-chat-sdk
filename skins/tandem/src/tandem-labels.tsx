import {
  englishTandemLabels,
  russianTandemLabels,
  TandemLabelsProvider,
} from "@tandem/ui";
import type { TandemLabelsOverrides } from "@tandem/ui";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

/** Словарь Тандема на языке словаря SDK; другой язык — ничего: надписи берутся у `TandemLabelsProvider` приложения. */
function tandemLabelsFor(locale: string | undefined): TandemLabelsOverrides {
  const language = (locale ?? "ru").split("-")[0];
  if (language === "en") return englishTandemLabels;
  if (language === "ru") return russianTandemLabels;
  return {};
}

/**
 * Надписи дизайн-системы Тандема из словаря SDK: язык — по `labels.locale`, а надписи, которые есть и в SDK (поле
 * ввода, «Отправить», «Стоп», копирование кода), — из словаря SDK, чтобы своя надпись приложения была видна и в Тандеме.
 * Словарь собирается только при смене этих строк: новый объект на каждый рендер сбрасывал бы «Скопировано» и прокрутку
 * таблиц, пока идёт ответ.
 */
export function TandemSkinLabels({ children }: { children: ReactNode }) {
  const {
    locale,
    composerPlaceholder,
    composerLabel,
    send,
    stop,
    copyCode,
    copied,
  } = useChatLabels();
  const labels = useMemo<TandemLabelsOverrides>(() => {
    const base = tandemLabelsFor(locale);
    return {
      ...base,
      composer: {
        ...base.composer,
        placeholder: composerPlaceholder,
        message: composerLabel,
        send,
        stop,
      },
      markdown: { ...base.markdown, copyCode, copied },
    };
  }, [
    locale,
    composerPlaceholder,
    composerLabel,
    send,
    stop,
    copyCode,
    copied,
  ]);
  return (
    <TandemLabelsProvider labels={labels}>{children}</TandemLabelsProvider>
  );
}
