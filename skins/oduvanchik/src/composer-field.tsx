import { useTandemLabels } from "@tandem/ui";
import { PlusIcon, SquareIcon, XIcon, FileTextIcon, ImageIcon, FolderIcon } from "@phosphor-icons/react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, DragEvent, ReactNode } from "react";
import { ComposerSettings } from "./composer-settings";
import { useCrowdedRow } from "./composer-row";

/**
 * Курсор остался внутри поля. `dragleave` приходит и при переходе на дочерний элемент: тогда цель — внутри поля.
 * Если браузер цель не назвал (Safari), решает положение курсора.
 */
function pointerStaysIn(event: DragEvent<HTMLElement>) {
  const next = event.relatedTarget as Node | null;
  if (next) return event.currentTarget.contains(next);
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX > box.left && event.clientX < box.right && event.clientY > box.top && event.clientY < box.bottom;
}

/** `pendingId` — `id` строки «отправим, как только загрузятся файлы»: на неё ссылается занятая кнопка отправки. */
type Props = ComponentProps<ChatSkin["Composer"]> & { mic?: ReactNode; dialogButton?: ReactNode; pendingId?: string };
export function ComposerField(props: Props) {
  const labels = useChatLabels();
  const settings = labels.composerSettings;
  const fileLabels = useTandemLabels("composer");
  const options = props.options ?? {};
  const variant = options.variant ?? "standard";
  const compact = variant === "compact";
  /**
   * Обычное поле — одна строка: «+» слева, текст, справа кнопки и «Отправить»; файлы — над строкой. Расширенному нужен
   * ряд настроек. Тексту в строке осталось бы мало места (много кнопок на узком экране) — `crowded`: текст на всю ширину
   * сверху, «+» и кнопки под ним. Решает фактическая ширина, а не набор кнопок.
   */
  const inline = variant === "standard";
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const crowded = useCrowdedRow(root, (element) => {
    const style = getComputedStyle(element);
    const inner = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.columnGap) || 0;
    const add = addRoot.current?.offsetWidth ?? 0;
    return { inner, controls: add + (bar.current?.offsetWidth ?? 0) + gap * (add ? 2 : 1) };
  }, inline);
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const addRoot = useRef<HTMLDivElement>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [dropping, setDropping] = useState(false);
  const disabled = props.sendingBlocked === true;
  const controlsDisabled = disabled || props.busy;
  useEffect(() => { if (controlsDisabled) { setAddMenu(false); setDropping(false); } }, [controlsDisabled]);
  useEffect(() => {
    if (!addMenu) return;
    const outside = (event: PointerEvent) => { if (!addRoot.current?.contains(event.target as Node)) setAddMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [addMenu]);
  const attachments = props.attachments;
  const deviceMenu = attachments && options.addMenu?.fromDevice !== false;
  const hasAddMenu = deviceMenu || !!options.addMenu?.items?.length || !!options.projects?.length;
  const hasContent = props.value.trim().length > 0 || (attachments?.items.length ?? 0) > 0 || (options.contextAttachments?.length ?? 0) > 0;
  const steering = props.busy && props.canSteer !== undefined;
  const stoppingOnly = props.busy && !steering;
  const canSend = !disabled && (props.busy ? props.canSteer === true : props.canSubmit) && hasContent;
  function resizeField() {
    const element = field.current;
    if (!element) return;
    // A long application placeholder must not turn an empty field into two lines.
    if (props.value.length === 0) { element.style.height = "26px"; return; }
    element.style.height = "auto";
    // A panel keeps its chat mounted while hidden: zero is not a usable measurement.
    if (element.scrollHeight > 0) element.style.height = `${Math.min(160, Math.max(26, element.scrollHeight))}px`;
  }
  useLayoutEffect(resizeField, [props.value, variant]);
  /** Над полем держат файлы (а не текст или данные приложения), и поле может их принять. */
  const acceptsFiles = (event: DragEvent<HTMLElement>) => !compact && !!attachments && !controlsDisabled
    && (event.dataTransfer.files.length > 0 || Array.from(event.dataTransfer.types).includes("Files"));
  // Нажатие уже запомнено и ждёт загрузки файлов: повторное ничего не шлёт.
  const waiting = props.pendingSend !== undefined;
  const submit = () => { if (canSend && !waiting) props.onSubmit(); };
  const pickFile = (accept: string) => { if (controlsDisabled) return; if (files.current) files.current.accept = accept; files.current?.click(); setAddMenu(false); };
  const stop = <button type="button" className="oduvanchik-field-send oduvanchik-field-stop" aria-label={labels.stop}
    disabled={disabled} onClick={props.onStop}><SquareIcon size={15} weight="fill" aria-hidden /></button>;
  // Пока ждём загрузки, кнопка занята, но не неактивна: фокус с неё не слетает, диктор читает строку ожидания.
  const send = <>{steering && stop}{stoppingOnly ? stop : <button type="button" className="oduvanchik-field-send" aria-label={labels.send}
    disabled={!canSend} onClick={submit} aria-busy={waiting || undefined} aria-describedby={waiting ? props.pendingId : undefined}>
    {waiting ? <span className="oduvanchik-send-spinner" aria-hidden /> : <SendArrow />}</button>}</>;
  const addControl = hasAddMenu && <div className="oduvanchik-add" ref={addRoot}>
        <button type="button" className="oduvanchik-field-tool" disabled={controlsDisabled} aria-label={settings.file} aria-expanded={addMenu && !controlsDisabled} onClick={() => setAddMenu(!addMenu)}><PlusIcon size={20} aria-hidden /></button>
        <input ref={files} type="file" hidden multiple disabled={controlsDisabled} accept={attachments?.accept} onChange={(event) => { if (!controlsDisabled && event.target.files?.length) attachments?.onAddFiles(Array.from(event.target.files)); event.target.value = ""; }} />
        {addMenu && !controlsDisabled && <div className="oduvanchik-add-menu">{options.addMenu?.items?.map((item) => <button type="button" key={item.id} data-add-menu-item={item.id} onClick={() => { setAddMenu(false); if (!controlsDisabled) item.onPick(); }}>{item.icon}{item.label}</button>)}{deviceMenu && attachments && (options.addMenu?.fromDevice ? <button type="button" onClick={() => pickFile(attachments.accept)}><FileTextIcon size={16} aria-hidden />{options.addMenu.fromDevice.label}</button> : <><button type="button" onClick={() => pickFile(attachments.accept)}><FileTextIcon size={16} aria-hidden />{settings.file}</button><button type="button" onClick={() => pickFile("image/*")}><ImageIcon size={16} aria-hidden />{settings.image}</button></>)}{options.projects?.map((project) => <button type="button" key={project.id} onClick={() => { if (!controlsDisabled) project.onPick(); setAddMenu(false); }}><FolderIcon size={16} aria-hidden />{project.label}</button>)}</div>}
      </div>;
  return <div ref={root} data-composer-variant={variant} data-crowded={crowded || undefined} data-dropping={dropping || undefined} className={`oduvanchik-field oduvanchik-field-${variant}${inline ? " oduvanchik-field-inline" : ""}`} onKeyDown={(event) => { if (event.key === "Escape") setAddMenu(false); }}
    onDragOver={(event) => { if (acceptsFiles(event)) { event.preventDefault(); setDropping(true); } }}
    onDragLeave={(event) => { if (!pointerStaysIn(event)) setDropping(false); }}
    onDrop={(event) => { setDropping(false); if (compact || !attachments || controlsDisabled || !event.dataTransfer.files.length) return; event.preventDefault(); attachments.onAddFiles(Array.from(event.dataTransfer.files)); }}>
    {!compact && ((attachments?.items.length ?? 0) > 0 || (options.contextAttachments?.length ?? 0) > 0) && <ul className="oduvanchik-field-files" aria-label={fileLabels.attachments}>
      {attachments?.items.map((item) => <li key={item.id}>
        {item.kind === "image" && item.previewUrl ? <img src={item.previewUrl} alt="" /> : <FileTextIcon size={18} aria-hidden />}
        <span>{item.name}{item.status === "uploading" ? ` · ${item.progress === undefined || item.progress >= 1 ? fileLabels.uploading : labels.uploadProgress.percent(percentOf(item.progress))}` : item.status === "error" ? ` · ${fileLabels.uploadFailed}` : ""}</span>
        {item.status === "uploading" && item.progress !== undefined && <span className="oduvanchik-field-progress" role="progressbar" aria-label={labels.uploadProgress.label(item.name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentOf(item.progress)}>
          <span style={{ width: `${percentOf(item.progress)}%` }} />
        </span>}
        <button type="button" disabled={controlsDisabled} aria-label={fileLabels.removeAttachment(item.name)} onClick={() => attachments.onRemove(item.id)}><XIcon size={16} aria-hidden /></button>
      </li>)}
      {options.contextAttachments?.map((item) => <li key={item.id}><FolderIcon size={18} aria-hidden /><span>{item.label}</span>{item.onRemove && <button type="button" disabled={controlsDisabled} aria-label={fileLabels.removeAttachment(item.label)} onClick={item.onRemove}><XIcon size={16} aria-hidden /></button>}</li>)}
    </ul>}
    {dropping && <div className="oduvanchik-field-drop" aria-hidden>{fileLabels.dropToAttach}</div>}
    {/* Тесно — текст встаёт сверху, и «+» в документе идёт после него: Tab проходит поле в том же порядке, что видно. */}
    {inline && !crowded && addControl}
    <textarea ref={field} onFocus={resizeField} rows={1} value={props.value} disabled={disabled} aria-describedby={props.sendingBlockedReasonId} aria-label={labels.composerLabel} placeholder={labels.composerPlaceholder}
      onChange={(event) => props.onValueChange(event.target.value)}
      onPaste={(event) => { if (!compact && attachments && !controlsDisabled && event.clipboardData.files.length) { event.preventDefault(); attachments.onAddFiles(Array.from(event.clipboardData.files)); } }}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); } }} />
    {inline && crowded && addControl}
    {compact ? send : <div ref={bar} className="oduvanchik-field-bar">
      {!inline && addControl}
      {variant === "standard" && options.context && <button type="button" className="oduvanchik-context oduvanchik-label" disabled={controlsDisabled || !options.context.onPick} onClick={options.context.onPick}>@ {options.context.label}</button>}
      {variant === "extended" && <ComposerSettings choice={props.modelChoice} options={options} disabled={controlsDisabled} />}
      {props.actions && <div className="oduvanchik-field-actions">{props.actions}</div>}
      <span className="oduvanchik-field-mic">{props.dialogButton}{props.mic}</span>{send}
    </div>}
  </div>;
}

/** Целый процент. На 100 % сервер ещё разбирает файл, поэтому у имени тогда снова «Загружается…». */
const percentOf = (progress: number) => Math.round(progress * 100);

/**
 * Стрелка кнопки отправки — своим рисунком, а не жирным значком Phosphor: сборка приложения может оставить у Phosphor
 * только обычное и залитое начертание, и тогда жирный значок рисуется пустым — кнопка становится сплошным кругом.
 */
function SendArrow() {
  return <svg width={19} height={19} viewBox="0 0 256 256" fill="currentColor" aria-hidden>
    <path d="M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z" />
  </svg>;
}
