/**
 * Невидимая зона касания 44×44 на телефоне вокруг маленькой кнопки: вид кнопки не меняется (`::after` по центру).
 * Классы записаны целиком: сборщик стилей ищет их в тексте и не собирает из кусков.
 */
const common =
  "relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:h-11 [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2 [@media(pointer:coarse)]:after:content-['']";
/** Кнопка-значок: зона 44×44. */
export const iconTouchZone = `${common} [@media(pointer:coarse)]:after:w-11`;
/** Кнопка с подписью: зона на всю ширину кнопки и 44px в высоту. */
export const labelTouchZone = `${common} [@media(pointer:coarse)]:after:w-full`;
/**
 * Все кнопки внутри обёртки (поле Тандема и его плашки файлов лежат в чужом компоненте, классов на кнопки не добавить).
 * Крестик плашки файла стоит в углу плашки (`absolute`) и обрезан её краем: его зона 44×44 идёт от угла плашки внутрь.
 */
export const nestedButtonsTouchZone =
  "[@media(pointer:coarse)]:[&_button:not(.absolute)]:relative [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:absolute [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:left-1/2 [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:top-1/2 [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:size-11 [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:-translate-x-1/2 [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:-translate-y-1/2 [@media(pointer:coarse)]:[&_button:not(.absolute)]:after:content-[''] " +
  "[@media(pointer:coarse)]:[&_button.absolute]:after:absolute [@media(pointer:coarse)]:[&_button.absolute]:after:right-[-4px] [@media(pointer:coarse)]:[&_button.absolute]:after:top-[-4px] [@media(pointer:coarse)]:[&_button.absolute]:after:size-11 [@media(pointer:coarse)]:[&_button.absolute]:after:content-['']";
