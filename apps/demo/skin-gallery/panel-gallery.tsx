import { TooltipProvider } from "@tandem/ui";
import { tandemSkin, TandemAgentMessage, TandemComposer } from "@ykurilov/agent-chat-skin-tandem";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина панели агента скина Тандем (T015 плана 021): без сервера, чат и список — образцы. Что показать, задаёт адрес страницы:
 *   theme=light|dark, open=0 (панель закрыта), list=1 (список чатов поверх), busy=1 (идёт ответ), mode=push|overlay, width=<px>.
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const noop = () => undefined;
const items = [
  { id: "c2", title: "Про Грецию", active: true },
  { id: "c1", title: "Налоги за прошлый год, очень длинное название чата, которое не должно ломать вёрстку", active: false },
];
const { AgentPanel, AgentPanelLauncher, ChatList } = tandemSkin;

function Gallery() {
  const [open, setOpen] = useState(params.get("open") !== "0");
  const [listOpen, setListOpen] = useState(params.get("list") === "1");
  const [clicks, setClicks] = useState(0);
  const mode = params.get("mode") === "push" ? "push" : "overlay";
  const width = Number(params.get("width") ?? 420);
  return (
    <TooltipProvider>
      <main className="min-h-dvh bg-[var(--canvas)] p-6" style={mode === "push" && open ? { paddingRight: width + 24 } : undefined}>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">Страница приложения</h1>
        <p className="mt-2 text-[var(--foreground-muted)]">Страница под панелью не затемняется и остаётся кликабельной.</p>
        <button type="button" data-page-button onClick={() => setClicks(clicks + 1)} className="mt-4 rounded border border-[var(--border)] px-3 py-2 text-[var(--foreground)]">
          Кнопка страницы: {clicks}
        </button>
      </main>
      <AgentPanelLauncher open={open} busy={params.get("busy") === "1"} onToggle={() => setOpen(!open)} buttonRef={undefined as never} />
      <AgentPanel
        open={open}
        mode={mode}
        width={width}
        title="Про Грецию"
        listOpen={listOpen}
        onListOpenChange={setListOpen}
        onClose={() => setOpen(false)}
        onEscape={() => setOpen(false)}
        list={<ChatList status="ready" items={items} creating={false} onSelect={() => setListOpen(false)} onCreate={noop} onRename={noop} onRequestDelete={noop} />}
      >
        <div className="flex h-full flex-col justify-end gap-4 p-3">
          <TandemAgentMessage status="complete" onCopy={noop} empty={false} notice={null}>
            <p>В Греции в октябре тепло: море ещё около двадцати трёх градусов.</p>
          </TandemAgentMessage>
          <TandemComposer value="" onValueChange={noop} onSubmit={noop} canSubmit={false} busy={false} onStop={noop} />
        </div>
      </AgentPanel>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
