import type { DictatedText } from "./voice-input";

/**
 * Как диктовка пишет в поле ввода. Продиктованное дописывается к тому, что было набрано;
 * ручная правка остаётся, а сказанное до неё заново не появляется.
 */
export interface DictationField {
  /** Значение поля для накопленной диктовки; `null` — поле не трогать (диктовка уже заморожена). */
  write(text: DictatedText): string | null;
  /** Сообщить, что в поле сейчас `value`: если это не наша запись, значит поле правили руками. */
  observe(value: string): void;
  /** Сказано всё и закреплено, дальше только чистка: правки поля запоминаем, но запись больше не двигаем и `write` ничего не пишет. */
  freeze(): void;
  /**
   * Заменить надиктованный кусок исправленным текстом. Возвращает новое значение поля или `null`, если заменять нельзя:
   * поле правили до надиктованного или внутри него (правка не должна пропасть). Дописанное после надиктованного сохраняется.
   */
  applyPolished(polished: string): string | null;
}

export function createDictationField(startValue: string): DictationField {
  let base = startValue;
  // Сколько знаков закреплённой речи уже вошло в `base`. Незакреплённая часть ещё может измениться,
  // поэтому правка посреди неё не считается «уже записанной»: слово придёт заново целиком.
  let consumed = 0;
  let spoken = "";
  let settled = 0;
  let lastWritten = startValue;
  // Что стоит в поле по последним сведениям, и всё ли надиктованное пока лежит в поле нетронутым.
  let current = startValue;
  let undisturbed = true;
  let frozen = false;
  // Всё, что стоит в поле до надиктованного куска (набранное, пробел-разделитель), и был ли кусок.
  let head = startValue;
  let hasChunk = false;

  return {
    write({ finalText, interimText }) {
      // Поздний текст после заморозки не должен перезаписать поле: дописанное руками пропало бы.
      if (frozen) return null;
      spoken = finalText + interimText;
      settled = finalText.length;
      const chunk = spoken.slice(consumed).trimStart();
      const separator = chunk === "" || base === "" || /\s$/.test(base) ? "" : " ";
      hasChunk = chunk !== "";
      head = base + separator;
      lastWritten = chunk === "" ? base : base + separator + chunk;
      current = lastWritten;
      return lastWritten;
    },
    observe(value) {
      current = value;
      if (value === lastWritten || frozen) return;
      undisturbed = false;
      base = value;
      consumed = settled;
      lastWritten = value;
    },
    freeze() {
      frozen = true;
    },
    applyPolished(polished) {
      if (!hasChunk || !undisturbed || !current.startsWith(lastWritten)) return null;
      const tail = current.slice(lastWritten.length);
      lastWritten = head + polished;
      current = lastWritten + tail;
      return current;
    },
  };
}
