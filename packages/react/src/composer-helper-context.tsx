import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ComposerHelper } from "./composer-actions";

type Target = { api: string; chatId: string | null; available: boolean };
type Entry = { owner: object; helper: ComposerHelper; api: string; chatId: string };
export function createComposerRegistry() {
  let entry: Entry | null = null;
  const listeners = new Set<() => void>();
  return {
    target: null as Target | null,
    getSnapshot: () => entry,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(next: Entry) { entry = next; for (const listener of listeners) listener(); },
    clear(owner: object) { if (entry?.owner === owner) { entry = null; for (const listener of listeners) listener(); } },
  };
}
export const ComposerRegistryContext = createContext<{ store: ReturnType<typeof createComposerRegistry>; target: Target } | null>(null);
export const PanelComposerBindingContext = createContext(false);
const LocalComposerContext = createContext<{ helper: ComposerHelper | null } | null>(null);
const emptySubscribe = () => () => {};
const emptySnapshot = () => null;

/** Current field, including in custom AgentPanel skin parts. Null without an open, loaded chat with attachments. */
export function useComposerHelper(): ComposerHelper | null {
  const local = useContext(LocalComposerContext);
  const registry = useContext(ComposerRegistryContext);
  const entry = useSyncExternalStore(registry?.store.subscribe ?? emptySubscribe, registry?.store.getSnapshot ?? emptySnapshot, emptySnapshot);
  if (local) return local.helper;
  const target = registry?.target;
  return target?.available && entry?.api === target.api && entry.chatId === target.chatId ? entry.helper : null;
}

/** Commands retained from a previous chat become inert; registry publication does not re-render the panel provider. */
export function ComposerHelperProvider({ api, chatId, enabled, helper, children }: {
  api: string; chatId: string; enabled: boolean; helper: ComposerHelper; children: ReactNode;
}) {
  const outerRegistry = useContext(ComposerRegistryContext);
  const panelBound = useContext(PanelComposerBindingContext);
  const registry = panelBound ? outerRegistry : null;
  const owner = useMemo(() => ({}), [api, chatId, registry?.store]);
  const current = useRef({ owner, enabled, helper, registry });
  current.current = { owner, enabled, helper, registry };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const guarded = useMemo<ComposerHelper>(() => {
    const live = () => {
      const state = current.current;
      if (!mounted.current || state.owner !== owner || !state.enabled) return null;
      const target = state.registry?.store.target;
      if (target && (!target.available || target.api !== api || target.chatId !== chatId)) return null;
      return state.helper;
    };
    return {
      value: helper.value, busy: helper.busy, blocked: helper.blocked, canSend: helper.canSend,
      setValue: (text) => live()?.setValue(text),
      send: (text) => live()?.send(text),
      addFiles: (files) => { const field = live(); if (field?.canSend) field.addFiles(files); },
      addServerFiles: (drafts) => { const field = live(); if (field?.canSend) field.addServerFiles(drafts); },
    };
  }, [owner, api, chatId, helper.value, helper.busy, helper.blocked, helper.canSend]);
  const target = registry?.target;
  const store = registry?.store;
  useEffect(() => {
    if (!store || !enabled || !target?.available || target.api !== api || target.chatId !== chatId) return;
    store.publish({ owner, helper: guarded, api, chatId });
    return () => store.clear(owner);
  }, [store, target?.available, target?.api, target?.chatId, enabled, owner, guarded, api, chatId]);
  const available = enabled && (!registry || (target?.available && target.api === api && target.chatId === chatId));
  const value = useMemo(() => ({ helper: available ? guarded : null }), [available, guarded]);
  return <LocalComposerContext.Provider value={value}>{children}</LocalComposerContext.Provider>;
}
