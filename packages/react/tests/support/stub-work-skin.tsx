import type { ChatSkin, ToolApprovalView } from "../../src/skin-contract";
import { stubSkin } from "./stub-skin";

/** Кнопки решения подтверждения, как у строки инструмента заглушки. */
function ApprovalButtons({ approval }: { approval: ToolApprovalView | undefined }) {
  if (approval?.state !== "requested") return null;
  return (
    <>
      {(["allow", "deny", "always"] as const)
        .filter((decision) => decision !== "always" || approval.canAlways)
        .map((decision) => (
          <button key={decision} type="button" aria-label={decision} onClick={() => approval.onDecide(decision)} />
        ))}
    </>
  );
}

const approvalAttributes = (approval: ToolApprovalView | undefined) => ({
  "data-approval": approval?.state ?? "",
  "data-approval-pending": approval?.state === "requested" ? String(approval.pending) : "",
  "data-approval-failure": approval?.state === "requested" ? (approval.failureText ?? "") : "",
});

/** Скин-заглушка версии 18: помощники, карточки задач и плашки служебных сообщений видны в data-атрибутах. */
export const stubWorkSkin: ChatSkin = {
  ...stubSkin,
  HelperCallRow: ({ name, title, task, steps, text, status, approval, approvalAction, errorText, open, onOpenChange }) => (
    <div
      data-kind="helper"
      data-name={name}
      data-title={title ?? ""}
      data-task={task}
      data-steps={JSON.stringify(steps)}
      data-text={text}
      data-status={status}
      data-error={errorText ?? ""}
      data-open={String(open)}
      data-approval-action={approvalAction ? JSON.stringify(approvalAction) : undefined}
      {...approvalAttributes(approval)}
    >
      <button type="button" aria-label="помощник" aria-expanded={open} onClick={() => onOpenChange(!open)} />
      <ApprovalButtons approval={approval} />
    </div>
  ),
  TaskCard: ({ id, title, status, elapsedMs, onCancel, canceling }) => (
    <div data-kind="task" data-task-id={id} data-status={status} data-elapsed={String(elapsedMs)} data-canceling={String(Boolean(canceling))}>
      {title}
      {onCancel && <button type="button" aria-label={`отменить ${id}`} onClick={onCancel} />}
    </div>
  ),
  AgentNoticeView: ({ kind, title, result, errorText, approval }) => (
    <div data-kind="notice" data-notice={kind} data-title={title} data-result={result ?? ""} data-error={errorText ?? ""} {...approvalAttributes(approval)}>
      <ApprovalButtons approval={approval} />
    </div>
  ),
};
