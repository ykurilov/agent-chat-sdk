/** Управляющие последовательности терминала: цвет (`ESC [ … m`), перемещение курсора, заголовок окна (`ESC ] … BEL`). */
const TERMINAL_CODES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Текст лога без цветов и прочих управляющих последовательностей терминала. */
export function stripTerminalCodes(text: string): string {
  return text.replace(TERMINAL_CODES, "");
}
