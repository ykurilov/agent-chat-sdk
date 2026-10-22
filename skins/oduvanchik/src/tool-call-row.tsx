import { Sphere } from "@ykurilov/ds-react";
import { Badge, Button, cn } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, ChevronDown, CornerDownRight, X } from "./icons";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { OduvanchikToolApprovalCard } from "./tool-approval-card";
import type { ComponentProps } from "react";

type ToolCallRowProps = ComponentProps<ChatSkin["ToolCallRow"]>;

const badgeVariant = { running: "neutral", done: "success", error: "warm" } as const;

/**
 * Вызов инструмента спокойной строкой: состояние, короткая выжимка входа; по нажатию —
 * сам вызов и его результат или ошибка.
 */
export function OduvanchikToolCallRow({
  toolName,
  title: humanTitle,
  approval,
  state,
  input,
  output,
  errorText,
  open,
  onOpenChange,
  outputEdited,
}: ToolCallRowProps) {
  const labels = useChatLabels();
  const detailsId = useId();
  const title =
    state === "running" ? labels.toolRunning(toolName) : state === "done" ? labels.toolDone(toolName) : labels.toolError(toolName);
  const summary = summarize(input);
  const rowRef = useRef<HTMLDivElement>(null);
  const wasRequested = useRef(false);
  const requested = approval?.state === "requested";
  // Карточка исчезла вместе с нажатой кнопкой: без этого фокус упал бы на страницу.
  useEffect(() => {
    if (wasRequested.current && !requested && (!document.activeElement || document.activeElement === document.body)) {
      rowRef.current?.querySelector("button")?.focus();
    }
    wasRequested.current = requested;
  }, [requested]);
  const decisionMark = approval && approval.state !== "requested" ? decisionLabel(approval.state, labels) : "";
  // Область с итогом стоит на месте карточки и строки, поэтому итог решения читалка озвучивает.
  const outcome = approval && (
    <span data-approval-outcome aria-live="polite" className="sr-only">
      {decisionMark}
    </span>
  );
  if (approval?.state === "requested") {
    return (
      <>
        {outcome}
        <OduvanchikToolApprovalCard toolName={toolName} title={humanTitle} input={input} approval={approval} />
      </>
    );
  }

  return (
    <>
      {outcome}
      <div
        ref={rowRef}
        data-tool-state={state}
        className="my-2 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] text-xs"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={outputEdited ? `${title}, ${labels.toolOutputEdited}` : title}
          onClick={() => onOpenChange(!open)}
          className="h-auto min-h-9 w-full justify-start gap-2 rounded-[var(--radius-nested)] px-3 py-1.5 text-xs font-normal"
        >
          <Badge variant={badgeVariant[state]} className="shrink-0 py-0.5 font-medium">
            <StateMark state={state} />
            {title}
          </Badge>
          {outputEdited && (
            <Badge variant="cool" className="shrink-0 py-0.5">
              {labels.toolOutputEdited}
            </Badge>
          )}
          {decisionMark && <span aria-hidden="true" className="shrink-0 text-[var(--foreground-muted)]">{decisionMark}</span>}
          {summary && <span className="min-w-0 truncate text-[var(--foreground-muted)]">{summary}</span>}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "ml-auto size-3.5 shrink-0 text-[var(--foreground-subtle)] transition-transform duration-[var(--motion-fast)]",
              open && "rotate-180",
            )}
          />
        </Button>
        {open && (
          <div id={detailsId} className="space-y-2 border-t border-[var(--border)] px-3 py-2.5">
            <Code>{`${toolName}(${input === undefined ? "" : format(input)})`}</Code>
            {state !== "running" && (
              <div className="flex gap-1.5">
                <CornerDownRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-[var(--foreground-subtle)]" />
                {state === "error" ? (
                  <Code className="text-[var(--destructive-text)]">{errorText ?? ""}</Code>
                ) : isScreenshotOutput(output) ? (
                  <Screenshot pageUrl={output.pageUrl} screenshotUrl={output.screenshotUrl} />
                ) : (
                  <Code>{withLinks(format(output))}</Code>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function decisionLabel(state: "allowed" | "always" | "denied", labels: ReturnType<typeof useChatLabels>): string {
  if (state === "allowed") return labels.approvalAllowedMark;
  return state === "always" ? labels.approvalAlwaysMark : labels.approvalDeniedMark;
}

/** Состояние без крутящегося значка: Тандем показывает занятость спокойной пульсацией. */
function StateMark({ state }: { state: ToolCallRowProps["state"] }) {
  if (state === "done") return <Check aria-hidden="true" className="size-3" />;
  if (state === "error") return <X aria-hidden="true" className="size-3" />;
  return <Sphere size={16} />;
}

function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-60 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[var(--foreground-muted)]",
        className,
      )}
    >
      {children}
    </pre>
  );
}

/** Выжимка входа в строку: значения простых полей через запятую. */
function summarize(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object") return String(input);
  return Object.values(input)
    .filter((value) => ["string", "number", "boolean"].includes(typeof value))
    .join(", ");
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

interface ScreenshotOutput {
  pageUrl: string;
  screenshotUrl: string;
}

function isScreenshotOutput(value: unknown): value is ScreenshotOutput {
  const record = value as Partial<ScreenshotOutput> | null;
  return typeof record?.pageUrl === "string" && typeof record.screenshotUrl === "string";
}

/** Картинку рисуем только с http(s) и data:image: остальные схемы (javascript:, file:, blob:) не открываем. */
const drawableImage = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i;

/** Снимок страницы картинкой; если не загрузился или адрес не подходит — текст и ссылка на страницу. */
function Screenshot({ pageUrl, screenshotUrl }: ScreenshotOutput) {
  const labels = useChatLabels();
  const [failed, setFailed] = useState(false);
  const canDraw = drawableImage.test(screenshotUrl) && !failed;

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      {canDraw ? (
        <img
          src={screenshotUrl}
          alt={labels.screenshotAlt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-h-80 max-w-full rounded-[var(--radius-nested)] border border-[var(--border)] object-contain object-top"
        />
      ) : (
        <p className="text-[var(--foreground-muted)]">{labels.screenshotUnavailable}</p>
      )}
      <p className="min-w-0 break-words text-[var(--foreground-muted)]">{withLinks(pageUrl)}</p>
    </div>
  );
}

/** Адреса http(s) в тексте становятся ссылками в новой вкладке; остальное остаётся текстом. */
const linkPattern = /https?:\/\/[^\s<>()[\]"']+/gi;
const trailingPunctuation = /[.,;:!?]+$/;

function withLinks(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(linkPattern)) {
    const address = match[0].replace(trailingPunctuation, "");
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={address}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--foreground)] underline underline-offset-2 hover:no-underline"
      >
        {address}
      </a>,
    );
    last = match.index + address.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
