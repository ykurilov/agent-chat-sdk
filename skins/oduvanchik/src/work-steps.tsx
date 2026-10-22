import { Sphere } from "@ykurilov/ds-react";
import { Button, cn } from "@tandem/ui";
import type { WorkStepsView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Check, X, ChevronDown } from "./icons";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { OduvanchikStepIcon } from "./step-icon";

/** Промежуток между значками ряда (`gap-1`), px. */
const GAP_PX = 4;

/**
 * Сколько значков ряда показать на `available` px из `total` шагов (значок — `iconPx`): все, если влезают; иначе
 * столько, чтобы рядом поместилось «+N» (`plusWidthOf(скрыто)`). Не влезает и одно «+N» — `null`: ряда нет, число
 * шагов и так в подписи.
 */
export function visibleStepIcons(available: number, total: number, plusWidthOf: (hidden: number) => number, iconPx = 14): number | null {
  const iconsWidth = (count: number) => count * iconPx + Math.max(0, count - 1) * GAP_PX;
  if (iconsWidth(total) <= available) return total;
  for (let count = total - 1; count > 0; count--) if (iconsWidth(count) + GAP_PX + plusWidthOf(total - count) <= available) return count;
  return plusWidthOf(total) <= available ? 0 : null;
}

/** Замер ряда: место, ширина значка (кнопка Тандема делает значки 16 px) и ширина знака «+N». */
interface IconRowSpace {
  space: number;
  iconPx: number;
  charPx: number;
}

/**
 * Место для ряда значков: ширина строки шагов минус подпись и стрелка кнопки. Меряется по строке и ряду (`ResizeObserver`);
 * до замера и без размеров (сборка на сервере, тесты без вёрстки) — `null`, ряд целиком.
 */
function useIconRowSpace() {
  const lineRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState<IconRowSpace | null>(null);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Кнопка — первый элемент строки (у кнопки Тандема нет `ref`).
      const button = line.firstElementChild;
      const row = rowRef.current;
      if (!button || !row || line.clientWidth === 0) return;
      // Кнопка не шире строки (`max-w-full`); остальное в ней — подпись, стрелка, отступы. Запас 4 px — на округление.
      const rest = button.getBoundingClientRect().width - row.getBoundingClientRect().width;
      const icon = row.querySelector("svg")?.getBoundingClientRect().width;
      const more = row.querySelector("[data-step-icons-more]");
      const moreText = more?.textContent ?? "";
      setMeasured((previous) => {
        const next = {
          space: Math.max(0, line.clientWidth - rest - 4),
          iconPx: icon || previous?.iconPx || 16,
          // Знак «+N» с запасом в 1 px: «+N» всегда влезает.
          charPx: more && moreText ? more.getBoundingClientRect().width / moreText.length + 1 : (previous?.charPx ?? 8),
        };
        return previous && previous.space === next.space && previous.iconPx === next.iconPx && previous.charPx === next.charPx ? previous : next;
      });
    };
    measure();
    // Строка — смена ширины колонки; ряд — подпись стала шире (шрифт догрузился, число шагов выросло) и сжала ряд.
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []);
  return { lineRef, rowRef, measured };
}

/**
 * Простой вид работы агента (договор 23, значки — 28). Пока ход идёт — тихая живая строка со значком текущего шага,
 * смена фразы плавная. Диктор слышит одно постоянное «Работаю…»: фразы меняются часто и от него скрыты.
 * После хода — строка «Сделано N шагов» в стиле «Думал N сек» и ряд значков шагов («+N» — не влезли); по нажатию —
 * список «значок + фраза», неудачный шаг тусклее. Ряд — в одну строку: сколько значков влезает, решает ширина строки,
 * остальные — в «+N», которое помещается всегда (0.69.1: в узкой колонке ряд вылезал за край).
 */
export function OduvanchikWorkSteps(view: WorkStepsView) {
  const labels = useChatLabels();
  const listId = useId();
  const { lineRef, rowRef, measured } = useIconRowSpace();
  if (view.state === "live") {
    return (
      <div data-work-live className="oduvanchik-work oduvanchik-work-live">
        <header><Sphere size={18} /><span>{labels.workView.live(labels.workView.stepRunning)}</span></header>
        {view.completed?.map((item, index) => <div className="oduvanchik-work-line" key={index}>{item.failed ? <X size={14} aria-hidden /> : <Check size={14} aria-hidden />}<span>{item.phrase}</span></div>)}
        <div className="oduvanchik-work-line oduvanchik-work-current"><Sphere size={16} /><span key={view.phrase} aria-hidden="true" data-work-phrase>{view.phrase}</span></div>
        <span role="status" className="sr-only">{labels.workView.live(labels.workView.stepRunning)}</span>
      </div>
    );
  }
  const { steps, count, open, onOpenChange, items, icons = [], moreIcons = 0 } = view;
  const list = items ?? steps.map((step) => ({ ...step, icon: undefined }));
  const total = icons.length + moreIcons;
  const fitting = measured && visibleStepIcons(measured.space, total, (count) => labels.workView.moreSteps(count).length * measured.charPx, measured.iconPx);
  // Не влезает и «+N» — ряд пустой (элемент остаётся: по нему меряется место).
  const shown = measured === null ? icons.length : fitting === null ? 0 : Math.min(icons.length, fitting);
  const hidden = fitting === null && measured !== null ? 0 : total - shown;
  return (
    <div ref={lineRef} className="oduvanchik-work mb-2 min-w-0 not-first:mt-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => onOpenChange(!open)}
        className="-ml-2 h-7 max-w-full min-w-0 gap-1 px-2 text-xs font-medium text-[var(--foreground-muted)]"
      >
        <span className="shrink-0">{labels.workView.stepsDone(count)}</span>
        {icons.length > 0 && (
          <span ref={rowRef} data-step-icons aria-hidden="true" className="ml-1 flex min-w-0 items-center gap-1 overflow-hidden text-[var(--foreground-subtle)]">
            {icons.slice(0, shown).map((icon, index) => (
              <OduvanchikStepIcon key={index} icon={icon} />
            ))}
            {hidden > 0 && (
              <span data-step-icons-more className="shrink-0 tabular-nums">
                {labels.workView.moreSteps(hidden)}
              </span>
            )}
          </span>
        )}
        <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform duration-[var(--motion-fast)]", open && "rotate-180")} />
      </Button>
      <ol id={listId} hidden={!open} className="mt-1 space-y-1 border-l-2 border-[var(--border)] pl-3 text-xs leading-5 text-[var(--foreground-muted)]">
        {open &&
          list.map((step, index) => (
            <li
              key={index}
              data-work-step
              data-failed={String(step.failed)}
              className={cn("flex min-w-0 items-start gap-1.5 break-words [overflow-wrap:anywhere]", step.failed && "text-[var(--foreground-subtle)] line-through decoration-[var(--border)]")}
            >
              {step.icon && <OduvanchikStepIcon icon={step.icon} className="mt-[3px] text-[var(--foreground-subtle)]" />}
              <span className="min-w-0">{step.phrase}</span>
            </li>
          ))}
      </ol>
    </div>
  );
}
