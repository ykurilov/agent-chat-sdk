import { deflateSync } from "node:zlib";

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

/** PDF без текста: пустая страница, как у скана без распознавания. */
export function makeBlankPdf(): Uint8Array {
  return makePdf([]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Настоящий PNG-квадрат одного цвета. */
export function makePng(size: number, [red, green, blue]: [number, number, number]): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8); // 8 бит, RGB
  const row = new Uint8Array(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([red, green, blue], 1 + x * 3);
  const raw = new Uint8Array(row.length * size);
  for (let y = 0; y < size; y++) raw.set(row, y * row.length);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

export const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const gifBytes = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;");
export const webpBytes = Uint8Array.from([...new TextEncoder().encode("RIFF"), 4, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
export const utf8 = (text: string) => new TextEncoder().encode(text);

/** PDF из многих страниц: на каждой одна строка текста из `lineLength` букв. Смещения xref настоящие. */
export function makeManyPagesPdf(pageCount: number, lineLength: number): Uint8Array {
  const line = "a".repeat(lineLength);
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (let page = 0; page < pageCount; page++) {
    const pageId = 4 + page * 2;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;
  objects.splice(2, 0, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  return assemblePdf(objects);
}

/** «Бомба»: одна страница, поток которой при чтении разворачивается в `operations` операций вывода текста. */
export function makeInflatingPdf(operations: number): Uint8Array {
  const chunk = "BT /F1 12 Tf 0 0 Td (a) Tj ET\n".repeat(1000);
  const packed = deflateSync(Buffer.from(chunk.repeat(Math.ceil(operations / 1000))));
  const head = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n" +
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
      `4 0 obj\n<< /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`,
  );
  const tail = new TextEncoder().encode("\nendstream\nendobj\ntrailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n");
  return Uint8Array.from([...head, ...packed, ...tail]);
}

function assemblePdf(objects: string[]): Uint8Array {
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
