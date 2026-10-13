import { AgentChat } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { demoAppEvents } from "./demo-app-events";

export const lessonPath = "/lesson";

/** Страница урока: чат объекта `lesson:demo` — у человека один чат на урок, первым пишет агент. */
export function LessonPage({ api, skin }: { api: string; skin: ChatSkin }) {
  return (
    <div className="flex h-full flex-col">
      <h1 className="px-4 py-2 text-base font-semibold">Урок: дроби</h1>
      <div className="min-h-0 flex-1">
        <AgentChat api={api} subject="lesson:demo" skin={skin} attachments={attachmentsClient} appEvents={demoAppEvents} />
      </div>
    </div>
  );
}
