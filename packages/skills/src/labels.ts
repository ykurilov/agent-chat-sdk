/** Подписи инструмента навыков в ленте чата. Без кода навыков: файл безопасно подключать в браузерной сборке. */
export const skillsTitles: Record<string, string> = {
  use_skill: "Загрузка навыка",
};

/** Та же подпись по-английски. */
export const englishSkillsTitles: Record<string, string> = {
  use_skill: "Loading a skill",
};

/** Понятная фраза для простого вида чата (`stepPhrases` у `AgentChat`). */
export const skillsStepPhrases: Record<string, { running: string; done: string }> = {
  use_skill: { running: "Открываю навык", done: "Открыл навык" },
};

/** Та же фраза по-английски. */
export const englishSkillsStepPhrases: Record<string, { running: string; done: string }> = {
  use_skill: { running: "Opening a skill", done: "Opened a skill" },
};
