import { Alert } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";

/**
 * Чат закрыт: спокойная справка над неактивным полем ввода словами приложения (только текст). `tabIndex={-1}` нужен:
 * когда поле ввода становится неактивным, `OduvanchikComposer` переводит фокус на этот элемент (по `id`), иначе фокус
 * пропадает на страницу. На него же ссылается поле через `aria-describedby`.
 */
export function OduvanchikChatClosedNotice({ id, code, message }: ComponentProps<NonNullable<ChatSkin["ChatClosedNotice"]>>) {
  return (
    <div id={id} role="status" tabIndex={-1} data-closed-code={code} className="w-full outline-none">
      {/* У `Alert` своя роль `status`; она снята, иначе внутри области `status` вложена была бы вторая. */}
      <Alert role="presentation" variant="info" title={message} className="w-full" />
    </div>
  );
}
