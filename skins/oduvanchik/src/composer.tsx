import { Button } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ComposerField as Composer } from "./composer-field";
import { Square } from "./icons";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { useFollowDictation, useKeepCaretWhilePolishing } from "./dictation-follow";
import { OduvanchikVoiceButton } from "./voice-button";
import { OduvanchikVoiceDialogButton } from "./voice-dialog-button";
import { OduvanchikVoiceDialogPanel } from "./voice-dialog-panel";
import { OduvanchikSkinLabels } from "./tandem-labels";

/**
 * Поле `Composer` из Тандема не принимает `aria-describedby`, а неактивное поле роняет фокус на страницу.
 * Поэтому связь с надписью и перенос фокуса делаются здесь, через DOM: остановка отправки → фокус на надпись
 * (`reasonId`), снятие остановки → обратно в поле, если фокус никто не увёл.
 */
function useBlockedReason(sendingBlocked: boolean, reasonId: string | undefined) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fieldFocused = useRef(false);
  const restoreFocus = useRef<string | null>(null);
  const field = () => wrapperRef.current?.querySelector("textarea") ?? null;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onFocusIn = (event: FocusEvent) => {
      if (event.target === field()) fieldFocused.current = true;
    };
    const onFocusOut = (event: FocusEvent) => {
      // Неактивное поле теряет фокус само: это не уход человека.
      if (event.target === field() && !(event.target as HTMLTextAreaElement).disabled) fieldFocused.current = false;
    };
    wrapper.addEventListener("focusin", onFocusIn);
    wrapper.addEventListener("focusout", onFocusOut);
    return () => {
      wrapper.removeEventListener("focusin", onFocusIn);
      wrapper.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Без списка зависимостей: поле могло быть перерисовано заново.
  useLayoutEffect(() => {
    const textarea = field();
    if (!textarea) return;
    if (sendingBlocked && reasonId) textarea.setAttribute("aria-describedby", reasonId);
    else textarea.removeAttribute("aria-describedby");
  });

  useLayoutEffect(() => {
    const textarea = field();
    if (sendingBlocked) {
      if (!fieldFocused.current) return;
      fieldFocused.current = false;
      const reason = reasonId ? document.getElementById(reasonId) : null;
      if (!reason) return;
      reason.focus();
      restoreFocus.current = reasonId ?? null;
      return;
    }
    // Причина при снятии остановки уже не приходит, поэтому её `id` запомнен с момента остановки.
    if (!restoreFocus.current) return;
    const active = document.activeElement;
    const reason = document.getElementById(restoreFocus.current);
    restoreFocus.current = null;
    // Фокус всё ещё на надписи (или нигде): вернуть в поле. Ушёл в другое место — не трогать.
    if (textarea && (active === document.body || active === null || (reason !== null && active === reason))) textarea.focus();
  }, [sendingBlocked, reasonId]);

  return wrapperRef;
}

/** The same native field stays mounted as configuration and voice arrive. */
export function OduvanchikComposer(props: ComponentProps<ChatSkin["Composer"]>) {
  const { value, voice, dialog, actions, busy, onStop, sendingBlocked, sendingBlockedReasonId } = props;
  const labels = useChatLabels();
  const wrapperRef = useBlockedReason(sendingBlocked === true, sendingBlockedReasonId);
  useFollowDictation(wrapperRef, value, voice !== undefined && voice.state !== "idle");
  useKeepCaretWhilePolishing(wrapperRef, value, voice?.polishing === true);
  const dialogOn = dialog !== undefined && dialog.state !== "off";
  const compact = props.options?.variant === "compact";
  return <OduvanchikSkinLabels><div ref={wrapperRef} className="oduvanchik-composer flex flex-col gap-1">
    <div hidden={dialogOn}>
      <Composer {...props} mic={!compact && voice && <OduvanchikVoiceButton voice={voice} />} dialogButton={!compact && dialog && <OduvanchikVoiceDialogButton dialog={dialog} />} />
    </div>
    {dialog && <OduvanchikVoiceDialogPanel dialog={dialog} />}
    {dialogOn && actions}
    {dialogOn && busy && <Button variant="secondary" aria-label={labels.stop} onClick={onStop}><Square weight="fill" aria-hidden /></Button>}
    {props.attachments?.notice && <p role="alert" className="text-sm text-[var(--destructive-text)]">{props.attachments.notice}</p>}
    {props.modelChoice?.error && <p role="status" className="text-sm text-[var(--destructive-text)]">{props.modelChoice.error}</p>}
    {voice?.error && <p role="status" className="text-sm text-[var(--destructive-text)]">{voice.error}</p>}
  </div></OduvanchikSkinLabels>;
}
