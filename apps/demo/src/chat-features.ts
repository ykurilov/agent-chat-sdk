import { russianLabels } from "@ykurilov/agent-chat-react";
import type { MessageAction, StepPhrases } from "@ykurilov/agent-chat-react";
import { Heart } from "lucide-react";
import { createElement } from "react";
import { backgroundStepPhrases } from "@ykurilov/agent-chat-background/labels";
import { historySearchStepPhrases, withHistorySearchTitles } from "@ykurilov/agent-chat-history-search/labels";
import { memoryStepPhrases, withMemoryToolTitles } from "@ykurilov/agent-chat-memory/labels";
import { webToolStepPhrases, withWebToolTitles } from "@ykurilov/agent-chat-web-tools/labels";
import { pickSlot } from "../shared/demo-widgets";
import { PickSlotWidget } from "./pick-slot-widget";

/** Надписи чата: веб-инструменты и память названы по-русски («Поиск в интернете: готово», «Работа с памятью: готово»). */
export const demoLabels = withMemoryToolTitles(withHistorySearchTitles(withWebToolTitles(russianLabels)));

/** Город из часового пояса: `Asia/Tokyo` → «Токио». Незнакомый пояс — без города. */
const cities: Record<string, string> = { "Asia/Tokyo": "Токио", "Europe/Moscow": "Москве" };

/**
 * Фразы шагов простого вида: встроенные пакеты дают свои, демо — для своих инструментов. Вход бывает не всегда
 * (ещё пишется или скрыт правами), поэтому фраза без него тоже есть.
 */
export const demoStepPhrases: StepPhrases = {
  ...webToolStepPhrases,
  ...memoryStepPhrases,
  ...historySearchStepPhrases,
  ...backgroundStepPhrases,
  current_time: ({ input }) => {
    const zone = (input as { timeZone?: unknown } | undefined)?.timeZone;
    const city = typeof zone === "string" ? cities[zone] : undefined;
    return city ? { running: `Узнаю время в ${city}`, done: `Узнал время в ${city}` } : { running: "Узнаю время", done: "Узнал время" };
  },
  // Длинная фраза: на узком экране список шагов переносит её, а не растягивает пузырь.
  slow_check: { running: "Проверяю макет", done: "Проверил макет: кнопки, отступы, шрифты, тёмную тему, узкий экран и подписи на двух языках" },
  broken_lookup: { running: "Ищу справку", done: "Нашёл справку", failed: "Справочная не ответила" },
};

/** Свои виджеты страницы: имя из общего модуля с сервером → компонент. */
export const demoWidgets = { [pickSlot.name]: PickSlotWidget };

/**
 * Своя кнопка под законченным ответом агента. Демо отметки никуда не шлёт: копит id ответов в `window.demoLikedAnswers`,
 * их читает проверка в браузере. В приложении здесь был бы запрос к своему серверу.
 */
export const demoMessageActions: MessageAction[] = [
  {
    id: "like",
    label: "Нравится",
    icon: createElement(Heart, { "aria-hidden": true }),
    visible: ({ status }) => status === "complete",
    onRun: ({ messageId }) => {
      const page = window as unknown as { demoLikedAnswers?: string[] };
      (page.demoLikedAnswers ??= []).push(messageId);
    },
  },
];
