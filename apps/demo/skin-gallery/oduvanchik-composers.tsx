import { TooltipProvider } from "@tandem/ui";
import { ChatLabelsProvider, russianLabels, useModelChoice } from "@ykurilov/agent-chat-react";
import type { ChatSkin, ComposerOptions } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin, oduvanchikWorkParts, OduvanchikSphere, OduvanchikReasoning } from "@ykurilov/agent-chat-skin-oduvanchik";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import "./oduvanchik-composers.css";

const variants = ["compact", "standard", "extended"] as const;
const names = { compact: "Сжатое", standard: "Обычное", extended: "Расширенное" };
const descriptions = { compact: "Одна строка: текст и отправка.", standard: "Файл, контекст и голос.", extended: "Модель, провайдер, рассуждения и инструменты." };
const theme = new URLSearchParams(location.search).get("theme") ?? "light";
document.documentElement.dataset.theme = theme;
const { Composer, AgentMessage, AgentText, UserMessage } = oduvanchikSkin;
const { WorkSteps } = oduvanchikWorkParts;
const noop = () => undefined;
const steps = [{ phrase: "Прочитал материалы проекта", failed: false, icon: "read" }, { phrase: "Нашёл прошлые письма", failed: false, icon: "search" }];
function Chat({ variant }: { variant: typeof variants[number] }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState("");
  const [stopped, setStopped] = useState(false);
  const [showThought, setShowThought] = useState(true);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [context, setContext] = useState("Мастерская");
  const [projects, setProjects] = useState<string[]>([]);
  const [tools, setTools] = useState([true, true, true]);
  const [files, setFiles] = useState<Array<{ id: string; name: string; kind: "image" | "file"; status: "ready" }>>([]);
  const [answerDetails, setAnswerDetails] = useState<ComponentProps<ChatSkin["AgentMessage"]>["modelDetails"]>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const choice = useModelChoice({ api: "/oduvanchik-catalog", chatId: variant, menuWanted: variant === "extended" });
  const options: ComposerOptions = {
    variant,
    ...(new URLSearchParams(location.search).get("reasoning") === "icon" && { reasoningChip: "icon" as const }),
    context: { label: context, onPick: () => setContext(context === "Мастерская" ? "Лендинг вебинара" : "Мастерская") },
    projects: [{ id: "webinar", label: "Лендинг вебинара", onPick: () => setProjects(["Лендинг вебинара"]) }],
    contextAttachments: projects.map((label) => ({ id: label, label, onRemove: () => setProjects((items) => items.filter((item) => item !== label)) })),
    reasoningVisibility: { value: showThought, onChange: setShowThought },
    tools: ["Поиск", "Файлы", "Проекты"].map((label, index) => ({ id: String(index), label, enabled: tools[index]!, onChange: (enabled) => setTools((items) => items.map((old, i) => i === index ? enabled : old)) })),
  };
  const send = () => {
    if (!value.trim() && !files.length && !projects.length) return;
    setRequest(value || [...files.map((file) => file.name), ...projects].join(", "));
    setValue(""); setFiles([]); setProjects([]); setBusy(true); setStopped(false); setWorkOpen(true);
    const provider = choice.providers.find((item) => item.id === choice.current.providerId);
    const model = provider?.models.find((item) => item.id === choice.current.modelId);
    setAnswerDetails(variant === "extended" ? { ...choice.current, ...(provider && { providerName: provider.name }), ...(model && { modelName: model.name }), ...(choice.reasoning && { reasoning: choice.reasoning }) } : undefined);
    clearTimeout(timer.current); timer.current = setTimeout(() => { setBusy(false); setWorkOpen(false); }, 1800);
  };
  const stop = () => { clearTimeout(timer.current); setBusy(false); setStopped(true); };
  return <section className="oduvanchik-composer-demo" data-variant={variant} aria-label={names[variant]}>
    <header><h2>{names[variant]}</h2><p>{descriptions[variant]}</p></header>
    <div className="oduvanchik-composer-thread">
      {!request ? <div className="oduvanchik-composer-empty"><OduvanchikSphere size={48} /><p>Напишите что-нибудь агенту</p></div> : <>
        <UserMessage text={request} />
        <AgentMessage status={busy ? "streaming" : stopped ? "stopped" : "complete"} empty={false} onCopy={noop} {...(answerDetails && { modelDetails: answerDetails })}>
          {busy ? <WorkSteps state="live" phrase="Пишу структуру писем…" icon="edit" completed={steps} /> : <>
            {variant === "extended" && showThought && <OduvanchikReasoning text="Изучил материалы проекта, выбрал последовательность писем и проверил сроки." streaming={false} durationMs={3000} open={thoughtOpen} onOpenChange={setThoughtOpen} />}
            <WorkSteps state="done" count={3} steps={steps} items={steps} icons={["read", "search", "edit"]} open={workOpen} onOpenChange={setWorkOpen} />
            <AgentText markdown={stopped ? "Работа остановлена." : "План рассылки:\n\n1. Анонс - за 7 дней\n2. Польза - за 3 дня\n3. Напоминание - в день эфира"} streaming={false} />
          </>}
        </AgentMessage>
      </>}
    </div>
    <Composer value={value} onValueChange={setValue} onSubmit={send} canSubmit={!!value.trim() || !!files.length || !!projects.length} busy={busy} onStop={stop}
      options={options} {...(variant === "extended" && { modelChoice: choice })}
      {...(variant !== "compact" && { voice: { state: recording ? "listening" as const : "idle" as const, onToggle: () => setRecording(!recording) }, attachments: { items: files, accept: "*/*", onAddFiles: (added: File[]) => setFiles((old) => [...old, ...added.map((file, i) => ({ id: `${Date.now()}-${i}`, name: file.name, kind: file.type.startsWith("image/") ? "image" as const : "file" as const, status: "ready" as const }))]), onRemove: (id: string) => setFiles((old) => old.filter((file) => file.id !== id)) } })} />
  </section>;
}
function Gallery() {
  const [active, setActive] = useState("extended");
  const [dark, setDark] = useState(theme === "dark");
  return <main className="oduvanchik-chat oduvanchik-composers-gallery" data-active={active}>
    <header className="oduvanchik-composers-head"><div><p className="oduvanchik-label">Одуванчик · Agent Chat</p><h1>Три вида поля ввода</h1></div><button onClick={() => { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? "dark" : "light"; }}>Светлая / тёмная</button></header>
    <nav className="oduvanchik-composers-tabs" aria-label="Вид поля">{variants.map((variant) => <button key={variant} aria-pressed={active === variant} onClick={() => setActive(variant)}>{names[variant]}</button>)}</nav>
    <div className="oduvanchik-composers-grid">{variants.map((variant) => <Chat key={variant} variant={variant} />)}</div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ChatLabelsProvider labels={russianLabels}><TooltipProvider><Gallery /></TooltipProvider></ChatLabelsProvider>);
