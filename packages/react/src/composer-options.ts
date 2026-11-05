import type { ReactNode } from "react";

/** Optional, skin-independent controls. The host owns context and enabled tool configuration. */
export interface ComposerOptions {
  /** Standard/extended Oduvanchik plus menu. Missing fromDevice preserves File + Image. */
  addMenu?: {
    fromDevice?: { label: string } | false;
    items?: Array<{ id: string; label: string; icon?: ReactNode; onPick: () => void }>;
  };
  variant?: "compact" | "standard" | "extended";
  /** Oduvanchik extended composer: keep only the reasoning icon and caret; the accessible name and tooltip retain the selected level. */
  reasoningChip?: "label" | "icon";
  context?: { label: string; onPick?: () => void };
  projects?: Array<{ id: string; label: string; onPick: () => void }>;
  contextAttachments?: Array<{ id: string; label: string; onRemove?: () => void }>;
  tools?: Array<{ id: string; label: string; description?: string; enabled: boolean; onChange: (enabled: boolean) => void }>;
  /** Display only; server capabilities still govern access to reasoning. */
  reasoningVisibility?: { value: boolean; onChange: (visible: boolean) => void };
}
