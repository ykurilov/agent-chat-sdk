import { useAgentPlace } from "@ykurilov/agent-chat-react/panel";
import { useState } from "react";
import { PanelPageFrame } from "./panel-page-frame";
import type { PanelMode } from "./panel-page-frame";
import type { DemoTaskView } from "./task-list-page";
import { useDemoJson } from "./use-demo-fetch";

interface CardProps {
  taskId: string;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  navigate: (path: string) => void;
}

export function TaskCardPage({ taskId, mode, onModeChange, navigate }: CardProps) {
  const [loaded] = useDemoJson<{ task: DemoTaskView }>(`/api/demo/tasks/${encodeURIComponent(taskId)}`);
  const task = typeof loaded === "object" && loaded !== null ? loaded.task : null;
  const [started, setStarted] = useState(false);
  // Агент знает, на какой карточке человек, пока карточка на экране.
  useAgentPlace(task && { description: `Карточка задачи «${task.title}», id ${task.id}`, data: { taskId: task.id } });
  return (
    <PanelPageFrame mode={mode} onModeChange={onModeChange}>
      <a
        href="/panel-app"
        onClick={(event) => {
          event.preventDefault();
          navigate("/panel-app");
        }}
        className="text-sm underline"
      >
        К списку задач
      </a>
      {loaded === null && <p className="mt-3 text-[var(--foreground-muted)]">Загружаю…</p>}
      {(loaded === "not_found" || loaded === "failed") && <p className="mt-3">Такой задачи нет.</p>}
      {task && (
        <article className="mt-4">
          <h1 className="text-xl font-semibold">{task.title}</h1>
          <p className="mt-2">{task.note}</p>
          <button
            type="button"
            onClick={() => setStarted(!started)}
            className="mt-4 rounded border border-[var(--border)] px-3 py-2"
          >
            {started ? "В работе" : "Взять в работу"}
          </button>
        </article>
      )}
    </PanelPageFrame>
  );
}
