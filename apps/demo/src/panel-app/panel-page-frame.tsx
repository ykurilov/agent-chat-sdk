import { useAgentPanel } from "@ykurilov/agent-chat-react/panel";
import type { ReactNode } from "react";

export type PanelMode = "overlay" | "push";

/** Рамка страниц демо: в режиме push страница сама отступает от панели на `pageInset`; переключатель режима — в углу. */
export function PanelPageFrame({ mode, onModeChange, children }: { mode: PanelMode; onModeChange: (mode: PanelMode) => void; children: ReactNode }) {
  const { pageInset } = useAgentPanel();
  return (
    <main className="h-full overflow-y-auto p-6" style={{ paddingRight: 24 + pageInset }}>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          aria-pressed={mode === "push"}
          onClick={() => onModeChange(mode === "push" ? "overlay" : "push")}
          className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Страница сдвигается вместе с панелью
        </button>
      </div>
      {children}
    </main>
  );
}
