import { VOICE_MODE_PART_TYPE } from "../agent-run/mode-notes";

interface MessageWithParts {
  id: string;
  parts: ReadonlyArray<{ type: string }>;
}

/** Id сообщения, которое склеенное сообщение заменило (отметка склейки в его `data-voice-mode`); `undefined` — это не склейка. */
export function replacedByGlue(message: Pick<MessageWithParts, "parts">): string | undefined {
  for (const part of message.parts) {
    if (part.type !== VOICE_MODE_PART_TYPE) continue;
    const replaces = ((part as { data?: unknown }).data as { replaces?: unknown } | null | undefined)?.replaces;
    return typeof replaces === "string" && replaces.length > 0 ? replaces : undefined;
  }
  return undefined;
}

/**
 * Сообщения без обрывков склейки голосовых фраз (FR-026): «Так.», которое заменило «Так. Дай-ка подумать.», — не отдельная
 * ветка, а часть той же мысли. Обрывок остаётся в базе, но ни веткой, ни соседом на развилке не считается; его потомки
 * (пустой оборванный ответ) без него недостижимы. Обрывки определяет отметка на склеенном сообщении.
 */
export function withoutGlueFragments<T extends MessageWithParts>(messages: readonly T[]): T[] {
  const fragments = new Set<string>();
  for (const message of messages) {
    const replaced = replacedByGlue(message);
    if (replaced !== undefined) fragments.add(replaced);
  }
  return fragments.size === 0 ? [...messages] : messages.filter((message) => !fragments.has(message.id));
}
