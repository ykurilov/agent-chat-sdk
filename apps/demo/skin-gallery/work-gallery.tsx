import { TooltipProvider } from "@tandem/ui";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { AgentNoticeViewProps, HelperCallView, TaskCardView, TaskStatusView } from "@ykurilov/agent-chat-react";
import { tandemSkin, tandemWorkParts } from "@ykurilov/agent-chat-skin-tandem";
import { tandemMessengersSkin } from "@ykurilov/agent-chat-skin-tandem/messengers";
import { StrictMode, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина частей фона и мессенджеров скина Тандем (T023 плана 027) для снимков тем: строка помощника во всех состояниях,
 * карточка фоновой задачи во всех статусах, плашки служебных сообщений, реплика сотрудника (0.53), панель подключения
 * мессенджеров, служебная строка пометки приложения (0.65, «Агент написал первым»). Без сервера.
 *   theme=light|dark
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const noop = () => undefined;
const { HelperCallRow, TaskCard, AgentNoticeView } = tandemWorkParts;
const { MessengerConnectPanel } = tandemMessengersSkin;

const steps: HelperCallView["steps"] = [
  { kind: "tool", id: "s1", toolName: "web_search", title: "Поиск в интернете", state: "done", input: { query: "туры в Грецию октябрь" }, output: "Найдено 12 статей" },
  { kind: "text", id: "s2", text: "Нашёл три подходящих статьи, читаю подробнее." },
  { kind: "tool", id: "s3", toolName: "read_page", title: "Чтение страницы", state: "running", input: { url: "https://example.com/greece" } },
];

const helperCalls: Array<{ caption: string; view: Omit<HelperCallView, "open" | "onOpenChange">; open?: boolean }> = [
  { caption: "Работает, раскрыта", view: { name: "researcher", title: "Исследователь", task: "Найди отзывы о турах в Грецию в октябре", steps, text: "Пока нашёл три статьи…", status: "running" }, open: true },
  {
    caption: "Ждёт подтверждения",
    view: {
      name: "cleaner",
      title: "Уборщик заметок",
      task: "Удали дубли в заметках",
      steps: [],
      text: "",
      status: "awaiting_approval",
      approval: { state: "requested", onDecide: noop, pending: false, failed: false, canAlways: true },
    },
  },
  { caption: "Готово", view: { name: "researcher", title: "Исследователь", task: "Найди отзывы", steps: steps.slice(0, 2), text: "Лучшие отзывы — у туров на Крит: тёплое море и мало людей.", status: "done" } },
  { caption: "Сбой", view: { name: "translator", task: "Переведи договор", steps: [], text: "", status: "failed", errorText: "Модель недоступна, попробуйте позже" } },
  { caption: "Ушёл в фон", view: { name: "researcher", title: "Исследователь", task: "Собери отчёт по рынку за год", steps: [], text: "", status: "background" } },
];

function HelperCall({ view, open: initiallyOpen = false }: { view: Omit<HelperCallView, "open" | "onOpenChange">; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <HelperCallRow {...view} open={open} onOpenChange={setOpen} />;
}

const taskStatuses: TaskStatusView[] = ["queued", "running", "awaiting_approval", "done", "failed", "canceled", "interrupted", "timed_out"];
const live = new Set<TaskStatusView>(["queued", "running", "awaiting_approval"]);
const tasks: TaskCardView[] = [
  ...taskStatuses.map((status, index) => ({
    id: `t-${status}`,
    title: "Отчёт по сделкам за квартал",
    status,
    elapsedMs: 65_000 + index * 37_000,
    ...(live.has(status) && { onCancel: noop }),
  })),
  { id: "t-canceling", title: "Отменяется: длинное название задачи, которое не помещается в одну строку на узком экране", status: "running", elapsedMs: 3_600_000, onCancel: noop, canceling: true },
];

const notices: AgentNoticeViewProps[] = [
  { kind: "task_done", title: "Отчёт по сделкам", result: "Три сделки закрыты, две ждут подписи.\nИтог: 1,2 млн ₽." },
  { kind: "task_failed", title: "Сводка по почте", errorText: "Модель недоступна" },
  { kind: "task_canceled", title: "Перевод договора" },
  { kind: "task_interrupted", title: "Чистка заметок" },
  { kind: "task_timed_out", title: "Поиск по архиву" },
  { kind: "task_awaiting_approval", title: "Удалить 14 заметок", approval: { state: "requested", onDecide: noop, pending: false, failed: false, canAlways: false } },
  { kind: "task_awaiting_approval", title: "Удалить 14 заметок", approval: { state: "allowed" } },
  { kind: "conversation_started", title: "" },
];

/**
 * Реплика живого сотрудника (договор скина 25): свой `StaffMessage` скина, без него — запасной вид `AgentChat`: ответ
 * агента с подписью «Сотрудник Ольга». Тандем `StaffMessage` пока не рисует.
 */
function StaffReply({ text, staffName }: { text: string; staffName?: string }) {
  const View = tandemSkin.StaffMessage;
  if (View) return <View text={text} {...(staffName && { staffName })} />;
  return (
    <tandemSkin.AgentMessage status="complete" empty={false} onCopy={noop}>
      <tandemSkin.AgentText markdown={`**${russianLabels.notices.staffSaid(staffName)}:** ${text}`} streaming={false} />
    </tandemSkin.AgentMessage>
  );
}

type MessengerRows = ComponentProps<typeof MessengerConnectPanel>["rows"];
const row = (messenger: MessengerRows[number]["messenger"], extra: Partial<MessengerRows[number]> = {}): MessengerRows[number] => ({
  messenger,
  connected: null,
  busy: false,
  failed: false,
  onConnect: noop,
  onDisconnect: noop,
  ...extra,
});
const messengerRows: MessengerRows = [
  row("telegram", { connected: { name: "Анна", username: "anna_k" } }),
  row("vk", { offer: { url: "https://vk.me/club1?ref=K7F2", code: "K7F2-9QZX-LM3P-WW81-TA", expiresAt: "до 12:35" } }),
  row("max", { failed: true }),
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase text-[var(--foreground-muted)]">{title}</h2>
      {children}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 bg-[var(--canvas)] p-3 pb-6 text-[var(--foreground)]">
        <Section title="Строка помощника">
          {helperCalls.map(({ caption, view, open }) => (
            <div key={caption} data-gallery={`helper-${view.status}`} className="space-y-1">
              <p className="text-xs text-[var(--foreground-subtle)]">{caption}</p>
              <HelperCall view={view} {...(open && { open })} />
            </div>
          ))}
        </Section>
        <Section title="Фоновые задачи">
          <div className="flex flex-col gap-2">{tasks.map((task) => <TaskCard key={task.id} {...task} />)}</div>
        </Section>
        <Section title="Служебные сообщения">
          <div className="flex flex-col gap-2">{notices.map((notice, index) => <AgentNoticeView key={index} {...notice} />)}</div>
        </Section>
        <Section title="Реплика сотрудника">
          <div data-gallery="staff-reply" className="flex flex-col gap-2">
            <StaffReply staffName="Ольга" text="Здравствуйте! Запись эфира пришлю сегодня вечером, а пока посмотрите урок про композицию." />
            <StaffReply text="Подключила вас к закрытому чату курса." />
          </div>
        </Section>
        <Section title="Пометки приложения">
          <div data-gallery="service-lines" className="flex flex-col gap-2">
            <tandemSkin.UserMessage text="Хочу научиться рисовать акварелью, но не знаю, с чего начать" />
            <tandemSkin.AgentMessage status="complete" empty={false} onCopy={noop}>
              <tandemSkin.AgentText markdown="Отлично! Расскажите, что у вас уже есть: краски, кисти, бумага?" streaming={false} />
            </tandemSkin.AgentMessage>
            {tandemSkin.ServiceLine && <tandemSkin.ServiceLine text="Агент написал первым — человек молчал 1 ч 7 мин" />}
            <tandemSkin.AgentMessage status="complete" empty={false} onCopy={noop}>
              <tandemSkin.AgentText markdown="Начнём с самого простого: возьмите один цвет и попробуйте залить квадрат ровным слоем." streaming={false} />
            </tandemSkin.AgentMessage>
            {tandemSkin.ServiceLine && (
              <tandemSkin.ServiceLine text="Агент написал первым — срок шага вышел (шаг длился 2 д) → «Практика», утро нового дня, человек молчал 14 ч 20 мин" />
            )}
            <tandemSkin.AgentMessage status="complete" empty={false} onCopy={noop}>
              <tandemSkin.AgentText markdown="Доброе утро! Сегодня — первое практическое задание." streaming={false} />
            </tandemSkin.AgentMessage>
          </div>
        </Section>
        <Section title="Мессенджеры">
          <MessengerConnectPanel state="ready" rows={messengerRows} onRetry={noop} />
          <MessengerConnectPanel state="loading" rows={[]} onRetry={noop} />
          <MessengerConnectPanel state="failed" rows={[]} onRetry={noop} />
        </Section>
      </main>
    </TooltipProvider>
  </StrictMode>,
);
