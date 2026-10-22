import { AgentPanel } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { AgentPanelProvider } from "@ykurilov/agent-chat-react/panel";
import type { BrowserToolImplementations } from "@ykurilov/agent-chat-react/panel";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { demoBrowserTools } from "../../shared/demo-browser-tools";
import { TaskCardPage } from "./task-card-page";
import { TaskListPage } from "./task-list-page";

/** Адрес списка; карточка — `/panel-app/tasks/<id>`. */
export const panelAppPath = "/panel-app";
const cardPathPattern = /^\/panel-app\/tasks\/([^/]+)$/;

function currentPath(): string {
  return location.pathname;
}

/**
 * Корневой макет демо «приложение с панелью»: провайдер панели стоит выше страниц, поэтому переход между списком и карточкой
 * не пересоздаёт панель — она остаётся открытой на том же чате. Страницы меняются без перезагрузки, как в обычном приложении.
 */
export function PanelAppRoot({ api, userKey }: { api: string; userKey: string }) {
  const [path, setPath] = useState(currentPath);
  const [mode, setMode] = useState<"overlay" | "push">("overlay");

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string) => {
    history.pushState(null, "", next);
    setPath(next);
  }, []);

  const browserTools = useMemo<BrowserToolImplementations<typeof demoBrowserTools>>(
    () => ({
      open_task: ({ taskId }) => navigate(`${panelAppPath}/tasks/${encodeURIComponent(taskId)}`),
      // Не отвечает, пока вызов не оборвут: сервер закроет его по сроку.
      freeze_page: (_input, { signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    }),
    [navigate],
  );

  const taskId = cardPathPattern.exec(path)?.[1];
  return (
    <AgentPanelProvider api={api} userKey={userKey} mode={mode} browserTools={browserTools}>
      {taskId ? (
        <TaskCardPage taskId={taskId} mode={mode} onModeChange={setMode} navigate={navigate} />
      ) : (
        <TaskListPage mode={mode} onModeChange={setMode} navigate={navigate} />
      )}
      <AgentPanel skin={new URLSearchParams(location.search).get("skin") === "tandem" ? tandemSkin : undefined} spendingLimits />
    </AgentPanelProvider>
  );
}
