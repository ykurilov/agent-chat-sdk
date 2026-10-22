import { CaretDownIcon, CheckIcon, CpuIcon, BrainIcon, WrenchIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ComposerOptions, ModelChoiceView } from "@ykurilov/agent-chat-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useScreenQuery } from "./screen-width";

type Section = "model" | "reasoning" | "tools";
export function ComposerSettings({ choice, options, disabled }: { choice?: ModelChoiceView; options: ComposerOptions; disabled: boolean }) {
  const labels = useChatLabels().composerSettings;
  const [open, setOpen] = useState<Section | null>(null);
  const [query, setQuery] = useState("");
  const mobile = useScreenQuery("(max-width: 640px)", false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const providers = choice?.providers ?? [];
  const currentProvider = providers.find((provider) => provider.id === choice?.current.providerId);
  const currentModel = currentProvider?.models.find((model) => model.id === choice?.current.modelId);
  const all = new Map<string, ModelChoiceView["providers"][number]["models"][number]>();
  providers.forEach((provider) => provider.models.forEach((model) => { if (!all.has(model.id) || provider.id === currentProvider?.id) all.set(model.id, model); }));
  const filtered = [...all.values()].filter((model) => `${model.name} ${model.description ?? ""} ${model.tags?.join(" ") ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const groupOf = (model: typeof filtered[number]) => model.group ?? (model.acceptsImages === true ? labels.imageModels : model.acceptsImages === false ? labels.textModels : labels.models);
  const groups = [...new Set(filtered.map(groupOf))];
  const via = providers.filter((provider) => provider.models.some((model) => model.id === choice?.current.modelId));
  const close = () => { setOpen(null); trigger.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(null); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(null); previous?.focus(); }
      if (mobile && event.key === "Tab") {
        const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, mobile]);
  const show = (section: Section, button: HTMLButtonElement) => { trigger.current = button; setQuery(""); setOpen(open === section ? null : section); };
  const chooseModel = (modelId: string) => {
    if (disabled || !choice) return;
    const provider = providers.find((candidate) => candidate.id === choice.current.providerId && candidate.models.some((model) => model.id === modelId)) ?? providers.find((candidate) => candidate.models.some((model) => model.id === modelId));
    if (provider) choice.onChange({ providerId: provider.id, modelId });
  };
  const providerControls = <div className="oduvanchik-via"><span className="oduvanchik-label">{labels.via}</span><div role="group" aria-label={labels.via} className="oduvanchik-segment">{via.map((provider) => <button type="button" key={provider.id} disabled={disabled} aria-pressed={provider.id === choice?.current.providerId} onClick={() => { if (!disabled && choice) choice.onChange({ providerId: provider.id, modelId: choice.current.modelId }); }}>{provider.name}</button>)}</div></div>;
  const modelControls = <>
    <label className="oduvanchik-model-search"><MagnifyingGlassIcon size={18} aria-hidden /><input type="search" aria-label={labels.search} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {groups.map((group) => <section key={group}><p className="oduvanchik-label oduvanchik-settings-group">{group}</p>{filtered.filter((model) => groupOf(model) === group).map((model) => <Fragment key={model.id}>
      <button type="button" className="oduvanchik-model-option" disabled={disabled} aria-pressed={model.id === choice?.current.modelId} onClick={() => chooseModel(model.id)}>
        <span className="oduvanchik-model-copy"><b>{model.name}</b>{model.description && <small>{model.description}</small>}</span>
        <span className="oduvanchik-model-tags">{model.price && <span className="oduvanchik-tag" title={`${labels.price}: ${labels.input} / ${labels.output}`}>${model.price.inputPerMillion} / ${model.price.outputPerMillion}</span>}{model.acceptsImages && <span className="oduvanchik-tag">{labels.image}</span>}{model.tags?.map((tag) => <span className="oduvanchik-tag" key={tag}>{tag}</span>)}</span>
        <span className="oduvanchik-model-check">{model.id === choice?.current.modelId && <CheckIcon size={16} aria-hidden />}</span>
      </button>{!mobile && model.id === choice?.current.modelId && providerControls}
    </Fragment>)}</section>)}
    {filtered.length === 0 && <p className="oduvanchik-settings-empty">{labels.noResults}</p>}
  </>;
  const reasoningControls = <section className="oduvanchik-settings-section"><p className="oduvanchik-label">{labels.reasoning}</p>
    <div role="group" aria-label={labels.reasoning} className="oduvanchik-segment oduvanchik-segment-wide">{choice?.reasoningLevels.map((level) => <button type="button" key={level.id} aria-pressed={level.id === choice.reasoning} disabled={disabled} onClick={() => { if (!disabled) choice.onReasoningChange(level.id); }}>{labels.levels[level.id] ?? level.name}</button>)}</div>
    {options.reasoningVisibility && <label className="oduvanchik-setting-switch"><span>{labels.showReasoning}</span><input type="checkbox" role="switch" checked={options.reasoningVisibility.value} disabled={disabled} onChange={(event) => { if (!disabled) options.reasoningVisibility?.onChange(event.target.checked); }} /></label>}
  </section>;
  const toolControls = <section className="oduvanchik-settings-section"><p className="oduvanchik-label">{labels.tools}</p>{options.tools?.map((tool) => <label className="oduvanchik-setting-switch" key={tool.id}><span>{tool.label}{tool.description && <small>{tool.description}</small>}</span><input type="checkbox" role="switch" checked={tool.enabled} disabled={disabled} onChange={(event) => { if (!disabled) tool.onChange(event.target.checked); }} /></label>)}</section>;
  return <div className="oduvanchik-settings" ref={root}>
    {choice && <button type="button" className="oduvanchik-chip oduvanchik-chip-model" aria-label={`${labels.model}: ${currentModel?.name ?? labels.model}`} disabled={disabled || !providers.length} aria-expanded={open === "model"} aria-controls={id} onClick={(event) => show("model", event.currentTarget)}><CpuIcon size={16} aria-hidden /><span>{currentModel?.name ?? labels.model}</span><CaretDownIcon className="oduvanchik-chip-caret" size={12} aria-hidden /></button>}
    {(choice?.reasoningLevels.length || options.reasoningVisibility) ? <button type="button" className="oduvanchik-chip oduvanchik-chip-reasoning" aria-label={labels.reasoning} disabled={disabled} aria-expanded={open === "reasoning"} aria-controls={id} onClick={(event) => show("reasoning", event.currentTarget)}><BrainIcon size={16} aria-hidden /><span>{(choice?.reasoning && labels.levels[choice.reasoning]) || choice?.reasoningLevels.find((level) => level.id === choice.reasoning)?.name || labels.reasoning}</span><CaretDownIcon className="oduvanchik-chip-caret" size={12} aria-hidden /></button> : null}
    {options.tools && <button type="button" className="oduvanchik-chip oduvanchik-chip-tools" aria-label={labels.tools} disabled={disabled} aria-expanded={open === "tools"} aria-controls={id} onClick={(event) => show("tools", event.currentTarget)}><WrenchIcon size={16} aria-hidden /><span className="oduvanchik-label">{options.tools.filter((tool) => tool.enabled).length}</span><CaretDownIcon className="oduvanchik-chip-caret" size={12} aria-hidden /></button>}
    {open && !disabled && <>
      {mobile && <div className="oduvanchik-settings-dim" onClick={close} />}
      <div id={id} ref={panel} role="dialog" aria-modal={mobile || undefined} aria-label={mobile ? labels.settings : labels[open]} className={`oduvanchik-settings-panel ${mobile ? "oduvanchik-settings-sheet" : ""}`}>
        {mobile && <><div className="oduvanchik-sheet-grip" /><header><b>{labels.settings}</b><button type="button" onClick={close}>{labels.done}</button></header></>}
        {(mobile || open === "model") && choice && modelControls}
        {mobile && choice && providerControls}
        {(mobile || open === "reasoning") && reasoningControls}
        {(mobile || open === "tools") && options.tools && toolControls}
      </div>
    </>}
  </div>;
}
