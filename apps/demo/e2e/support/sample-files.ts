import { pngFromRaw } from "../../server/mock-png";

/*
 * Настоящие маленькие файлы для сценариев вложений. PDF — свой построитель (то же есть в тестах пакета вложений: приложение
 * не лезет в чужие тесты в обход exports); PNG строит сервер демо, он нужен и поддельному Runware.
 */

/** Минимальный PDF с текстом на одной странице (латиница: шрифт Helvetica без встраивания). Смещения xref настоящие. */
export function makePdf(lines: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const stream = `BT /F1 14 Tf 72 720 Td 16 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export { makePng } from "../../server/mock-png";

/**
 * Настоящий PNG из шума: шум не сжимается, поэтому файл весит примерно `size² × 3` байт. Нужен, когда загрузка должна
 * идти заметное время. Шум постоянный от прогона к прогону.
 */
export function makeNoisyPng(size: number): Uint8Array {
  const row = 1 + size * 3;
  const raw = new Uint8Array(row * size);
  let seed = 4471;
  for (let index = 0; index < raw.length; index++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    raw[index] = index % row === 0 ? 0 : seed >>> 24;
  }
  return pngFromRaw(size, raw);
}
