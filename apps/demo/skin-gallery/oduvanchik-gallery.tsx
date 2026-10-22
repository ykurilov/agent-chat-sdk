import { TooltipProvider } from "@tandem/ui";
import { ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin, oduvanchikWorkParts, OduvanchikSphere, OduvanchikWelcome } from "@ykurilov/agent-chat-skin-oduvanchik";
import { ArrowUpRightIcon, FileTextIcon, SunIcon, MoonIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./oduvanchik-gallery.css";

const initialTheme = new URLSearchParams(location.search).get("theme") ?? "light";
if (initialTheme !== "system") document.documentElement.dataset.theme = initialTheme;
const noop = () => undefined;
const { Layout, AgentMessage, AgentText, UserMessage, Composer, ToolCallRow, AgentPanel } = oduvanchikSkin;
const { WorkSteps } = oduvanchikWorkParts;
function Gallery() {
  const [theme, setTheme] = useState(initialTheme);
  const [stage, setStage] = useState<"welcome" | "working" | "approval" | "done">("welcome");
  const [value, setValue] = useState("");
  const [request, setRequest] = useState("");
  const [stepsOpen, setStepsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [attachmentItems, setAttachmentItems] = useState<Array<{ id: string; kind: "file"; name: string; status: "ready" }>>([]);
  const submit = (text = value) => { if (!text.trim() && !attachmentItems.length) return; setRequest(text); setValue(""); setAttachmentItems([]); setStage("working"); };
  const toggleTheme = () => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); document.documentElement.dataset.theme = next; };
  const feed = stage === "welcome" ? <OduvanchikWelcome title="Чем помочь?" description="Я вижу ваши проекты, материалы курсов и прошлые рассылки."
    suggestions={[{ category: "Написать", label: "План рассылки к вебинару" }, { category: "Разобрать", label: "Что тормозит лендинг вебинара" }, { category: "Собрать", label: "Квиз по уроку 7" }]} onPick={submit} /> : <>
    <UserMessage text={request} />
    <AgentMessage status={stage === "working" ? "streaming" : "complete"} empty={false} onCopy={() => setCopied(true)} actions={[{ id: "theme", busy: false, label: "Сменить тему", icon: theme === "dark" ? <SunIcon /> : <MoonIcon />, onRun: toggleTheme }]}>
      <WorkSteps state="done" count={3} open={stepsOpen} onOpenChange={setStepsOpen} icons={["read", "search", "check"]} steps={[]}
        items={[{ icon: "read", phrase: "Прочитал лендинг вебинара", failed: false }, { icon: "search", phrase: "Нашёл три прошлые рассылки", failed: false }, { icon: "check", phrase: "Проверил ссылки в письмах", failed: false }]} />
      {stage === "working" && <WorkSteps state="live" phrase="Пишу структуру писем…" icon="edit" />}
      <AgentText markdown={stage === "working" ? "Пока черновик такой:\n\n1. Анонс - за 7 дней\n2. Польза - за 3 дня\n3. Напоминание - в день эфира" : "Все 5 писем готовы. Прочитал их на ошибки и проверил ссылки - всё открывается."} streaming={stage === "working"} />
      <a className="gallery-file" href="data:text/plain;charset=utf-8,План%20рассылки" download="План рассылки.md"><FileTextIcon size={26} aria-hidden /><div><b>План рассылки.md</b><p className="oduvanchik-label">5 писем · проверено</p></div><ArrowUpRightIcon size={18} aria-hidden /></a>
      {stage === "working" ? <button className="gallery-next" onClick={() => setStage("approval")}>Проверить расписание</button> : <ToolCallRow toolName="schedule_letters" title="Поставить письма в отправку" state="running" input={{ Кому: "Подписчики вебинара · 1 240", Первое: "24 окт, 10:00", Последнее: "31 окт, 18:30" }} open={false} onOpenChange={noop}
        approval={stage === "approval" ? { state: "requested", onDecide: (decision) => { setStage("done"); setValue(decision === "deny" ? "Хочу изменить время отправки" : ""); }, pending: false, failed: false, canAlways: false } : { state: "allowed" }} />}
      {stage === "done" && <p role="status">Решение принято</p>}
    </AgentMessage>
    {copied && <span role="status">Ответ скопирован</span>}
  </>;
  return <div className="oduvanchik-chat">
    <main className="gallery-app"><header><span className="oduvanchik-label">Мастерская / Рассылки</span><button onClick={toggleTheme}>Светлая / тёмная</button></header>
      <h1>Рассылка к вебинару</h1><p className="oduvanchik-label">Проект · 24 октября</p>
      <article className="gallery-doc"><h2>Письма, которые ведут к встрече</h2><p>Пять писем: от первого знакомства с темой до напоминания о начале вебинара.</p><p>Агент изучает материалы проекта и предлагает расписание. Перед отправкой каждое действие ждёт вашего решения.</p></article>
      <button className="gallery-new-chat" onClick={() => { setStage("welcome"); setValue(""); }}>Новый чат</button>
    </main>
    <AgentPanel open mode="push" width={490} title={stage === "welcome" ? "Агент" : "План рассылки"} listOpen={listOpen} onListOpenChange={setListOpen} onClose={noop} onEscape={() => setListOpen(false)} list={<button onClick={() => { setStage("welcome"); setListOpen(false); }}>Новый чат</button>}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="gallery-status">{stage === "welcome" || stage === "working" ? <OduvanchikSphere size={16} /> : <span className="gallery-dot" />}<span className="oduvanchik-label">{stage === "welcome" ? "Мастерская" : stage === "working" ? "Агент работает" : stage === "approval" ? "Ждёт решения" : "Есть новое"}</span></div>
        <div style={{ flex: 1, minHeight: 0 }}><Layout feed={feed} scrollRef={scrollRef} announcement="" composer={
          <Composer value={value} onValueChange={setValue} onSubmit={() => submit()} busy={stage === "working"} canSteer={stage === "working"} canSubmit={!!value.trim() || attachmentItems.length > 0} onStop={() => setStage("done")}
            attachments={{ accept: "*/*", items: attachmentItems, onAddFiles: (files) => setAttachmentItems((current) => [...current, ...files.map((file, index) => ({ id: `${Date.now()}-${index}`, kind: "file" as const, name: file.name, status: "ready" as const }))]), onRemove: (id) => setAttachmentItems((items) => items.filter((item) => item.id !== id)) }} />
        } /></div>
      </div>
    </AgentPanel>
  </div>;
}
createRoot(document.getElementById("root")!).render(<ChatLabelsProvider labels={russianLabels}><TooltipProvider><Gallery /></TooltipProvider></ChatLabelsProvider>);
