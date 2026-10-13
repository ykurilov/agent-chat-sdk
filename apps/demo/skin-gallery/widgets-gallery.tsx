import { TandemAgentMessage, TandemSuggestedReplies, TandemWidget } from "@ykurilov/agent-chat-skin-tandem";
import { TooltipProvider } from "@tandem/ui";
import type { FormFieldView, WidgetView } from "@ykurilov/agent-chat-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина виджетов агента скина Тандем (этап 3 плана 024) для снимков экрана и проверки вёрстки: каждый виджет в трёх
 * состояниях — ждёт ответа, отвечен, ответ дан сообщением — и подсказки ответа. Без сервера и чата.
 *   theme=light|dark
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const noop = () => undefined;
const waiting = { toolCallId: "w", active: true, pending: false, answeredByMessage: false } as const;
const answered = { ...waiting, active: false } as const;
const byMessage = { ...answered, answeredByMessage: true } as const;

const options = ["Море", "Горы", "Город с длинным названием, которое не помещается в одну строку"];
const fields: FormFieldView[] = [
  { name: "name", label: "Имя", kind: "text", required: true },
  { name: "age", label: "Возраст", kind: "number", required: false, min: 18, max: 99 },
  { name: "day", label: "Дата поездки", kind: "date", required: true },
  { name: "plan", label: "Тариф", kind: "select", required: false, options: ["Старт", "Про"] },
  { name: "note", label: "Пожелания", kind: "text", required: false, multiline: true },
];

const sections: Array<{ title: string; views: WidgetView[] }> = [
  {
    title: "Один вариант",
    views: [
      { ...waiting, kind: "choice", question: "Куда поедем?", options, onChoose: noop },
      { ...answered, kind: "choice", question: "Куда поедем?", options, chosen: "Горы" },
      { ...byMessage, kind: "choice", question: "Куда поедем?", options },
    ],
  },
  {
    title: "Несколько вариантов",
    views: [
      { ...waiting, kind: "multi_choice", question: "Что взять?", options: ["Палатку", "Котелок", "Гитару"], min: 1, max: 2, onSubmit: noop },
      { ...answered, kind: "multi_choice", question: "Что взять?", options: ["Палатку", "Котелок", "Гитару"], min: 1, max: 2, chosen: ["Палатку", "Гитару"] },
      { ...byMessage, kind: "multi_choice", question: "Что взять?", options: ["Палатку", "Котелок", "Гитару"], min: 1, max: 2 },
    ],
  },
  {
    title: "Оценка",
    views: [
      { ...waiting, kind: "rating", question: "Как вам ответ?", scale: "stars", from: 1, to: 5, onRate: noop },
      { ...waiting, kind: "rating", question: "Порекомендуете нас?", scale: "range", from: 0, to: 10, fromLabel: "Точно нет", toLabel: "Точно да", onRate: noop },
      { ...answered, kind: "rating", question: "Как вам ответ?", scale: "stars", from: 1, to: 5, value: 4 },
      { ...byMessage, kind: "rating", question: "Как вам ответ?", scale: "stars", from: 1, to: 5 },
    ],
  },
  {
    title: "Форма",
    views: [
      { ...waiting, kind: "form", title: "Анкета", fields, onSubmit: noop },
      {
        ...waiting,
        kind: "form",
        title: "Анкета с ошибками",
        fields: fields.map((field) => (field.name === "age" ? { ...field, error: "Допустимо от 18 до 99" } : field.name === "day" ? { ...field, error: "Обязательное поле" } : field)),
        failure: "Ответ не отправился, попробуйте ещё раз",
        onSubmit: noop,
      },
      { ...answered, kind: "form", title: "Анкета", fields, values: { name: "Юля", age: 30, day: "2026-11-01", plan: "Про" } },
      { ...byMessage, kind: "form", title: "Анкета", fields },
    ],
  },
  {
    title: "Свой виджет без компонента",
    views: [{ ...waiting, kind: "custom", name: "pick_slot", question: "Когда вам удобно?" }],
  },
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 bg-[var(--canvas)] p-3 pb-6 text-[var(--foreground)]">
        {sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-xs font-medium uppercase text-[var(--foreground-muted)]">{section.title}</h2>
            {section.views.map((view, index) => (
              <TandemWidget key={index} {...view} toolCallId={`${section.title}-${index}`} />
            ))}
          </section>
        ))}
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase text-[var(--foreground-muted)]">Подсказки ответа</h2>
          <TandemAgentMessage status="complete" onCopy={noop} empty={false} notice={null}>
            <p>Могу подобрать отель у моря.</p>
            <TandemSuggestedReplies replies={["Да", "Расскажи подробнее", "Не надо, спасибо"]} onPick={noop} disabled={false} />
          </TandemAgentMessage>
        </section>
      </main>
    </TooltipProvider>
  </StrictMode>,
);
