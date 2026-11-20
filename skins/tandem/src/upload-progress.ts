import type { ComposerAttachmentItem } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useLayoutEffect } from "react";

/*
 * У поля `Composer` из `@tandem/ui` нет прогресса загрузки: его ставит в плашки файлов скин. По низу плашки — полоса,
 * вместо «Загружается…» у файла и вместо значка ожидания у картинки — процент. На 100 % браузер всё отправил, но сервер
 * ещё разбирает файл: процент уходит, возвращаются «Загружается…» и значок ожидания. Цвета — переменные темы Тандема,
 * поэтому всё верно и в светлой, и в тёмной теме.
 */

const barMark = "data-agent-chat-upload-progress";
const percentMark = "data-agent-chat-upload-percent";
/** Родная часть плашки, спрятанная на время процента: её показывают обратно. */
const hiddenMark = "data-agent-chat-upload-hidden";

export function useUploadProgress(wrapperRef: { current: HTMLElement | null }, items: readonly ComposerAttachmentItem[] | undefined) {
  const labels = useChatLabels().uploadProgress;
  useLayoutEffect(() => {
    const chips = wrapperRef.current && items ? findAttachmentChips(wrapperRef.current, items.length) : undefined;
    if (!chips) return;
    chips.forEach((chip, index) => {
      const item = items![index]!;
      const percent = item.status === "uploading" && item.progress !== undefined ? Math.round(item.progress * 100) : undefined;
      showBar(chip, percent, labels.label(item.name));
      showPercent(chip, percent !== undefined && percent < 100 ? labels.percent(percent) : undefined);
    });
  });
}

/**
 * Плашки файлов поля Тандема — список прямо перед полем ввода, по плашке на файл в том же порядке. Вёрстка `@tandem/ui`;
 * не сошлось число плашек — чужое не трогать (тест-страж это ловит).
 */
function findAttachmentChips(root: ParentNode, count: number): HTMLLIElement[] | undefined {
  const list = root.querySelector("textarea")?.previousElementSibling;
  if (list?.tagName !== "UL") return undefined;
  const chips = [...list.children].filter((child): child is HTMLLIElement => child.tagName === "LI");
  return chips.length === count ? chips : undefined;
}

function showBar(chip: HTMLLIElement, percent: number | undefined, label: string) {
  let bar = chip.querySelector<HTMLSpanElement>(`:scope > [${barMark}]`);
  if (percent === undefined) {
    bar?.remove();
    return;
  }
  if (!bar) {
    // Полоса стоит по плашке; у плашки `@tandem/ui` уже `relative`, но без него полоса уехала бы из плашки.
    if (getComputedStyle(chip).position === "static") chip.style.position = "relative";
    bar = document.createElement("span");
    bar.setAttribute(barMark, "");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    Object.assign(bar.style, {
      position: "absolute", left: "6px", right: "6px", bottom: "4px", height: "3px", borderRadius: "999px",
      overflow: "hidden", background: "var(--border)", pointerEvents: "none",
    });
    const fill = document.createElement("span");
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    Object.assign(fill.style, { display: "block", height: "100%", background: "var(--warm)", transition: still ? "none" : "width .2s linear" });
    bar.append(fill);
    chip.append(bar);
  }
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuenow", String(percent));
  (bar.firstElementChild as HTMLElement).style.width = `${percent}%`;
}

/**
 * Процент текстом. У файла — вместо подписи «Загружается…» (своя подпись с теми же классами), у картинки — вместо значка
 * ожидания посреди превью. `text` нет — родное возвращается. Для диктора процент говорит полоса, текст ему не нужен.
 */
function showPercent(chip: HTMLLIElement, text: string | undefined) {
  const own = chip.querySelector<HTMLSpanElement>(`[${percentMark}]`);
  if (text === undefined) {
    own?.remove();
    for (const hidden of chip.querySelectorAll(`[${hiddenMark}]`)) {
      hidden.removeAttribute("hidden");
      hidden.removeAttribute(hiddenMark);
    }
    return;
  }
  if (own) {
    own.textContent = text;
    return;
  }
  const native = chip.querySelector("img") ? chip.querySelector<HTMLElement>(".tandem-spinner") : findCaption(chip);
  if (!native?.parentElement) return;
  const percent = document.createElement("span");
  percent.setAttribute(percentMark, "");
  percent.setAttribute("aria-hidden", "true");
  percent.textContent = text;
  if (native.classList.contains("tandem-spinner")) {
    Object.assign(percent.style, {
      fontSize: "11px", fontWeight: "600", lineHeight: "16px", padding: "0 4px", borderRadius: "999px",
      background: "color-mix(in srgb, var(--surface) 80%, transparent)", fontVariantNumeric: "tabular-nums",
    });
  } else {
    percent.className = native.className;
    percent.style.fontVariantNumeric = "tabular-nums";
  }
  native.setAttribute("hidden", "");
  native.setAttribute(hiddenMark, "");
  native.after(percent);
}

/**
 * Подпись «Загружается…» под именем файла: вторая строка в блоке «имя, подпись». Вёрстка `@tandem/ui`; не нашлась —
 * процента нет, полоса остаётся.
 */
function findCaption(chip: HTMLLIElement): HTMLElement | undefined {
  return [...chip.querySelectorAll<HTMLElement>(":scope > span > span:nth-child(2):last-child")].find(
    (span) => span.childElementCount === 0 && !span.classList.contains("tandem-spinner"),
  );
}
