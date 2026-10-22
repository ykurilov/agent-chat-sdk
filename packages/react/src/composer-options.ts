/** Optional, skin-independent controls. The host owns context and enabled tool configuration. */
export interface ComposerOptions {
  variant?: "compact" | "standard" | "extended";
  context?: { label: string; onPick?: () => void };
  projects?: Array<{ id: string; label: string; onPick: () => void }>;
  contextAttachments?: Array<{ id: string; label: string; onRemove?: () => void }>;
  tools?: Array<{ id: string; label: string; description?: string; enabled: boolean; onChange: (enabled: boolean) => void }>;
  /** Display only; server capabilities still govern access to reasoning. */
  reasoningVisibility?: { value: boolean; onChange: (visible: boolean) => void };
}
