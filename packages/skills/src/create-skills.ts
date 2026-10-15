import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolsModel, ContextBlock, ContextBlocksInput } from "@ykurilov/agent-chat-core";
import { isSkillVisibleInHistory, skillHeader } from "./loaded-skills";
import type { BranchStorage } from "./loaded-skills";
import { createSkillsManager } from "./skills-manager";
import type { SkillsManager } from "./skills-manager";
import { DEFAULT_MAX_BODY_CHARS } from "./skill-rules";
import { russianSkillsModelTexts, SKILLS_BLOCK_KEY, USE_SKILL_TOOL } from "./skill-texts";
import type { SkillsModelTexts } from "./skill-texts";
import { visibleStatuses } from "./skill-visibility";
import type { IsSkillsAdmin, SkillsTurn } from "./skill-visibility";
import { byName } from "./store/skill-store";
import type { SkillBrief, SkillStore } from "./types";

export interface CreateSkillsOptions {
  store: SkillStore;
  /** Админ ли человек — для экрана навыков. Навыки «только админам» в ходе видны по `viewer.isAdmin` (`agent.viewer`). */
  isAdmin: IsSkillsAdmin;
  /** Хранилище чатов службы: `use_skill` смотрит, видно ли тело навыка в истории чата. */
  chatStorage: BranchStorage;
  /** Предел тела навыка в знаках; по умолчанию 50 000. */
  maxBodyChars?: number;
  /** Тексты для модели; по умолчанию русские (`englishSkillsModelTexts` — английские). */
  modelTexts?: SkillsModelTexts;
  /** Строка в журнал о каждой загрузке тела; по умолчанию `console.info`. */
  log?: (line: string) => void;
  logError?: (message: string) => void;
  now?: () => Date;
}

/** Навыки агента: список в контексте, инструмент загрузки и управление для админ-экрана. */
export interface Skills {
  /** Для `agent.contextBlocks`: блок `skills` со списком видимых навыков, без тел. */
  contextBlocks(input: ContextBlocksInput): Promise<ContextBlock[]>;
  /** Для `agent.tools`: инструмент `use_skill`. Описание одно на все чаты, видимость проверяется при вызове. */
  tools(model: AgentToolsModel): ToolSet;
  toolNames: readonly string[];
  isAdmin: IsSkillsAdmin;
  /** Предел тела навыка в знаках: по нему же адреса экрана считают предел запроса. */
  maxBodyChars: number;
  /** Действия админ-экрана: с проверкой полей, автором и временем. */
  manage: SkillsManager;
}

export function createSkills(options: CreateSkillsOptions): Skills {
  const { store, isAdmin, chatStorage } = options;
  const texts = options.modelTexts ?? russianSkillsModelTexts;
  const log = options.log ?? ((line: string) => console.info(line));
  const logError = options.logError ?? ((message: string) => console.error(message));
  const now = options.now ?? (() => new Date());
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  let viewerHintShown = false;

  /** Видимые статусы хода; есть админские навыки, а прав хода нет — один раз подсказка в журнал. */
  function statusesOf(turn: SkillsTurn, skills: readonly SkillBrief[]) {
    if (turn.viewer === undefined && !viewerHintShown && skills.some((skill) => skill.status === "admins")) {
      viewerHintShown = true;
      log("skills: навыки «только админам» не видны: задайте agent.viewer, который возвращает { isAdmin }");
    }
    return visibleStatuses(turn);
  }

  async function contextBlocks(input: ContextBlocksInput): Promise<ContextBlock[]> {
    const all = await store.listBrief();
    const statuses = statusesOf(input, all);
    const skills = all.filter((skill) => statuses.has(skill.status)).sort(byName);
    if (skills.length === 0) return [];
    // Текст зависит только от списка: пока навыки не правят, блок тот же байт в байт и ядро его не шлёт заново.
    const lines = skills.map((skill) => `- ${skill.name}: ${skill.whenToUse}`);
    return [{ key: SKILLS_BLOCK_KEY, text: [texts.listHeading, ...lines].join("\n") }];
  }

  /** `given` — заголовки тел, уже отданных в этой попытке хода: два вызова в одном шаге модели истории ещё не видят. */
  async function useSkill(model: AgentToolsModel, name: string, given: Set<string>): Promise<string> {
    const skill = await store.get(name.trim());
    if (!skill || !statusesOf(model, [skill]).has(skill.status)) return texts.notFound(name);

    const header = skillHeader(skill);
    if (given.has(header)) return texts.alreadyLoaded(skill.name, skill.version);
    given.add(header);
    let visible = false;
    try {
      visible = await isSkillVisibleInHistory(chatStorage, model.chatId, header);
    } catch (error) {
      // Не прочитали историю — отдаём тело: лишний раз загрузить лучше, чем оставить агента без указаний.
      logError(`skills: history of chat ${model.chatId} not read: ${String(error)}`);
    }
    if (visible) return texts.alreadyLoaded(skill.name, skill.version);

    const turnId = model.turnId ?? model.messageId ?? "";
    try {
      await store.recordLoad({ name: skill.name, version: skill.version, chatId: model.chatId, ownerId: model.ownerId, turnId, loadedAt: now().toISOString() });
    } catch (error) {
      logError(`skills: load of "${skill.name}" not recorded: ${String(error)}`);
    }
    log(`skills: loaded "${skill.name}" v${skill.version} chat=${model.chatId} owner=${model.ownerId} turn=${turnId}`);
    return `${header}\n${skill.body}\n</skill>`;
  }

  return {
    contextBlocks,
    // Ядро собирает инструменты заново на каждую попытку хода: повтор после сбоя начинает учёт отданных тел с нуля.
    tools: (model) => {
      const given = new Set<string>();
      return {
        [USE_SKILL_TOOL]: tool({
          description: texts.toolDescription,
          inputSchema: z.object({ name: z.string().describe(texts.nameDescription) }),
          execute: ({ name }) => useSkill(model, name, given),
        }),
      };
    },
    toolNames: [USE_SKILL_TOOL],
    isAdmin,
    maxBodyChars,
    manage: createSkillsManager({ store, maxBodyChars, now }),
  };
}
