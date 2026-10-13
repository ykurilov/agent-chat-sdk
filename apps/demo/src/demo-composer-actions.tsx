import { Button } from "@tandem/ui";
import type { ComposerHelper } from "@ykurilov/agent-chat-react";
import { ClipboardCheck } from "lucide-react";

/**
 * Своя кнопка у поля ввода: «Проверить работу» отправляет готовую просьбу, как нажатая «Отправить».
 * Во время ответа и при остановке по лимиту кнопка неактивна: те же правила, что у «Отправить».
 * На телефоне ряд под полем тесный, поэтому там остаётся только значок; имя для диктора и тестов — в `aria-label`.
 */
export function demoComposerActions(composer: ComposerHelper) {
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label="Проверить работу"
      disabled={!composer.canSend}
      onClick={() => composer.send("Проверь мою работу")}
    >
      <ClipboardCheck aria-hidden />
      <span className="max-[30rem]:hidden">Проверить работу</span>
    </Button>
  );
}
