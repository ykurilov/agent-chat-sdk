import { Button, Composer, Tooltip } from "@tandem/ui";
import type { ChatSkin, ModelChoiceView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ComponentProps } from "react";
import { useFollowDictation, useKeepCaretWhilePolishing } from "./dictation-follow";
import { TandemVoiceButton } from "./voice-button";
import { TandemVoiceDialogButton } from "./voice-dialog-button";
import { TandemVoiceDialogPanel } from "./voice-dialog-panel";
import { TandemSkinLabels } from "./tandem-labels";

/** Меню провайдеров и подменю моделей стоят рядом и вместе шире узкого экрана телефона. */
const narrowScreenQuery = "(max-width: 30rem)";

function subscribeToScreenWidth(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(narrowScreenQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isNarrowScreen(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(narrowScreenQuery).matches;
}

/**
 * Поле с выбором модели всегда рисует кнопку выбора; пока список моделей не пришёл (или его нет), там остался бы
 * пустой «Выберите модель». Это кнопка с меню прямо в нижнем ряду рамки (кнопки приложения и голос — глубже).
 */
const hideModelPicker = "[&_textarea~div>button[aria-haspopup=menu]]:hidden!";

/**
 * Без меню и вложений нижний ряд рамки пуст, кроме кнопок справа: поле в одну строку, как простое поле Тандема.
 * Простое поле (`variant="minimal"`) не берётся: у него другое дерево, и при появлении меню поле пересоздалось бы —
 * набранный в этот миг текст ушёл бы в удалённое поле, фокус пропал бы.
 */
const singleRowFrame = "flex items-end gap-2 [&>textarea~div]:mt-0";

/**
 * Один список «модель · провайдер» вместо провайдеров с подменю: для узкого экрана.
 * Идентификатор пункта составной; по нему находится пара, которую вернуть слою поведения.
 */
function flatModelChoice(modelChoice: ModelChoiceView) {
  const pairs = new Map<string, { providerId: string; modelId: string }>();
  const models = modelChoice.providers.flatMap((provider) =>
    provider.models.map((model) => {
      const id = `${provider.id}\u0000${model.id}`;
      pairs.set(id, { providerId: provider.id, modelId: model.id });
      return { id, name: `${model.name} · ${provider.name}` };
    }),
  );
  const current = `${modelChoice.current.providerId}\u0000${modelChoice.current.modelId}`;
  return { models, current, onChange: (id: string) => modelChoice.onChange(pairs.get(id)!) };
}

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

/**
 * Кнопки приложения в нижнем ряду рамки: на узком экране ряд (скрепка, модель, голос, «Отправить») и так занят,
 * поэтому у них потолок ширины и длинная подпись обрезается с конца (приложению лучше дать короткую подпись), а не выталкивает «Отправить» за рамку.
 * Прижатие к левому краю — только для широких элементов; кнопка-значок (класс `size-…`) остаётся по центру.
 */
const actionsClass = "flex min-w-0 shrink items-center gap-1 max-[30rem]:max-w-24 [&>*]:min-w-0 [&>*]:shrink [&>*:not([class*=size-])]:justify-start [&>*]:overflow-hidden";

/**
 * Поле ввода Тандема; пока идёт ответ, «Отправить» в рамке заменяется родной кнопкой «Стоп» из Composer. Поле принимает
 * поправки (`canSteer` есть) — в рамке остаётся «Отправить», а «Стоп» стоит в нижнем ряду рамки рядом с ней.
 * Поле одно и то же при любых поздних частях (меню моделей, уровни рассуждений, вложения, голос, кнопки, лимит):
 * вариант `extended` или `full` с тем же деревом, без меню — в одну строку. Черновик и фокус не теряются.
 */
export function TandemComposer({
  value,
  onValueChange,
  onSubmit,
  busy,
  canSteer,
  onStop,
  modelChoice,
  attachments,
  voice,
  dialog,
  actions,
  sendingBlocked,
  sendingBlockedReasonId,
}: ComponentProps<ChatSkin["Composer"]>) {
  const labels = useChatLabels();
  const wrapperRef = useBlockedReason(sendingBlocked === true, sendingBlockedReasonId);
  useFollowDictation(wrapperRef, value, voice !== undefined && voice.state !== "idle");
  useKeepCaretWhilePolishing(wrapperRef, value, voice?.polishing === true);
  const dialogOn = dialog !== undefined && dialog.state !== "off";
  const steering = busy && canSteer !== undefined;
  const narrow = useSyncExternalStore(subscribeToScreenWidth, isNarrowScreen, () => false);
  // На узком экране ряд рамки занят до края: на время поправок кнопка голосового режима уступает место «Стопу».
  const dialogButtonShown = dialog !== undefined && !(steering && narrow && !dialogOn);
  // В режиме голоса поля в рамке нет (оно скрыто), поэтому «Стоп» остаётся отдельной кнопкой рядом с панелью режима.
  const stopButton = (
    <Tooltip label={labels.stop}>
      <Button variant="secondary" size="icon" aria-label={labels.stop} onClick={onStop} className="shrink-0">
        <Square className="fill-current" />
      </Button>
    </Tooltip>
  );
  const common = {
    className: "min-w-0 flex-1",
    value,
    onValueChange,
    onSubmit: () => onSubmit(),
    // Поправка во время ответа: рамка отправляет как обычно, «Стоп» — отдельной кнопкой в нижнем ряду рядом с «Отправить».
    busy: busy && !steering,
    onStop,
    disabled: sendingBlocked === true,
    // Голос идёт прямо в поле, поэтому вместо встроенной записи Тандема (полоски вместо текста) микрофон — наш, в нижнем ряду рамки.
    // Кнопки приложения стоят рядом с голосом. В режиме голоса поле скрыто вместе с рамкой, и они переезжают к панели режима.
    actions: (voice || dialogButtonShown || actions || steering) && (
      <>
        {voice && <TandemVoiceButton voice={voice} />}
        {dialogButtonShown && <TandemVoiceDialogButton dialog={dialog} />}
        {!dialogOn && actions && <div className={actionsClass}>{actions}</div>}
        {steering && !dialogOn && stopButton}
      </>
    ),
  };
  const flat = useMemo(() => (modelChoice && narrow ? flatModelChoice(modelChoice) : null), [modelChoice, narrow]);
  const hasMenu = modelChoice !== undefined && modelChoice.providers.length > 0;
  const modelProps = flat
    ? { models: flat.models, model: flat.current, onModelChange: flat.onChange }
    : hasMenu
      ? {
          providers: modelChoice.providers,
          model: { provider: modelChoice.current.providerId, model: modelChoice.current.modelId },
          onModelChange: ({ provider, model }: { provider: string; model: string }) =>
            modelChoice.onChange({ providerId: provider, modelId: model }),
        }
      : null;
  const noop = () => undefined;
  const modelFields = {
    ...(modelProps ?? { providers: [], model: { provider: "", model: "" }, onModelChange: noop }),
    ...(hasMenu && {
      reasoningOptions: modelChoice.reasoningLevels.length > 0 ? modelChoice.reasoningLevels : undefined,
      reasoning: modelChoice.reasoning,
      onReasoningChange: modelChoice.onReasoningChange,
    }),
  };
  // Пока режим включён, вместо поля стоит панель режима. Поле только скрыто: черновик и его состояние остаются, клавиатура не выезжает.
  return (
    <TandemSkinLabels>
      <div ref={wrapperRef} className="flex flex-col gap-1 max-sm:[&_textarea]:text-base">
        <div className={`flex items-end gap-2 ${hasMenu ? "" : hideModelPicker}`}>
          <div hidden={dialogOn} className={dialogOn ? "hidden" : "flex min-w-0 flex-1"}>
            {attachments ? (
              <Composer
                {...common}
                variant="full"
                {...modelFields}
                attachments={attachments.items}
                onAddFiles={attachments.onAddFiles}
                onRemoveAttachment={attachments.onRemove}
                accept={attachments.accept}
              />
            ) : (
              <Composer {...common} {...(!hasMenu && { className: `${common.className} ${singleRowFrame}` })} variant="extended" {...modelFields} />
            )}
          </div>
          {dialogOn && <TandemVoiceDialogPanel dialog={dialog} />}
          {dialogOn && actions && <div className={`${actionsClass} self-center`}>{actions}</div>}
          {busy && dialogOn && <div className="shrink-0 self-center">{stopButton}</div>}
        </div>
        {dialog && !dialogOn && <TandemVoiceDialogPanel dialog={dialog} />}
        {attachments?.notice && (
          <p role="alert" className="px-2 text-sm text-[var(--destructive-text)]">
            {attachments.notice}
          </p>
        )}
        {modelChoice?.error && (
          <p role="status" className="px-2 text-sm text-[var(--destructive-text)]">
            {modelChoice.error}
          </p>
        )}
        {voice?.error && (
          <p role="status" className="px-2 text-sm text-[var(--destructive-text)]">
            {voice.error}
          </p>
        )}
      </div>
    </TandemSkinLabels>
  );
}
