import { cn } from "@tandem/ui";
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { TOUCH_TARGET } from "./widget-frame";

export interface RadioOption<T> {
  value: T;
  /** Что видно на кнопке. */
  content: ReactNode;
  /** Имя для диктора, если видимого текста мало (звезда). */
  ariaLabel?: string;
  checked: boolean;
}

const NEXT_KEYS = new Set(["ArrowDown", "ArrowRight"]);
const PREVIOUS_KEYS = new Set(["ArrowUp", "ArrowLeft"]);

/**
 * Группа вариантов «выбрать один» (WAI-ARIA radiogroup): в группу попадает один вариант по Tab, стрелки двигают фокус
 * по кругу, Enter и пробел отвечают, как и нажатие. Варианты — не кнопки: у кнопки Enter сам вызывает нажатие,
 * и ответ ушёл бы дважды. Без `onPick` варианты видны, но не нажимаются.
 */
export function RadioOptions<T>({
  labelledBy,
  options,
  onPick,
  layout,
  optionClassName,
}: {
  labelledBy: string;
  options: RadioOption<T>[];
  onPick?: (value: T) => void;
  layout: "rows" | "inline";
  optionClassName?: (option: RadioOption<T>) => string;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const focusable = Math.max(0, options.findIndex((option) => option.checked));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      refs.current[(index + step + options.length) % options.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      refs.current[event.key === "Home" ? 0 : options.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick?.(options[index]!.value);
    }
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={layout === "rows" ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>
      {options.map((option, index) => (
        <div
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          role="radio"
          aria-checked={option.checked}
          aria-disabled={onPick ? undefined : true}
          aria-label={option.ariaLabel}
          tabIndex={index === focusable ? 0 : -1}
          style={TOUCH_TARGET}
          onClick={() => onPick?.(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            "tandem-focus flex min-w-11 select-none items-center rounded-[var(--radius-control)] border px-3 py-2 transition-colors duration-[var(--motion-fast)]",
            option.checked
              ? "border-[var(--action)] bg-[var(--action)] text-[var(--action-foreground)]"
              : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--foreground)]",
            onPick ? "cursor-pointer hover:border-[var(--border-strong)]" : "cursor-default",
            !onPick && !option.checked && "opacity-60",
            optionClassName?.(option),
          )}
        >
          {option.content}
        </div>
      ))}
    </div>
  );
}
