import type { ToolSet } from "ai";
import type { AgentSettings } from "@ykurilov/agent-chat-core";
import type { Skills } from "./create-skills";
import { SKILLS_BLOCK_KEY } from "./skill-texts";

/**
 * Настройки агента с навыками: блок `skills` после блоков приложения, `use_skill` рядом с инструментами приложения.
 * Совпадение имени инструмента или ключа блока — ошибка: тихо подменить чужое нельзя.
 */
export function withSkills(agent: AgentSettings, skills: Skills): AgentSettings {
  const clash = (own: ToolSet) => skills.toolNames.find((name) => Object.hasOwn(own, name));
  const clashMessage = (name: string) => `Инструмент «${name}» задан и приложением, и навыками: переименуйте инструмент приложения`;
  const appTools = agent.tools;
  if (appTools && typeof appTools !== "function") {
    const name = clash(appTools);
    if (name) throw new Error(clashMessage(name));
  }
  const appBlocks = agent.contextBlocks;
  return {
    ...agent,
    serviceBlocks: [...(agent.serviceBlocks ?? []), ...skills.serviceBlocks],
    tools: (model) => {
      const own = typeof appTools === "function" ? appTools(model) : (appTools ?? {});
      const name = clash(own);
      if (name) throw new Error(clashMessage(name));
      return { ...own, ...skills.tools(model) };
    },
    contextBlocks: async (input) => {
      const [own, fromSkills] = await Promise.all([appBlocks ? appBlocks(input) : [], skills.contextBlocks(input)]);
      if (own?.some((block) => block.key === SKILLS_BLOCK_KEY)) {
        throw new Error(`Ключ блока «${SKILLS_BLOCK_KEY}» занят навыками: переименуйте блок приложения`);
      }
      return [...(own ?? []), ...fromSkills];
    },
  };
}
