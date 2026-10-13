import type { MemoryNote } from "@ykurilov/agent-chat-core";

/** Запись памяти для тестов: всё, что не названо, — по умолчанию. */
export function note(fields: Partial<MemoryNote> = {}): MemoryNote {
  return {
    id: "n1",
    categories: ["О себе"],
    content: "Пишет на TypeScript",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

/** `count` записей с разным временем правки: чем больше номер, тем новее. */
export function manyNotes(count: number, contentLength = 300): MemoryNote[] {
  return Array.from({ length: count }, (_, index) =>
    note({
      id: `n${String(index).padStart(3, "0")}`,
      content: `${index}:`.padEnd(contentLength, "я"),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }),
  );
}
