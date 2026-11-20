import { AgentAvatar, AgentMessage, Badge, Button, Tooltip } from "@tandem/ui";
import type { ChatSkin, MessageActionView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, Copy, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { Children, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { TandemInterruptMark } from "./interrupt-mark";
import { TandemThinkingLabel } from "./thinking-label";

const COPIED_FEEDBACK_MS = 1600;

/** Ответ агента (промежуток до следующего сообщения — внутренний отступ): аватар, пузырь с частями ответа, блок ошибки, отметка состояния и правки, «повторить», «изменить», копирование и свои кнопки приложения. */
export function TandemAgentMessage({
  status,
  children,
  onCopy,
  empty,
  emptyText,
  onRetry,
  notice,
  branchSwitcher,
  onRegenerate,
  voiceInterrupted,
  cutByLength,
  onEdit,
  edited,
  actions,
  continued,
  followsPrevious,
}: ComponentProps<ChatSkin["AgentMessage"]>) {
  const labels = useChatLabels();
  const [copied, setCopied] = useState(false);
  const streaming = status === "streaming";
  const hasParts = Children.toArray(children).length > 0;
  // Договор 34: строку вместо ответа без текста выбрал слой поведения (`""` — без строки); скин до 34 решал по `empty`.
  const textless = empty || emptyText !== undefined;
  const emptyLine = emptyText ?? (empty ? labels.answerEmpty : "");
  // Строка «остановлен/оборвался до начала» уже всё говорит: отметка рядом её бы повторила.
  const statusBadge = !emptyText && (status === "stopped" || status === "interrupted");
  // Без тела (только ряд кнопок, например переключатель веток у ответа, закрытого ради поправки) аватар не рисуется: место
  // под ним остаётся, чтобы ряд стоял на своей линии.
  const bodyless = !streaming && !hasParts && !emptyLine && !notice && !voiceInterrupted;
  // Договор 37: ответ продолжается следующим — «Копировать» у последнего ответа цепочки, он копирует всю цепочку.
  const copyable = !textless && !continued;
  const hasActions = Boolean(branchSwitcher) || statusBadge || Boolean(cutByLength) || Boolean(edited) || Boolean(onRetry) || Boolean(onRegenerate) || Boolean(onEdit) || copyable || Boolean(actions?.length);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className={continued ? "flex gap-3" : "flex gap-3 pb-6"} data-status={status}>
      {/* Продолжение прошлого ответа (договор 37) — одно сообщение: второй аватар не рисуется, место под ним остаётся. */}
      <AgentAvatar thinking={streaming} className={bodyless || (followsPrevious && !streaming) ? "invisible mt-0.5" : "mt-0.5"} aria-hidden={bodyless || (followsPrevious && !streaming) || undefined} />
      <div className="flex min-w-0 max-w-[650px] flex-1 flex-col items-start">
        {hasParts || (emptyLine && !notice) ? (
          // Пузырь сжимается по тексту; с живой демонстрацией он во всю колонку: рамке нужна ширина ответа.
          <AgentMessage side="agent" className="max-w-full has-[[data-live-demo]]:w-full">
            {children}
            {emptyLine && <p className="text-[var(--foreground-muted)]">{emptyLine}</p>}
          </AgentMessage>
        ) : (
          streaming && (
            <p data-thinking-status role="status" className="flex gap-1.5 py-2 text-xs text-[var(--foreground-muted)]">
              <TandemThinkingLabel />
            </p>
          )
        )}
        {notice && <div className="mt-2 w-full">{notice}</div>}
        {voiceInterrupted && <TandemInterruptMark spokenTail={voiceInterrupted.spokenTail} />}
        {/* Строка с кнопками стоит под пузырём всегда, пока ответ пишется — скрытая. Если её вставлять в конце, пузырь
            перестаёт быть последним в колонке, и правило `tr:last-child td` дизайн-системы заставляет браузер
            пересчитать стили каждой ячейки всех таблиц ответа разом (R16). */}
        <div className={streaming || !hasActions ? "hidden" : "mt-1 flex h-7 items-center gap-2"}>
          {!streaming && (
            <>
              {branchSwitcher}
              {statusBadge && status === "stopped" && <Badge variant="neutral">{labels.answerStopped}</Badge>}
              {statusBadge && status === "interrupted" && <Badge variant="warm">{labels.answerInterrupted}</Badge>}
              {cutByLength && <Badge variant="warm">{labels.answerCutByLength}</Badge>}
              {edited && <Badge variant="cool">{labels.answerEdited}</Badge>}
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRetry}
                  className="h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5"
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
                  className="h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5"
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
                  className="h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5"
                >
                  <Pencil aria-hidden="true" />
                  {labels.editAnswer}
                </Button>
              )}
              {copyable && (
                <Tooltip label={copied ? labels.copied : labels.copyAnswer} side="bottom">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={copied ? labels.copied : labels.copyAnswer}
                    onClick={() => {
                      onCopy();
                      setCopied(true);
                    }}
                    className="size-7 rounded-[var(--radius-small)] text-[var(--foreground-subtle)] [&_svg]:size-3.5"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </Tooltip>
              )}
              {actions?.map((action) => <TandemMessageAction key={action.id} action={action} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Своя кнопка приложения: с иконкой — как копирование (иконка и подсказка), без иконки — как «повторить» (подпись текстом). */
function TandemMessageAction({ action }: { action: MessageActionView }) {
  const buttonState = { disabled: action.busy, "aria-busy": action.busy, onClick: action.onRun };
  if (action.icon === undefined) {
    return (
      <Button variant="ghost" size="sm" {...buttonState} className="h-7 gap-1.5 rounded-[var(--radius-small)] px-2 [&_svg]:size-3.5">
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
        className="size-7 rounded-[var(--radius-small)] text-[var(--foreground-subtle)] [&_svg]:size-3.5"
      >
        {action.icon}
      </Button>
    </Tooltip>
  );
}
