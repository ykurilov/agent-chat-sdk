import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";

type ToolCallRowProps = ComponentProps<ChatSkin["ToolCallRow"]>;

const railClass = {
  running: "border-[var(--border-strong)]",
  done: "border-[var(--success-border)]",
  error: "border-[var(--warm-border)]",
} as const;

const titleClass = {
  running: "text-[var(--foreground-muted)]",
  done: "text-[var(--success-text)]",
  error: "text-[var(--warm-text)]",
} as const;

/**
 * Строка вызова, которую приложение подставляет вместо строки скина (US5-3, FR-027):
 * `skin={{ ...tandemSkin, ToolCallRow: CustomToolCallRow }}`. Те же пропсы и надписи из
 * словаря, свой вид — строка журнала: состояние, вход и результат сразу. Раскрытия нет,
 * поэтому `open` и `onOpenChange` не используются.
 */
export function CustomToolCallRow({ toolName, state, input, output, errorText }: ToolCallRowProps) {
  const labels = useChatLabels();
  const title =
    state === "running" ? labels.toolRunning(toolName) : state === "done" ? labels.toolDone(toolName) : labels.toolError(toolName);
  const result = state === "running" ? null : state === "error" ? (errorText ?? "") : brief(output);

  return (
    <div
      data-custom-tool-row
      data-state={state}
      className={`my-2 flex min-w-0 flex-col gap-0.5 border-l-2 py-0.5 pl-3 font-mono text-xs leading-5 ${railClass[state]}`}
    >
      <span className={`font-medium ${titleClass[state]} ${state === "running" ? "animate-pulse" : ""}`}>{title}</span>
      <span className="min-w-0 text-[var(--foreground-muted)] [overflow-wrap:anywhere]">
        {brief(input)}
        {result !== null && <span className="text-[var(--foreground-subtle)]"> → </span>}
        {result}
      </span>
    </div>
  );
}

/** Значение в одну строку: строка как есть, объект — простые поля через запятую. */
function brief(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object") return String(value);
  return Object.values(value)
    .map((field) => (typeof field === "object" ? JSON.stringify(field) : String(field)))
    .join(", ");
}
