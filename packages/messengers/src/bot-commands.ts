import type { InboundUpdate } from "./messenger-adapter";

/** Команда из текста: `/link@bot abc` → `{ name: "link", args: "abc" }`. Не команда — `null`. */
export function parseCommand(text: string | undefined): { name: string; args: string } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec((text ?? "").trim());
  return match ? { name: (match[1] ?? "").toLowerCase(), args: (match[2] ?? "").trim() } : null;
}

/** Команда обновления: только у `command` и `start` (у `start` имя — всегда `start`). */
export function commandOf(update: InboundUpdate): { name: string; args: string } | null {
  if (update.kind === "start") return { name: "start", args: update.startPayload ?? "" };
  return update.kind === "command" ? parseCommand(update.text) : null;
}
