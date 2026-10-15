import { SkillsAdmin } from "@ykurilov/agent-chat-skills/react";
import { tandemSkillsSkin } from "@ykurilov/agent-chat-skin-tandem/skills";

/**
 * Страница «Навыки агента». Доступ решает сервер: не админу API отвечает 404, и экран сам показывает «не найдено».
 * Грузится лениво: без неё код экрана навыков в сборку не попадает.
 */
export default function SkillsPage() {
  return <SkillsAdmin skin={tandemSkillsSkin} />;
}
