/** Имя инструмента загрузки навыка. */
export const USE_SKILL_TOOL = "use_skill";

/** Ключ блока контекста со списком навыков. */
export const SKILLS_BLOCK_KEY = "skills";

/** Тексты для модели. Постоянные: от них зависит кэш, поэтому в них нет ни списка, ни времени. */
export interface SkillsModelTexts {
  /** Первая строка блока со списком: что такое навыки и когда их грузить. */
  listHeading: string;
  /** Описание инструмента `use_skill`. */
  toolDescription: string;
  /** Описание поля `name`. */
  nameDescription: string;
  /** Тело этой версии уже есть выше в переписке. */
  alreadyLoaded(name: string, version: number): string;
  /** Навыка нет, он выключен или не виден в этом чате — ответ один, чтобы не выдать чужой навык. */
  notFound(name: string): string;
}

export const russianSkillsModelTexts: SkillsModelTexts = {
  listHeading:
    "Навыки — готовые указания для отдельных задач. Если задача человека подходит под навык, до начала работы загрузи его указания инструментом use_skill и следуй им. Не подходит — не загружай.",
  toolDescription:
    "Загружает указания навыка из списка «Навыки» в контексте. Зови, когда задача подходит под навык, до начала работы. Загруженные указания остаются в переписке: повторно звать не нужно.",
  nameDescription: "Имя навыка из списка — как в списке, до двоеточия.",
  alreadyLoaded: (name, version) => `Навык «${name}» версии ${version} уже загружен выше в переписке — следуй тем указаниям.`,
  notFound: (name) => `Навыка «${name}» нет. Бери навыки только из списка «Навыки» в контексте.`,
};

export const englishSkillsModelTexts: SkillsModelTexts = {
  listHeading:
    "Skills are ready-made instructions for specific tasks. If the person's task matches a skill, load its instructions with the use_skill tool before you start and follow them. If it doesn't match, don't load it.",
  toolDescription:
    "Loads the instructions of a skill from the “Skills” list in the context. Call it before starting when the task matches a skill. Loaded instructions stay in the conversation: no need to call it again.",
  nameDescription: "Skill name exactly as in the list, before the colon.",
  alreadyLoaded: (name, version) => `Skill “${name}” version ${version} is already loaded above in the conversation — follow those instructions.`,
  notFound: (name) => `There is no skill “${name}”. Only use skills from the “Skills” list in the context.`,
};
