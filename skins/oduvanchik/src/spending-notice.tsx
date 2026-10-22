import { Alert } from "./primitives/alert";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";

/**
 * Лимит расходов: спокойная справка, пока чат работает, и тёплое предупреждение, когда отправка остановлена. Текст готовит слой поведения.
 * Область для диктора (`role="status"`) стоит в странице всегда и пока пуста: живой регион, появившийся уже с текстом, читают не везде.
 * Фокусируется программно: туда переходит фокус, когда поле ввода стало неактивным.
 */
export function OduvanchikSpendingNotice({ id, state, text }: ComponentProps<NonNullable<ChatSkin["SpendingNotice"]>>) {
  return (
    <div id={id} role="status" tabIndex={-1} className="w-full outline-none" {...(state === "none" ? { "data-spending-empty": "" } : { "data-spending-state": state })}>
      {state !== "none" && (
        // Роль у самой плашки снята: внутри одной области не должно быть второго `status`.
        <Alert role="presentation" variant={state === "exhausted" ? "warm" : "info"} title={text} className="w-full" />
      )}
    </div>
  );
}
