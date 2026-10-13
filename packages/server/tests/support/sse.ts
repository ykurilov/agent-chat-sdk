/** Разбирает SSE-поток UI-сообщений в список кусков (пинги `: …` и `[DONE]` пропущены). */
export function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .filter((event) => !event.startsWith(":"))
    .map((event) => event.replace(/^data: /, "").trim())
    .filter((data) => data.length > 0 && data !== "[DONE]")
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

/** Читает поток, пока не встретится `needle`; возвращает прочитанное. */
export async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`поток закончился раньше, чем пришло «${needle}»`);
    seen += decoder.decode(value, { stream: true });
  }
  return seen;
}

/** Дочитывает поток до конца и собирает куски; `seen` — то, что уже прочитано `readUntil`. */
export async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>, seen = ""): Promise<Array<Record<string, unknown>>> {
  const decoder = new TextDecoder();
  let text = seen;
  for (let read = await reader.read(); !read.done; read = await reader.read()) text += decoder.decode(read.value);
  return parseSse(text);
}
