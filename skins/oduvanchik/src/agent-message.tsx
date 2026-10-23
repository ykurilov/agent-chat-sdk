import { Badge, Button, Tooltip } from "@tandem/ui";
import type { ChatSkin, MessageActionView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, Copy, Pencil, RefreshCw, RotateCcw } from "./icons";
import { Sphere } from "@ykurilov/ds-react";
import { Children, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { OduvanchikInterruptMark } from "./interrupt-mark";
import { OduvanchikThinkingLabel } from "./thinking-label";

const COPIED_FEEDBACK_MS = 1600;

/** Ответ агента (промежуток до следующего сообщения — внутренний отступ): аватар, пузырь с частями ответа, блок ошибки, отметка состояния и правки, «повторить», «изменить», копирование и свои кнопки приложения. */
export function OduvanchikAgentMessage({
  status,
  modelDetails,
  children,
  onCopy,
  empty,
  onRetry,
  notice,
  branchSwitcher,
  onRegenerate,
  voiceInterrupted,
  cutByLength,
  onEdit,
  edited,
  actions,
}: ComponentProps<ChatSkin["AgentMessage"]>) {
  const labels = useChatLabels();
  const [copied, setCopied] = useState(false);
  const streaming = status === "streaming";
  const hasParts = Children.toArray(children).length > 0;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="oduvanchik-agent pb-6" data-status={status}>
      {streaming && !hasParts && <Sphere size={22} label={labels.reasoningRunning} />}
      <div className="flex min-w-0 max-w-[650px] flex-1 flex-col items-start">
        {hasParts || (empty && !notice) ? (
          // Ответ без пузыря; живой демонстрации доступна вся ширина колонки.
          <div className="oduvanchik-agent-body max-w-full has-[[data-live-demo]]:w-full">
            {children}
            {empty && <p className="text-[var(--foreground-muted)]">{labels.answerEmpty}</p>}
          </div>
        ) : (
          streaming && (
            <p data-thinking-status role="status" className="flex gap-1.5 py-2 text-xs text-[var(--foreground-muted)]">
              <OduvanchikThinkingLabel />
            </p>
          )
        )}
        {modelDetails && !streaming && <p className="oduvanchik-label oduvanchik-answer-meta">{modelDetails.modelName ?? modelDetails.modelId} · {modelDetails.providerName ?? modelDetails.providerId}{modelDetails.reasoning && ` · ${labels.composerSettings.levels[modelDetails.reasoning] ?? labels.reasoningLevels[modelDetails.reasoning as keyof typeof labels.reasoningLevels] ?? modelDetails.reasoning}`}</p>}
        {notice && <div className="mt-2 w-full">{notice}</div>}
        {voiceInterrupted && <OduvanchikInterruptMark spokenTail={voiceInterrupted.spokenTail} />}
        {/* Строка с кнопками стоит под пузырём всегда, пока ответ пишется — скрытая. Если её вставлять в конце, пузырь
            перестаёт быть последним в колонке, и правило `tr:last-child td` дизайн-системы заставляет браузер
            пересчитать стили каждой ячейки всех таблиц ответа разом (R16). */}
        <div className={streaming ? "hidden" : "oduvanchik-answer-actions mt-1 flex h-7 items-center gap-2"}>
          {!streaming && (
            <>
              {branchSwitcher}
              {status === "stopped" && <Badge variant="neutral">{labels.answerStopped}</Badge>}
              {status === "interrupted" && <Badge variant="warm">{labels.answerInterrupted}</Badge>}
              {cutByLength && <Badge variant="warm">{labels.answerCutByLength}</Badge>}
              {edited && <Badge variant="cool">{labels.answerEdited}</Badge>}
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRetry}
                  className="oduvanchik-answer-action h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5"
                >
                  <RotateCcw aria-hidden="true" />
                  {labels.retry}
                </Button>
              )}
              {onRegenerate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRegenerate}
                  className="oduvanchik-answer-action h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5"
                >
                  <RefreshCw aria-hidden="true" />
                  {labels.regenerate}
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onEdit}
                  className="oduvanchik-answer-action h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5"
                >
                  <Pencil aria-hidden="true" />
                  {labels.editAnswer}
                </Button>
              )}
              {!empty && (
                <Tooltip label={copied ? labels.copied : labels.copyAnswer} side="bottom">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={copied ? labels.copied : labels.copyAnswer}
                    onClick={() => {
                      onCopy();
                      setCopied(true);
                    }}
                    className="oduvanchik-answer-action size-7 rounded-[var(--radius-small)] text-[var(--foreground-subtle)] [&_svg]:size-3.5"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </Tooltip>
              )}
              {actions?.map((action) => <OduvanchikMessageAction key={action.id} action={action} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Своя кнопка приложения: с иконкой — как копирование (иконка и подсказка), без иконки — как «повторить» (подпись текстом). */
function OduvanchikMessageAction({ action }: { action: MessageActionView }) {
  const buttonState = { disabled: action.busy, "aria-busy": action.busy, onClick: action.onRun };
  if (action.icon === undefined) {
    return (
      <Button variant="ghost" size="sm" {...buttonState} className="oduvanchik-answer-action h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5">
        {action.label}
      </Button>
    );
  }
  return (
    <Tooltip label={action.label} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        aria-label={action.label}
        {...buttonState}
        className="oduvanchik-answer-action size-7 rounded-[var(--radius-small)] text-[var(--foreground-subtle)] [&_svg]:size-3.5"
      >
        {action.icon}
      </Button>
    </Tooltip>
  );
}
