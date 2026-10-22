import { useTandemLabels } from "@tandem/ui";
import { ArrowUpIcon, PlusIcon, SquareIcon, XIcon, FileTextIcon, ImageIcon, FolderIcon } from "@phosphor-icons/react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { ComposerSettings } from "./composer-settings";

type Props = ComponentProps<ChatSkin["Composer"]> & { mic?: ReactNode; dialogButton?: ReactNode };
export function ComposerField(props: Props) {
  const labels = useChatLabels();
  const settings = labels.composerSettings;
  const fileLabels = useTandemLabels("composer");
  const options = props.options ?? {};
  const variant = options.variant ?? "standard";
  const compact = variant === "compact";
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const addRoot = useRef<HTMLDivElement>(null);
  const [addMenu, setAddMenu] = useState(false);
  const disabled = props.sendingBlocked === true;
  const controlsDisabled = disabled || props.busy;
  useEffect(() => { if (controlsDisabled) setAddMenu(false); }, [controlsDisabled]);
  useEffect(() => {
    if (!addMenu) return;
    const outside = (event: PointerEvent) => { if (!addRoot.current?.contains(event.target as Node)) setAddMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [addMenu]);
  const attachments = props.attachments;
  const hasContent = props.value.trim().length > 0 || (attachments?.items.length ?? 0) > 0 || (options.contextAttachments?.length ?? 0) > 0;
  const canSend = !disabled && !props.busy && props.canSubmit && hasContent;
  function resizeField() {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    // A panel keeps its chat mounted while hidden: zero is not a usable measurement.
    if (element.scrollHeight > 0) element.style.height = `${Math.min(180, element.scrollHeight)}px`;
  }
  useLayoutEffect(resizeField, [props.value, variant]);
  const submit = () => { if (canSend) props.onSubmit(); };
  const pickFile = (accept: string) => { if (controlsDisabled) return; if (files.current) files.current.accept = accept; files.current?.click(); setAddMenu(false); };
  const send = <button type="button" className={`oduvanchik-field-send ${props.busy ? "oduvanchik-field-stop" : ""}`} aria-label={props.busy ? labels.stop : labels.send}
    disabled={disabled || (!props.busy && !canSend)} onClick={props.busy ? props.onStop : submit}>{props.busy ? <SquareIcon size={15} weight="fill" aria-hidden /> : <ArrowUpIcon size={19} aria-hidden />}</button>;
  return <div data-composer-variant={variant} className={`oduvanchik-field oduvanchik-field-${variant}`} onKeyDown={(event) => { if (event.key === "Escape") setAddMenu(false); }}
    onDragOver={(event) => { if (!compact && attachments && !controlsDisabled) event.preventDefault(); }}
    onDrop={(event) => { if (compact || !attachments || controlsDisabled) return; event.preventDefault(); if (event.dataTransfer.files.length) attachments.onAddFiles(Array.from(event.dataTransfer.files)); }}>
    {!compact && ((attachments?.items.length ?? 0) > 0 || (options.contextAttachments?.length ?? 0) > 0) && <ul className="oduvanchik-field-files" aria-label={fileLabels.attachments}>
      {attachments?.items.map((item) => <li key={item.id}>
        {item.kind === "image" && item.previewUrl ? <img src={item.previewUrl} alt="" /> : <FileTextIcon size={18} aria-hidden />}
        <span>{item.name}{item.status === "uploading" ? ` · ${fileLabels.uploading}` : item.status === "error" ? ` · ${fileLabels.uploadFailed}` : ""}</span>
        <button type="button" disabled={controlsDisabled} aria-label={fileLabels.removeAttachment(item.name)} onClick={() => attachments.onRemove(item.id)}><XIcon size={16} aria-hidden /></button>
      </li>)}
      {options.contextAttachments?.map((item) => <li key={item.id}><FolderIcon size={18} aria-hidden /><span>{item.label}</span>{item.onRemove && <button type="button" disabled={controlsDisabled} aria-label={fileLabels.removeAttachment(item.label)} onClick={item.onRemove}><XIcon size={16} aria-hidden /></button>}</li>)}
    </ul>}
    <textarea ref={field} onFocus={resizeField} rows={1} value={props.value} disabled={disabled} aria-describedby={props.sendingBlockedReasonId} aria-label={labels.composerLabel} placeholder={labels.composerPlaceholder}
      onChange={(event) => props.onValueChange(event.target.value)}
      onPaste={(event) => { if (!compact && attachments && !controlsDisabled && event.clipboardData.files.length) { event.preventDefault(); attachments.onAddFiles(Array.from(event.clipboardData.files)); } }}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); } }} />
    {compact ? send : <div className="oduvanchik-field-bar">
      {(attachments || options.projects?.length) ? <div className="oduvanchik-add" ref={addRoot}>
        <button type="button" className="oduvanchik-field-tool" disabled={controlsDisabled} aria-label={settings.file} aria-expanded={addMenu && !controlsDisabled} onClick={() => setAddMenu(!addMenu)}><PlusIcon size={20} aria-hidden /></button>
        <input ref={files} type="file" hidden multiple disabled={controlsDisabled} accept={attachments?.accept} onChange={(event) => { if (!controlsDisabled && event.target.files?.length) attachments?.onAddFiles(Array.from(event.target.files)); event.target.value = ""; }} />
        {addMenu && !controlsDisabled && <div className="oduvanchik-add-menu">{attachments && <><button type="button" onClick={() => pickFile(attachments.accept)}><FileTextIcon size={16} aria-hidden />{settings.file}</button><button type="button" onClick={() => pickFile("image/*")}><ImageIcon size={16} aria-hidden />{settings.image}</button></>}{options.projects?.map((project) => <button type="button" key={project.id} onClick={() => { if (!controlsDisabled) project.onPick(); setAddMenu(false); }}><FolderIcon size={16} aria-hidden />{project.label}</button>)}</div>}
      </div> : null}
      {variant === "standard" && options.context && <button type="button" className="oduvanchik-context oduvanchik-label" disabled={controlsDisabled || !options.context.onPick} onClick={options.context.onPick}>@ {options.context.label}</button>}
      {variant === "extended" && <ComposerSettings choice={props.modelChoice} options={options} disabled={controlsDisabled} />}
      {props.actions && <div className="oduvanchik-field-actions">{props.actions}</div>}
      <span className="oduvanchik-field-mic">{props.dialogButton}{props.mic}</span>{send}
    </div>}
  </div>;
}
