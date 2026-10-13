import { Badge, Button, cn } from "@tandem/ui";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import type { ComponentProps, ReactNode } from "react";

/** Что ушло в модель и что пришло: инструкция, сообщения (новые отмечены), инструменты, настройки, ответ. */
export function TandemModelCallDetails(props: ComponentProps<SandboxSkin["ModelCallDetails"]>) {
  const labels = useSandboxLabels();
  if (props.state !== "ready") return <NotReady {...props} />;
  const { instructions, messages, tools, settings, response, error } = props;
  return (
    <div className="flex flex-col gap-3 text-xs">
      {error && <Section title={labels.error} tone="error"><Code>{error}</Code></Section>}
      <Section title={labels.instructions}>
        <Code>{instructions}</Code>
      </Section>
      <Section title={labels.messages}>
        <ol className="flex flex-col gap-1.5">
          {messages.map((message, index) => (
            <li
              key={index}
              className={cn(
                "rounded-[var(--radius-small)] border px-2 py-1.5",
                message.isNew ? "border-[var(--accent-border,var(--border))] bg-[var(--surface-hover)]" : "border-[var(--border)]",
              )}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-medium text-[var(--foreground)]">{message.role}</span>
                {message.isNew && <Badge variant="cool">{labels.newMessage}</Badge>}
                {message.truncated && <Badge variant="warm">{labels.truncated}</Badge>}
              </div>
              <Code>{message.content}</Code>
            </li>
          ))}
        </ol>
      </Section>
      {tools.length > 0 && (
        <Section title={labels.tools}>
          <ul className="flex flex-col gap-1.5">
            {tools.map((tool) => (
              <li key={tool.name}>
                <span className="font-medium text-[var(--foreground)]">{tool.name}</span>
                {tool.description && <p className="text-[var(--foreground-muted)]">{tool.description}</p>}
                <Code>{tool.inputSchema}</Code>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={labels.settings}>
        <Code>{settings}</Code>
      </Section>
      <Section title={labels.response}>
        {response.reasoning && (
          <>
            <h5 className="font-medium text-[var(--foreground-muted)]">{labels.reasoning}</h5>
            <Code>{response.reasoning}</Code>
          </>
        )}
        {response.text && <Code>{response.text}</Code>}
        {response.toolCalls.length > 0 && (
          <>
            <h5 className="font-medium text-[var(--foreground-muted)]">{labels.toolCalls}</h5>
            {response.toolCalls.map((call) => (
              <Code key={call.toolCallId}>{`${call.toolName}(${call.input})`}</Code>
            ))}
          </>
        )}
        {response.finishReason !== null && (
          <p className="flex gap-1.5 text-[var(--foreground-muted)]">
            {labels.finishReason}
            <span className="font-mono text-[var(--foreground)]">{response.finishReason}</span>
          </p>
        )}
      </Section>
    </div>
  );
}

/** Вход и результат вызова инструмента. */
export function TandemToolCallDetails(props: ComponentProps<SandboxSkin["ToolCallDetails"]>) {
  const labels = useSandboxLabels();
  if (props.state !== "ready") return <NotReady {...props} />;
  return (
    <div className="flex flex-col gap-3 text-xs">
      {props.truncated && <Badge variant="warm" className="self-start">{labels.truncated}</Badge>}
      <Section title={labels.toolInput}>
        <Code>{props.input}</Code>
      </Section>
      {props.error ? (
        <Section title={labels.error} tone="error">
          <Code>{props.error}</Code>
        </Section>
      ) : (
        <Section title={labels.toolOutput}>
          {props.output === null ? <p className="text-[var(--foreground-muted)]">{labels.noOutput}</p> : <Code>{props.output}</Code>}
        </Section>
      )}
    </div>
  );
}

function NotReady(props: { state: "loading" } | { state: "failed"; onRetry: () => void }) {
  const labels = useSandboxLabels();
  if (props.state === "loading") {
    return (
      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {labels.journalLoading}
      </p>
    );
  }
  return (
    <div role="alert" className="flex items-center gap-2 text-xs text-[var(--destructive-text)]">
      {labels.journalFailed}
      <Button variant="ghost" size="sm" onClick={props.onRetry} className="h-7 px-2">
        {labels.retry}
      </Button>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: "error"; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className={cn("font-semibold", tone === "error" ? "text-[var(--destructive-text)]" : "text-[var(--foreground)]")}>{title}</h4>
      {children}
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-small)] bg-[var(--canvas)] p-2 font-mono text-xs leading-5 text-[var(--foreground-muted)]">
      {children}
    </pre>
  );
}
