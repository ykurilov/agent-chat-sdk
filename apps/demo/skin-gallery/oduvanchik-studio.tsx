import { ChatLabelsProvider, russianLabels, useModelChoice } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin, oduvanchikWorkParts } from "@ykurilov/agent-chat-skin-oduvanchik";
import { oduvanchikSandboxSkin, oduvanchikStudioChatListSkin } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import "./oduvanchik-studio.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const { Layout, AgentMessage, AgentText, UserMessage, Composer } = oduvanchikSkin;
const { WorkSteps } = oduvanchikWorkParts;
const { SandboxLayout, JournalList, ModelCallDetails, InstructionEditor } = oduvanchikSandboxSkin;
const { ChatWorkspace } = oduvanchikStudioChatListSkin;
type Scene = "empty" | "dialog" | "working";
const noop = () => undefined;
const answer = `## Первый вариант предложения\n\nЗдесь сильный результат - первая группа, а не набор записанных уроков. Я бы сделал на этом центр предложения.\n\n> Запустите свой первый онлайн-курс за шесть недель: от выбора темы и проверки спроса до набора группы.\n\n**Для кого:** эксперты, которые впервые запускают обучение.\n\n**Результат:** проверенная тема и первая группа участников.\n\nВы уже помогали кому-то пройти этот путь? Как быстро удалось собрать первую группу?`;
function Gallery() {
  const [scene, setScene] = useState<Scene>((params.get("state") as Scene) || "empty");
  const [journalOpen, setJournalOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [instruction, setInstruction] = useState("Задавайте по одному вопросу. Помогите сформулировать предложение.");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = scene === "working";
  const modelChoice = useModelChoice({ api: "/oduvanchik-catalog", chatId: "studio", menuWanted: true });
  const rows: ComponentProps<typeof JournalList>["rows"] = Array.from({ length: 24 }, (_, index) => ({
    kind: "model", id: `m${index}`, purpose: "answer", attempt: 1, modelId: "GPT-6.1 Sol", status: "complete", time: `12:${String(index).padStart(2, "0")}:04`, durationMs: 2400, firstChunkMs: 420, inputTokens: 1520, cachedInputTokens: 1024, outputTokens: 386, cost: "$0.0042", instructionsChanged: false, open: openIds.has(`m${index}`), onOpenChange: (open: boolean) => setOpenIds((old) => { const next = new Set(old); open ? next.add(`m${index}`) : next.delete(`m${index}`); return next; }),
    details: <ModelCallDetails state="ready" instructions={instruction} messages={[{ role: "user", content: "Проверим предложение для курса.", isNew: true, truncated: false }]} tools={[]} settings={'{\n  "reasoning": "high"\n}'} response={{ text: "Сформулировано предложение.", reasoning: "", toolCalls: [], finishReason: "stop" }} error={null} />,
  }));
  const feed = scene !== "empty" && <>
    {Array.from({ length: 7 }, (_, index) => <div key={index}><UserMessage text="Я хочу собрать программу для тех, кто запускается впервые." /><AgentMessage status="complete" empty={false} onCopy={noop}><AgentText markdown={answer} streaming={false} /></AgentMessage></div>)}
    <UserMessage text="Участник выберет тему, проверит спрос и соберёт первую группу. Занятия пройдут вживую." />
    <AgentMessage status={busy ? "streaming" : "complete"} empty={false} onCopy={noop} modelDetails={{ modelId: "gpt-6.1-sol", providerId: "openrouter", modelName: "GPT-6.1 Sol", providerName: "OpenRouter", reasoning: "high" }}>
      {busy && <WorkSteps state="live" phrase="Формулирую предложение" completed={[{ phrase: "Определил аудиторию и результат", failed: false, icon: "check" }]} />}
      <AgentText markdown={busy ? "Здесь сильный результат - первая группа. Я бы сделал на этом центр предложения." : answer} streaming={busy} />
    </AgentMessage>
  </>;
  return <div className="studio-gallery"><nav className="studio-gallery-controls" aria-label="Демонстрация Студии">{([['empty','Пустой чат'],['dialog','Диалог'],['working','Агент работает']] as const).map(([id, title]) => <button key={id} aria-pressed={scene === id} onClick={() => setScene(id)}>{title}</button>)}<button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>Сменить тему</button><small>Демонстрационные данные · запросы к модели не отправляются</small></nav>
    <div className="studio-gallery-scene"><SandboxLayout busy={busy} journalOpen={journalOpen} onJournalOpenChange={setJournalOpen}
      header={<InstructionEditor value={instruction} onValueChange={setInstruction} appInstructions="Задавайте по одному вопросу." edited={false} dirty canSave saving={false} onSave={() => setInstructionsOpen(false)} open={instructionsOpen} onOpenChange={setInstructionsOpen} maxLength={100_000} />}
      journal={<JournalList state={scene === "empty" ? "empty" : "ready"} rows={scene === "empty" ? [] : rows} busy={busy} turns={[]} currentTurnId={null} onTurnChange={noop} />}
      chat={<ChatWorkspace activeTitle="Проверка предложения" listOpen={listOpen} onListOpenChange={setListOpen} list={<nav aria-label="Чаты" className="studio-gallery-history"><button onClick={() => { setScene("empty"); setListOpen(false); }}>Новый чат</button></nav>}>
        <Layout scrollRef={scrollRef} empty={scene === "empty"} feed={feed} announcement="" composer={<Composer value={value} onValueChange={setValue} onSubmit={() => { if (value.trim()) { setScene("working"); setValue(""); } }} canSubmit={!!value.trim()} busy={busy} onStop={() => setScene("dialog")} options={{ variant: "extended" }} modelChoice={modelChoice} voice={{ state: recording ? "listening" : "idle", onToggle: () => setRecording(!recording) }} />}/>
      </ChatWorkspace>} /></div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<ChatLabelsProvider labels={{ ...russianLabels, welcome: { title: "Проверим, как агент ведёт разговор?", description: "Напишите от лица эксперта. Здесь можно проверить вопросы агента и увидеть ход диалога." } }}><Gallery /></ChatLabelsProvider>);
