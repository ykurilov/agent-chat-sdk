import { Button } from "@ykurilov/ds-react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import type { ComponentProps, ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h4>{title}</h4>{children}</section>;
}
function Code({ children }: { children: ReactNode }) { return <pre className="oduvanchik-journal-code">{children}</pre>; }
function NotReady(props: { state: "loading" } | { state: "failed"; onRetry: () => void }) {
  const labels = useSandboxLabels();
  return props.state === "loading" ? <p role="status">{labels.journalLoading}</p> : <div role="alert"><p>{labels.journalFailed}</p><Button variant="ghost" size="sm" onClick={props.onRetry}>{labels.retry}</Button></div>;
}
export function OduvanchikModelCallDetails(props: ComponentProps<SandboxSkin["ModelCallDetails"]>) {
  const labels = useSandboxLabels();
  if (props.state !== "ready") return <NotReady {...props} />;
  const { instructions, messages, tools, settings, response, error } = props;
  return <div className="oduvanchik-call-details">
    {error && <Section title={labels.error}><Code>{error}</Code></Section>}
    <Section title={labels.instructions}><Code>{instructions}</Code></Section>
    <Section title={labels.messages}><ol>{messages.map((message, index) => <li key={index}><span className="oduvanchik-label">{message.role}</span>{message.isNew && <span> · {labels.newMessage}</span>}{message.truncated && <span> · {labels.truncated}</span>}<Code>{message.content}</Code></li>)}</ol></Section>
    {tools.length > 0 && <Section title={labels.tools}><ul>{tools.map((tool) => <li key={tool.name}><strong>{tool.name}</strong>{tool.description && <p>{tool.description}</p>}<Code>{tool.inputSchema}</Code></li>)}</ul></Section>}
    <Section title={labels.settings}><Code>{settings}</Code></Section>
    <Section title={labels.response}>
      {response.reasoning && <Section title={labels.reasoning}><Code>{response.reasoning}</Code></Section>}
      {response.text && <Code>{response.text}</Code>}
      {response.toolCalls.length > 0 && <Section title={labels.toolCalls}>{response.toolCalls.map((call) => <Code key={call.toolCallId}>{`${call.toolName}(${call.input})`}</Code>)}</Section>}
      {response.finishReason !== null && <p>{labels.finishReason} <span className="oduvanchik-label">{response.finishReason}</span></p>}
    </Section>
  </div>;
}
export function OduvanchikToolCallDetails(props: ComponentProps<SandboxSkin["ToolCallDetails"]>) {
  const labels = useSandboxLabels();
  if (props.state !== "ready") return <NotReady {...props} />;
  return <div className="oduvanchik-call-details">
    {props.truncated && <p>{labels.truncated}</p>}
    <Section title={labels.toolInput}><Code>{props.input}</Code></Section>
    {props.error ? <Section title={labels.error}><Code>{props.error}</Code></Section> : <Section title={labels.toolOutput}>{props.output === null ? <p>{labels.noOutput}</p> : <Code>{props.output}</Code>}</Section>}
  </div>;
}
