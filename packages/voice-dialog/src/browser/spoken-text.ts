/**
 * Говоримый текст в браузере: правила — в `../shared/spoken-text-core` (общие с сервером, см. docs/contracts/voice-dialog/spoken-text.md),
 * теги голоса снимает копия правила из экрана. Сервер берёт то же ядро с правилом из `@ykurilov/agent-chat-core`.
 */
import { stripVoiceTags } from "@ykurilov/agent-chat-react";
import { createSpokenTextWith } from "../shared/spoken-text-core";
import type { SpokenText, SpokenTextOptions } from "../shared/spoken-text-core";

export { sourcePositionAtSpoken } from "../shared/spoken-text-core";
export type { SpokenPhrases, SpokenSentence, SpokenText, SpokenTextOptions } from "../shared/spoken-text-core";

export function createSpokenText(options: SpokenTextOptions = {}): SpokenText {
  return createSpokenTextWith(stripVoiceTags, options);
}
