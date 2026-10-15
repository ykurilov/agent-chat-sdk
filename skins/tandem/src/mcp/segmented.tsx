import { cn } from "@tandem/ui";

/** Выбор одного из нескольких: ряд кнопок-переключателей. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Array<{ value: T; title: string }>;
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-[var(--radius-small)] bg-[var(--surface-muted)] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          onClick={() => option.value !== value && onChange(option.value)}
          className={cn(
            "rounded-[var(--radius-small)] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
            option.value === value ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
          )}
        >
          {option.title}
        </button>
      ))}
    </div>
  );
}
