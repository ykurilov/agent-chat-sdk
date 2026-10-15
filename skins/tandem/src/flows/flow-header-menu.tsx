import { Button } from "@tandem/ui";
import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface FlowHeaderMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Выбранный пункт-переключатель (полный экран). */
  pressed?: boolean;
  onSelect(): void;
}

/**
 * Меню «⋯» шапки на узком экране: сюда уходят кнопки, которым не хватило места. Кнопка и список доступны с клавиатуры:
 * Enter, пробел и стрелка вниз открывают; стрелки, Home и End ходят по пунктам; Esc закрывает и возвращает фокус на кнопку;
 * Tab и клик в сторону закрывают.
 */
export function FlowHeaderMenu({ label, items, className }: { label: string; items: FlowHeaderMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const entries = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const away = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      // Esc закрывает только меню, а не полный экран под ним.
      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      close(true);
      return;
    }
    if (!open) return;
    const list = entries();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(-1);
    else if (event.key === "Tab") close(false);
  };

  return (
    <div ref={root} className={className} onKeyDown={onKeyDown} data-flow-header-menu="">
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-1 flex min-w-[220px] flex-col rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md,var(--shadow-sm))]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-pressed={item.pressed ? "" : undefined}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className="flex h-10 items-center gap-2 rounded-[var(--radius-small)] px-3 text-left text-sm text-[var(--foreground)] hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none disabled:opacity-45 data-[pressed]:font-semibold"
            >
              <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
