import { createModelCatalog } from "./model-catalog";
import { claudeHaiku55Profile } from "./profiles/claude-haiku-5-5";
import { deepseek41FlashProfile } from "./profiles/deepseek-4-1-flash";
import { gemini38FlashProfile } from "./profiles/gemini-3-8-flash";
import { glm53FlashProfile } from "./profiles/glm-5-3-flash";
import { gpt6LunaProfile } from "./profiles/gpt-6-luna";
import { deepseekProvider } from "./providers/deepseek";
import { fireworksProvider } from "./providers/fireworks";
import { openrouterProvider } from "./providers/openrouter";
import { togetherProvider } from "./providers/together";

/** Стандартные модели и провайдеры ядра. Новая версия модели приходит только с новой версией пакета. */
export const standardCatalog = createModelCatalog({
  models: [deepseek41FlashProfile, glm53FlashProfile, gpt6LunaProfile, gemini38FlashProfile, claudeHaiku55Profile],
  providers: [fireworksProvider, deepseekProvider, togetherProvider, openrouterProvider],
});
