/** Подписи инструмента навыков в ленте чата. Без кода навыков: файл безопасно подключать в браузерной сборке. */
export const skillsTitles: Record<string, string> = {
  use_skill: "Загрузка навыка",
};

/** Та же подпись по-английски. */
export const englishSkillsTitles: Record<string, string> = {
  use_skill: "Loading a skill",
};

/** Фразы шага навыка и его значок (договор скина 28). */
export interface SkillStepPhrase {
  running: string;
  done: string;
  icon: "skill";
}

/** Имя навыка для фразы: строка в одну строку, не длиннее 40 знаков; иначе без имени. */
function skillNameOf(input: unknown): string | undefined {
  const name = (input as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string") return undefined;
  const clean = name.replace(/\s+/g, " ").trim();
  return clean.length > 0 && clean.length <= 40 ? clean : undefined;
}

function skillPhrase(running: string, done: string): (call: { input?: unknown }) => SkillStepPhrase {
  return ({ input }) => {
    const name = skillNameOf(input);
    return { running: name ? `${running} ${name}` : running, done: name ? `${done} ${name}` : done, icon: "skill" };
  };
}

/** Понятная фраза для простого вида чата (`stepPhrases` у `AgentChat`): «Открыл навык game-dev». */
export const skillsStepPhrases: Record<string, (call: { input?: unknown }) => SkillStepPhrase> = {
  use_skill: skillPhrase("Открываю навык", "Открыл навык"),
};

/** Та же фраза по-английски. */
export const englishSkillsStepPhrases: Record<string, (call: { input?: unknown }) => SkillStepPhrase> = {
  use_skill: skillPhrase("Opening skill", "Opened skill"),
};
