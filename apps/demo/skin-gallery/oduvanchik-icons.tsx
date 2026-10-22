import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { TandemLabelsProvider, russianTandemLabels } from "@tandem/ui";
import { oduvanchikSkin, oduvanchikMemorySkin, OduvanchikVoiceDialogPanel } from "@ykurilov/agent-chat-skin-oduvanchik";
import "./oduvanchik-gallery.css";

const { AgentText, ErrorNotice, ChatClosedNotice } = oduvanchikSkin;
const { MemoryConfirm } = oduvanchikMemorySkin;
function Gallery() {
  const [dark, setDark] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [voice, setVoice] = useState("anna");
  const [retried, setRetried] = useState(false);
  return <TandemLabelsProvider labels={russianTandemLabels}><main className="oduvanchik-chat" style={{ minHeight: "100dvh", padding: 24 }}>
    <div style={{ maxWidth: 720, margin: "auto", display: "grid", gap: 24 }}>
      <header style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        <h1>Одуванчик · Phosphor</h1><button onClick={() => { setDark(!dark); document.documentElement.dataset.theme = dark ? "light" : "dark"; }}>Светлая / тёмная</button>
      </header>
      <AgentText streaming={false} markdown={'Безопасный Markdown с копированием кода:\n\n```ts\nconst answer = 42;\n```\n\n| Задача | Готовность |\n| - | - |\n| План | Готово |'} />
      <ErrorNotice kind="other" text={retried ? "Повтор принят" : "Не удалось получить ответ"} onRetry={() => setRetried(true)} />
      {ChatClosedNotice && <ChatClosedNotice id="closed" code="demo" message="Чат закрыт владельцем" />}
      <OduvanchikVoiceDialogPanel dialog={{ state: "listening", speechAvailable: true, onToggle: () => undefined,
        voices: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }], currentVoiceId: voice, onSelectVoice: setVoice }} />
      <button onClick={() => setConfirm(true)}>Удалить запись памяти</button>
      {confirm && <MemoryConfirm target={{ kind: "note", content: "Предпочтения пользователя" }} pending={false} onCancel={() => setConfirm(false)} onConfirm={() => setConfirm(false)} />}
    </div>
  </main></TandemLabelsProvider>;
}
createRoot(document.getElementById("root")!).render(<ChatLabelsProvider labels={russianLabels}><Gallery /></ChatLabelsProvider>);
