import { useAgentDataChanges } from "@ykurilov/agent-chat-react/panel";
import { PanelPageFrame } from "./panel-page-frame";
import type { PanelMode } from "./panel-page-frame";
import { useDemoJson } from "./use-demo-fetch";

export interface DemoTaskView {
  id: string;
  title: string;
  note: string;
}

interface PageProps {
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  navigate: (path: string) => void;
}

export function TaskListPage({ mode, onModeChange, navigate }: PageProps) {
  const [loaded, reload] = useDemoJson<{ tasks: DemoTaskView[] }>("/api/demo/tasks");
  // Агент создал задачу: список читается заново, без перезагрузки страницы.
  useAgentDataChanges("tasks", reload);
  return (
    <PanelPageFrame mode={mode} onModeChange={onModeChange}>
      <h1 className="text-xl font-semibold">Задачи</h1>
      {loaded === null && <p className="mt-3 text-[var(--foreground-muted)]">Загружаю…</p>}
      {loaded === "failed" && <p className="mt-3">Не удалось загрузить задачи.</p>}
      {typeof loaded === "object" && loaded !== null && (
        <ul className="mt-4 flex flex-col gap-2">
          {loaded.tasks.map((task) => (
            <li key={task.id}>
              <a
                href={`/panel-app/tasks/${task.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/panel-app/tasks/${task.id}`);
                }}
                className="block rounded border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface-hover,var(--surface))]"
              >
                <span className="font-medium">{task.title}</span>
                <span className="block text-sm text-[var(--foreground-muted)]">{task.note}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </PanelPageFrame>
  );
}
